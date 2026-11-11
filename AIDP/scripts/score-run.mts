/**
 * Score a run that already exists against an answer key. No model calls.
 *
 * `eval-project-answer-key.mts` builds its own world: a throwaway organisation,
 * five uploads, parse/chunk/embed, then a fresh assessment. That is the right
 * shape for the generated Northwind corpus, whose files live in `samples/`.
 *
 * It is the wrong shape for a real customer corpus. The six client registers
 * and the design assessed against them were uploaded through the product and
 * live in the database; the PDFs are not in the repository, and re-uploading
 * them would pay for parsing, chunking and embedding a second time to arrive at
 * documents that are already indexed. The run has been made. The only question
 * left is whether it was right.
 *
 * So this reads findings and a key and compares them. Nothing else. It is safe
 * to run against a finished run, a failed one, or the same run repeatedly.
 *
 *   npx tsx --env-file=.env.local scripts/score-run.mts <runId> [keyFile]
 *
 *   npx tsx --env-file=.env.local scripts/score-run.mts \
 *     cmw6go9ex000ffbuyydaic3xy MERIDIAN_ANSWER_KEY.md
 *
 * `keyFile` is resolved inside `samples/` and defaults to ANSWER_KEY.md.
 *
 * ## Two accuracy figures, deliberately
 *
 *   accuracy      over the rows that produced a finding.
 *   accuracyAll   over every row in the key, counting a missing finding as
 *                 wrong.
 *
 * The second exists because the first cannot see a run that answered nothing:
 * no findings means no scored rows, and a ratio of zero over zero reads as a
 * clean sheet. The first exists because a run that died partway — a spent key,
 * a stopped worker — is still worth reading on what it did answer, and judging
 * it on clauses it never reached says nothing about the engine.
 *
 * Where they disagree, the gap is coverage, and the line says so.
 */
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/lib/prisma";

const SAMPLES = path.resolve(process.cwd(), "..", "samples");
const HISTORY = path.resolve(process.cwd(), "scripts", "eval-history.jsonl");

const [runId, keyFile = "ANSWER_KEY.md"] = process.argv.slice(2);
if (!runId) {
  console.error("usage: score-run.mts <runId> [keyFile]");
  process.exit(2);
}

type Row = { expected: string; must: boolean };

/**
 * The key's project rows, in either shape it is written in.
 *
 * Northwind names a clause "Architecture §3.3" across a five-column table; the
 * client registers name one "SOL-001" across three. Both are matched here
 * rather than in two scripts, because the key format is the thing a person
 * writing a new corpus will copy, and a parser that silently returns nothing
 * for the other shape is how a key gets written against a regex nobody read:
 * `key.size` of zero scores 0% with no error, which looks like a failing engine
 * rather than a failing script.
 */
async function answerKey(file: string): Promise<Map<string, Row>> {
  const text = await readFile(path.join(SAMPLES, file), "utf8");
  const out = new Map<string, Row>();
  let inside = false;
  let must = false;
  for (const line of text.split("\n")) {
    // Both reset at a `##`. `must` used to reset only at a `###`, so a scored
    // row sitting in a project section above its first subsection inherited
    // the flag from the previous section's last one — silently, with no error.
    if (line.startsWith("## ")) {
      inside = line.includes("as one project");
      must = false;
    }
    if (line.startsWith("### ")) must = line.includes("Must get");
    if (!inside) continue;
    const trimmed = line.trim();

    // "| SOL-001 | contradicts | why |"
    const register = trimmed.match(/^\|\s*([A-Z]{2,4}-\d{2,4})\s*\|\s*\*{0,2}(\w+)\*{0,2}\s*\|/);
    if (register) {
      out.set(register[1], { expected: register[2], must });
      continue;
    }

    // "| Architecture §3.3 Statelessness | contradicts | covered | **contradicts** | rule |"
    const sectioned = trimmed.match(
      /^\|\s*(\w+)\s*§(\d+\.\d+)[^|]*\|[^|]*\|[^|]*\|\s*\*{0,2}(\w+)/,
    );
    if (sectioned) out.set(`${sectioned[1]} ${sectioned[2]}`, { expected: sectioned[3], must });
  }
  if (!out.size) throw new Error(`${file}: no project rows parsed — check its table shape`);
  return out;
}

/** A share, or null where there was nothing to take a share of.
 *
 *  Not 0. A run that reached none of the must rows would otherwise record
 *  `mustAccuracy: 0`, which in the history file is indistinguishable from a run
 *  that reached all of them and got every one wrong. */
const pct = (n: number, of: number) => (of ? Math.round((n * 1000) / of) / 10 : null);
const show = (v: number | null) => (v === null ? "   —" : `${v}%`);

