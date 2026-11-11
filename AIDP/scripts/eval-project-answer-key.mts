/**
 * The project answer key, scored against a real run.
 *
 * Workers/tests/test_project_answer_key.py proves the key is internally sound
 * and that every verdict in it survives the guards. It cannot say whether the
 * engine actually reaches those verdicts, because that needs the sample corpus
 * indexed and a model. This does: it uploads the five sample documents into a
 * throwaway organisation, puts both designs in one project, assesses the
 * project as a whole, and scores the result against the key's 21 rows.
 *
 * A throwaway organisation on purpose. The framework is built per organisation
 * from its own ready reference documents, so this one holds exactly the three
 * sample standards and nothing a demo workspace happens to contain. Everything
 * is removed at the end, whether it passed or not.
 *
 * Real model calls — parse, chunk, embed and 36 clauses — so this is not part of
 * the ordinary test sweep. Run it when the project-level judgement changes.
 *
 * ## It writes the number down
 *
 * Every run appends a line to `eval-history.jsonl` beside this script: the
 * accuracy, the must-get accuracy, the needs-review rate, how long it took, and
 * the model, mode, reading count and concurrency that produced them. That file
 * is the point. Until it existed, every prompt rule and every threshold was a
 * guess about whether it helped — the engine could only be compared against
 * somebody's memory of the last time they looked at a report.
 *
 * Three numbers, and the second two matter as much as the first:
 *
 *   accuracy      how many of the key's rows the engine got right.
 *   mustAccuracy  the same over the rows the key marks "must get these right".
 *                 A regression here is a release-blocker; the overall number
 *                 can absorb one and still look healthy.
 *   needsReview   the share of ALL findings handed back to a person. The
 *                 guards are right to demote what the evidence does not
 *                 support, but a run that demotes a third of the framework is
 *                 a tool that did not answer, and nothing in the accuracy
 *                 figure can see that — a needs_review is simply a row the key
 *                 scores as wrong, indistinguishable from a confident mistake.
 *
 * It also reports `unanimous`: the share of findings where every reading of the
 * clause agreed. That is the closest thing to a reproducibility figure that one
 * run can give — see `_vote` in Workers/aidp/stages/analyse.py. For the real
 * thing, set REPEAT=2 and it assesses twice and reports how many verdicts moved
 * between identical runs, which is the number a client actually feels.
 *
 * Needs the dev server (for the upload endpoint) and the workers up.
 *
 *   BASE_URL=http://localhost:3002 npx tsx --env-file=.env.local \
 *     scripts/eval-project-answer-key.mts
 *
 *   REPEAT=2 BASE_URL=... npx tsx --env-file=.env.local \
 *     scripts/eval-project-answer-key.mts
 */
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { provisionAccount } from "../src/lib/access/provision";
import { OWNER } from "../src/lib/access/roles";
import type { Access } from "../src/lib/access/gate";
import { createProject, startProjectRun } from "../src/lib/ingest/projects";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "a-throwaway-password";
const TAG = `zz-eval-${Date.now()}`;
const SAMPLES = path.resolve(process.cwd(), "..", "samples");
const HISTORY = path.resolve(process.cwd(), "scripts", "eval-history.jsonl");
/** How many times to assess the same project, to see whether it answers the same. */
const REPEAT = Math.max(1, Math.min(5, Number(process.env.REPEAT ?? "1") || 1));

const STANDARDS = [
  "Solution_Architecture_Standards.pdf",
  "Data_Standards.pdf",
  "Security_Standards.pdf",
];
const DESIGNS = [
  "Customer_Portal_Modernisation_SAD.pdf",
  "Field_Telemetry_Ingestion_SAD.pdf",
];
/** Every file this corpus uploads. Was written out as `5` in the wait below,
 *  which meant adding a standard made the loop wait the full fifteen minutes
 *  and then score an unindexed corpus as though nothing were wrong. */
const CORPUS_SIZE = STANDARDS.length + DESIGNS.length;