try {
  const run = await prisma.assessmentRun.findUnique({
    where: { id: runId },
    select: {
      id: true, state: true, model: true, mode: true, totalClauses: true,
      completedClauses: true, startedAt: true, completedAt: true, failureReason: true,
    },
  });
  if (!run) throw new Error(`no assessment run ${runId}`);

  const key = await answerKey(keyFile);
  const findings = await prisma.finding.findMany({
    where: { runId },
    select: { clauseRef: true, verdict: true, agreed: true, readings: true, obligation: true },
  });

  // `clauseRef` is the clause's `numberText`, which is unique within a
  // document and NOT across the documents of a framework. Northwind's own key
  // carries "Architecture §5.1" and "Security §5.1", and three more pairs like
  // it. Built with `new Map(...)` the second finding silently replaced the
  // first, and the number this script exists to record was computed against
  // whichever happened to come last.
  //
  // Register corpora (SOL-001, SEC-012) have no collisions, which is exactly
  // why this would have gone unnoticed until someone re-ran Northwind and
  // believed the result.
  const got = new Map<string, string>();
  const collided = new Set<string>();
  for (const f of findings) {
    const ref = f.clauseRef.trim();
    if (!ref) continue;
    if (got.has(ref) && got.get(ref) !== f.verdict) collided.add(ref);
    got.set(ref, f.verdict);
  }

  console.log(`\n  run      ${run.id}  (${run.state}, ${run.mode}, ${run.model ?? "unknown"})`);
  console.log(`  key      ${keyFile}  —  ${key.size} rows`);
  console.log(`  findings ${findings.length} of ${run.totalClauses} clauses\n`);
  if (run.failureReason) console.log(`  !  ${run.failureReason}\n`);

  let right = 0;
  let wrong = 0;
  let missing = 0;
  let mustRight = 0;
  let mustTotal = 0;
  let mustMissing = 0;
  const misses: string[] = [];

  for (const [clause, { expected, must }] of key) {
    if (must) mustTotal += 1;
    // A sectioned key stores "Architecture 3.3" while findings carry "3.3".
    // Only attempted when the key actually names a book: for "SOL-001" the
    // split yields undefined, and `got.get("")` would hand back whichever
    // finding happens to carry an empty ref for every unmatched row.
    const number = clause.includes(" ") ? clause.split(" ")[1] : "";
    const verdict = got.get(clause) ?? (number ? got.get(number) : undefined);
    if (!verdict) {
      missing += 1;
      if (must) mustMissing += 1;
      continue;
    }
    if (verdict === expected) {
      right += 1;
      if (must) mustRight += 1;
    } else {
      wrong += 1;
      const line = `  ${must ? "MUST" : "miss"} ${clause.padEnd(22)} expected ${expected.padEnd(14)} got ${verdict}`;
      misses.push(line);
    }
  }

  if (collided.size) {
    console.log(
      `  !  ${collided.size} clause ref(s) appear on more than one finding with different ` +
        `verdicts — scoring used the last of each: ${[...collided].sort().join(", ")}\n`,
    );
  }

  if (misses.length) {
    console.log("  where it differs from the key\n");
    for (const line of misses.sort((a, b) => a.localeCompare(b))) console.log(line);
  }

  // The must list is most of the reason this script exists, so losing it has to
  // be an error rather than a dash. Rewording the "### Must get these right"
  // heading is all it takes, and the run would otherwise print "must-get — (0/0)"
  // and append a record claiming nothing.
  if (!mustTotal) {
    throw new Error(
      `${keyFile}: parsed ${key.size} rows but none under a "### Must get" heading — ` +
        "check the subsection headings",
    );
  }

  const scored = right + wrong;
  const needsReview = findings.filter((f) => f.verdict === "needs_review").length;
  const unanimous = findings.filter((f) => f.agreed >= f.readings).length;
  const unstated = findings.filter((f) => f.obligation === "unstated").length;
  const seconds =
    run.completedAt ? Math.round((+run.completedAt - +run.startedAt) / 1000) : null;

  const record = {
    at: new Date().toISOString(),
    scored: "existing-run",
    runId: run.id,
    runState: run.state,
    key: keyFile,
    model: run.model ?? "unknown",
    mode: run.mode,
    rows: key.size,
    accuracy: pct(right, scored),
    accuracyAll: pct(right, key.size),
    // Over every must row, counting one that produced no finding as wrong —
    // the same denominator `eval-project-answer-key.mts` uses, because both
    // append to one history file under this name and a field that means two
    // things cannot be compared across the lines that hold it.
    mustAccuracy: pct(mustRight, mustTotal),
    // And the figure that is fair to a run which died partway: over the must
    // rows it actually reached.
    mustAccuracyReached: pct(mustRight, mustTotal - mustMissing),
    mustReached: mustTotal - mustMissing,
    mustTotal,
    coverage: pct(key.size - missing, key.size),
    needsReview: pct(needsReview, findings.length),
    unanimous: pct(unanimous, findings.length),
    unstatedObligation: pct(unstated, findings.length),
    missing,
    findings: findings.length,
    seconds,
  };

  console.log("\n────────────────────────────────────────────────");
  console.log(`  accuracy        ${show(record.accuracy)}   (${right}/${scored} rows that produced a finding)`);
  console.log(`  accuracyAll     ${show(record.accuracyAll)}   (${right}/${key.size} of the whole key)`);
  console.log(`  must-get        ${show(record.mustAccuracy)}   (${mustRight}/${mustTotal} of the whole must list)`);
  console.log(`  must-get, read  ${show(record.mustAccuracyReached)}   (${mustRight}/${record.mustReached} it reached)`);
  console.log(`  coverage        ${show(record.coverage)}   ${missing ? `— ${missing} clause(s) never judged` : ""}`);
  console.log(`  needs review    ${show(record.needsReview)}   of ${findings.length} findings`);
  console.log(`  unanimous       ${show(record.unanimous)}   where every reading agreed`);
  console.log(`  obligation      ${show(record.unstatedObligation)}   still unstated`);
  if (seconds !== null) console.log(`  took            ${seconds}s`);
  console.log("────────────────────────────────────────────────");

  await appendFile(HISTORY, JSON.stringify(record) + "\n", "utf8");
  console.log(`\n  appended to ${path.relative(process.cwd(), HISTORY)}\n`);

  // Printed, recorded, and then reported as a failure. A run that stopped early
  // is still worth reading on what it reached — but it is not a result, and a
  // script that exits 0 on one invites a number from a third of a framework
  // being quoted as though it covered the whole thing.
  if (run.state !== "complete") {
    console.log(
      `  !  this run is "${run.state}" — the figures above cover only the ` +
        `${findings.length} clause(s) it reached, not the key's ${key.size}\n`,
    );
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