/** The project rows of samples/ANSWER_KEY.md: clause -> expected verdict. */
async function projectKey(): Promise<Map<string, { expected: string; must: boolean }>> {
  const text = await readFile(path.join(SAMPLES, "ANSWER_KEY.md"), "utf8");
  const out = new Map<string, { expected: string; must: boolean }>();
  let inside = false;
  let must = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) inside = line.includes("as one project");
    if (line.startsWith("### ")) must = line.includes("Must get");
    if (!inside) continue;
    const m = line
      .trim()
      .match(/^\|\s*(Architecture|Data|Security)\s*§(\d+\.\d+)[^|]*\|[^|]*\|[^|]*\|\s*\*{0,2}(\w+)/);
    if (m) out.set(`${m[1]} ${m[2]}`, { expected: m[3], must });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A read that survives the connection under it going away.
 *
 * This polls one row every ten seconds for as long as a run takes, which on a
 * project of two designs is minutes — and Neon's serverless driver reaches the
 * database over a WebSocket that does not stay open that long when it is idle
 * between queries. The first version of this harness died exactly there: the
 * clauses were all judged, the run was finishing its coverage reads, and the
 * poll threw `ErrorEvent` from a socket that had closed underneath it. The
 * `finally` then deleted the throwaway workspace, so the evidence went with it.
 *
 * A dropped socket is not a failed run, and an eval that cannot tell the two
 * apart reports an engine problem every time the network blinks. So a read is
 * retried a few times before it is believed.
 */
async function resilient<T>(what: string, read: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      last = error;
      const why = error instanceof Error ? error.message : String(error);
      console.log(`    (${what} failed, retrying: ${why.slice(0, 80)})`);
      await sleep(2000 * (attempt + 1));
    }
  }
  throw last;
}

const org = await prisma.organisation.create({
  data: { name: "ZZ Answer Key Eval", slug: TAG },
});

try {
  const account = await provisionAccount({
    email: `${TAG}@test.invalid`,
    name: "Eval",
    company: org.name,
    password: PASSWORD,
  });
  await prisma.membership.create({
    data: { userId: account.userId, organisationId: org.id, role: OWNER },
  });
  await prisma.rosterEntry.create({
    data: {
      organisationId: org.id,
      email: `${TAG}@test.invalid`,
      status: "active",
      role: OWNER,
      userId: account.userId,
    },
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: `${TAG}@test.invalid` },
    select: { id: true, name: true, email: true, company: true, isPlatformAdmin: true },
  });
  const access: Access = {
    user,
    organisation: { id: org.id, name: org.name, slug: TAG, role: OWNER },
    role: OWNER,
    isOwner: true,
  };

  const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: `${TAG}@test.invalid`, password: PASSWORD }),
  });
  if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status} — is ${BASE} up?`);
  const cookie = (signIn.headers.getSetCookie() ?? []).map((c) => c.split(";")[0]).join("; ");

  const project = await createProject(access, { name: "Northwind submissions" });
  console.log(`  project "${project.name}" opened in a throwaway workspace`);

  async function upload(folder: string, name: string, role: string, projectId?: string) {
    const bytes = await readFile(path.join(SAMPLES, folder, name));
    const form = new FormData();
    form.set("file", new File([bytes], name, { type: "application/pdf" }));
    form.set("role", role);
    if (projectId) form.set("projectId", projectId);
    const res = await fetch(`${BASE}/api/documents/upload`, {
      method: "POST",
      headers: { cookie, origin: BASE },
      body: form,
    });
    const body = (await res.json()) as { id?: string; error?: string };
    if (!res.ok) throw new Error(`${name}: ${res.status} ${body.error ?? ""}`);
    console.log(`  uploaded ${role.padEnd(9)} ${name}`);
    return body.id!;
  }

  for (const name of STANDARDS) await upload("standards", name, "reference");
  for (const name of DESIGNS) await upload("designs", name, "assessed", project.id);

  console.log("\n  waiting for parse, chunk and embed…");
  let indexed = false;
  for (let i = 0; i < 90; i += 1) {
    const docs = await resilient("document poll", () =>
      prisma.document.findMany({
        where: { organisationId: org.id },
        select: { title: true, status: true, failureReason: true },
      }),
    );
    const done = docs.filter((d) => d.status === "ready").length;
    const failed = docs.filter((d) => d.status === "failed");
    if (failed.length) throw new Error(`ingest failed: ${failed.map((f) => f.title).join(", ")}`);
    if (docs.length === CORPUS_SIZE && done === CORPUS_SIZE) {
      indexed = true;
      break;
    }
    if (i % 4 === 0) console.log(`    ${done}/${CORPUS_SIZE} ready`);
    await sleep(10_000);
  }
  // Loudly, rather than scoring whatever happened to be ready. A corpus that
  // never finished indexing produces findings against a fraction of the
  // framework, and the accuracy figure cannot tell that from a bad engine.
  if (!indexed) {
    throw new Error(
      `only some of the ${CORPUS_SIZE} documents indexed within 15 minutes — are the workers up?`,
    );
  }

  const key = await projectKey();
  const rounds: Array<{
    verdicts: Map<string, string>;
    right: number;
    wrong: number;
    missing: number;
    mustRight: number;
    mustTotal: number;
    needsReview: number;
    findings: number;
    unanimous: number;
    seconds: number;
    mode: string;
    model: string;
    readingsMax: number;
    readingsMean: number;
  }> = [];

  for (let round = 1; round <= REPEAT; round += 1) {
    if (REPEAT > 1) console.log(`\n──── run ${round} of ${REPEAT} ────`);
    const begunAt = Date.now();
    const started = await startProjectRun(access, project.id);
    console.log(`\n  ${started.scope}`);
    let state = "queued";
    for (let i = 0; i < 180; i += 1) {
      const run = await resilient("run poll", () =>
        prisma.assessmentRun.findUniqueOrThrow({
          where: { id: started.runId },
          select: {
            state: true,
            completedClauses: true,
            totalClauses: true,
            failureReason: true,
            mode: true,
            note: true,
          },
        }),
      );
      state = run.state;
      if (state === "complete" || state === "failed") {
        if (state === "failed") throw new Error(`run failed: ${run.failureReason}`);
        console.log(`    read by ${run.mode}${run.note ? ` — ${run.note}` : ""}`);
        break;
      }
      if (i % 3 === 0) console.log(`    ${run.completedClauses}/${run.totalClauses} clauses`);
      await sleep(10_000);
    }
    if (state !== "complete") throw new Error("the run never completed");
    const seconds = Math.round((Date.now() - begunAt) / 1000);
    // The worker writes back the model it used and the mode it actually read
    // the design by — which is not always the one asked for, and is the whole
    // reason `note` exists. Taken from the run rather than from this process's
    // environment: the model is configured on the worker, so reading it here
    // records whatever this shell happens to have, which is usually nothing.
    const settled = await resilient("run summary", () =>
      prisma.assessmentRun.findUniqueOrThrow({
        where: { id: started.runId },
        select: { mode: true, model: true },
      }),
    );

    const findings = await resilient("findings read", () =>
      prisma.finding.findMany({
      where: { runId: started.runId },
      select: {
        clauseRef: true,
        clauseTitle: true,
        verdict: true,
        evidence: true,
        readings: true,
        agreed: true,
      },
      }),
    );
    const got = new Map<string, { verdict: string; designs: string[] }>();
    for (const f of findings) {
      const designs = [
        ...new Set(
          (Array.isArray(f.evidence) ? f.evidence : [])
            .map((e) => (e as { documentTitle?: string }).documentTitle ?? "")
            .filter(Boolean),
        ),
      ];
      // Findings carry the clause number; the key names it "Book §n.n".
      got.set(f.clauseRef.trim(), { verdict: f.verdict, designs });
    }

    console.log(`\n  scoring ${key.size} key rows against ${findings.length} findings\n`);
    let right = 0;
    let wrong = 0;
    let missing = 0;
    let mustRight = 0;
    let mustTotal = 0;
    const verdicts = new Map<string, string>();
    for (const [clause, { expected, must }] of key) {
      const number = clause.split(" ")[1];
      const found = got.get(number) ?? got.get(clause);
      if (must) mustTotal += 1;
      if (!found) {
        missing += 1;
        console.log(`  ?    ${clause.padEnd(22)} expected ${expected} — no finding for this clause`);
        continue;
      }
      verdicts.set(clause, found.verdict);
      const hit = found.verdict === expected;
      if (hit) {
        right += 1;
        if (must) mustRight += 1;
      } else wrong += 1;
      console.log(
        `  ${hit ? "ok  " : "MISS"} ${clause.padEnd(22)} expected ${expected.padEnd(12)} got ${found.verdict.padEnd(12)} ${found.designs.length > 1 ? "(both designs)" : ""}`,
      );
    }

    // Over every finding, not only the scored ones: a run that hands a third of
    // the framework back to a person has not answered, and the accuracy figure
    // cannot see that on its own.
    const needsReview = findings.filter((f) => f.verdict === "needs_review").length;
    const unanimous = findings.filter((f) => f.agreed >= f.readings).length;
    // What the engine actually did, taken from the findings rather than from
    // this process's environment. JUDGE_READINGS is set on the *worker*, so
    // reading it here recorded whatever this shell happened to have — which
    // was nothing, so every row in the history claimed the default while the
    // runs behind them differed. A number in a history file that does not say
    // what produced it is worse than no history.
    const readingsMax = findings.reduce((n, f) => Math.max(n, f.readings), 0);
    const readingsMean =
      findings.length
        ? Math.round((findings.reduce((n, f) => n + f.readings, 0) / findings.length) * 100) / 100
        : 0;

    rounds.push({
      verdicts,
      right,
      wrong,
      missing,
      mustRight,
      mustTotal,
      needsReview,
      findings: findings.length,
      unanimous,
      seconds,
      mode: settled.mode,
      model: settled.model ?? "unknown",
      readingsMax,
      readingsMean,
    });

    const scored = right + wrong;
    console.log(
      `\n  ${right}/${scored} correct` +
        (missing ? `, ${missing} clause(s) not in the run` : "") +
        `  —  must-get: ${mustRight}/${mustTotal}`,
    );

    // Nothing to release between rounds. This used to null
    // `ArchitectureRequest.runId` here, under a comment about freeing the
    // project's live-run slot — which it cannot do: that column belongs to a
    // request, this corpus never creates one, and the slot is held by
    // `assessment_run`, whose previous run is already complete by the time the
    // scoring above has run. It was the only code outside `startAssessment`
    // touching that column, which is a bad thing for a test script to be.
  }

  // ---------------------------------------------------------------- the number
  const pct = (n: number, of: number) => (of ? Math.round((n * 1000) / of) / 10 : 0);
  const first = rounds[0];
  const scored = first.right + first.wrong;
  const record = {
    at: new Date().toISOString(),
    model: first.model,
    mode: first.mode,
    // The budget the worker was on (the most any one clause needed) and what
    // a clause cost on average — which is the number that decides the bill,
    // since readings stop as soon as the leader cannot be caught.
    readings: first.readingsMax,
    readingsMean: first.readingsMean,
    concurrency: Number(process.env.ASSESS_CONCURRENCY ?? 8),
    rows: key.size,
    accuracy: pct(first.right, scored),
    // Over the whole key, counting a clause that produced no finding as wrong.
    // `accuracy` divides by the rows that were answered, so a run returning no
    // findings at all scores 0/0 — which prints as 0% but passes every check
    // that asks whether the number went down. This one cannot be gamed by
    // answering less.
    accuracyAll: pct(first.right, key.size),
    mustAccuracy: pct(first.mustRight, first.mustTotal),
    needsReview: pct(first.needsReview, first.findings),
    unanimous: pct(first.unanimous, first.findings),
    missing: first.missing,
    seconds: first.seconds,
    repeat: REPEAT,
    // Across identical runs: how many scored clauses came back with the same
    // verdict every time. This is the figure a reviewer experiences as whether
    // the tool can be trusted, and it is the one the readings exist to move.
    stable:
      REPEAT > 1
        ? pct(
            [...first.verdicts.keys()].filter((clause) =>
              rounds.every((r) => r.verdicts.get(clause) === first.verdicts.get(clause)),
            ).length,
            first.verdicts.size,
          )
        : null,
  };

  console.log("\n────────────────────────────────────────────────");
  console.log(`  accuracy       ${record.accuracy}%   (${first.right}/${scored})`);
  console.log(`  must-get       ${record.mustAccuracy}%   (${first.mustRight}/${first.mustTotal})`);
  console.log(`  needs review   ${record.needsReview}%   of ${first.findings} findings`);
  console.log(`  unanimous      ${record.unanimous}%   of findings where every reading agreed`);
  if (record.stable !== null) {
    console.log(`  stable         ${record.stable}%   same verdict across ${REPEAT} identical runs`);
    for (const clause of first.verdicts.keys()) {
      const seen = rounds.map((r) => r.verdicts.get(clause) ?? "—");
      if (new Set(seen).size > 1) console.log(`      moved  ${clause.padEnd(22)} ${seen.join(" → ")}`);
    }
  }
  console.log(
    `  readings       ${first.readingsMean} per clause on average, ${first.readingsMax} at most`,
  );
  console.log(`  took           ${first.seconds}s   on ${record.model}, read by ${record.mode}`);
  console.log("────────────────────────────────────────────────");

  await appendFile(HISTORY, JSON.stringify(record) + "\n", "utf8");
  console.log(`\n  appended to ${path.relative(process.cwd(), HISTORY)}`);

} finally {
  await prisma.organisation.deleteMany({ where: { slug: TAG } });
  await prisma.user.deleteMany({ where: { email: `${TAG}@test.invalid` } });
  await prisma.$disconnect();
  console.log("\n  throwaway workspace removed");
}
