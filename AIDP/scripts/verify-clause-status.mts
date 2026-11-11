/**
 * Walk one real clause through a status change, against the live database.
 *
 *   npx tsx --env-file=.env.local scripts/verify-clause-status.mts
 *
 * Replaces `verify-adoption.mts`, which walked a clause through a *proposal* in
 * the decision register. That path is gone: the register is how a new standard
 * is promoted into the library, and a standard already in the library must
 * never travel back the other way. Status is now set directly on the clause,
 * administrator only, with a reason, and recorded.
 *
 * So the things worth proving changed too. It is no longer "do the two gates
 * hold" but:
 *
 *   * does suspending a clause actually stop the engine judging it,
 *   * is the move recorded with who, when and why,
 *   * and are the refusals real — an empty reason, an unknown status, a clause
 *     already in the state asked for.
 *
 * Everything is restored in `finally`, and the restore is re-read rather than
 * assumed. No model is called and nothing is paid for.
 */
import { prisma } from "../src/lib/prisma";
import { setClauseStatus, StatusRefused, libraryForDocument } from "../src/lib/ingest/standards";

let passed = 0;
let failed = 0;

const ok = (label: string, got: unknown, want: unknown) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}\n          want ${JSON.stringify(want)}\n          got  ${JSON.stringify(got)}`);
  }
};

const okay = (label: string, condition: boolean, detail = "") => {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
};

/** Refused, and with a message a person could act on. */
async function refuses(label: string, run: () => Promise<unknown>) {
  try {
    await run();
    failed += 1;
    console.log(`  FAIL  ${label} — it was allowed`);
  } catch (error) {
    if (error instanceof StatusRefused) {
      passed += 1;
      console.log(`  ok    ${label}  ("${error.message}")`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${label} — refused for the wrong reason: ${String(error)}`);
    }
  }
}

/**
 * How many clauses of this document the engine would judge.
 *
 * The same SQL `analyse._framework_clauses` uses, written out rather than
 * imported, because the point is to check that the worker's filter and this
 * column agree — and a test that reuses the thing it is testing proves nothing.
 */
const judged = async (documentId: string) => {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
      FROM "clause" cl
      JOIN "document_section" ds ON ds."id" = cl."sectionId"
     WHERE ds."documentId" = ${documentId}
       AND cl."supersededById" IS NULL
       AND cl."status" <> 'suspended'`;
  return Number(rows[0].n);
};

let clauseId: string | null = null;

try {
  const admin = await prisma.membership.findFirst({
    where: { role: "owner" },
    select: { userId: true, organisationId: true },
  });
  if (!admin) throw new Error("no administrator in any organisation");

  const clause = await prisma.clause.findFirst({
    where: {
      status: "active",
      supersededById: null,
      section: { document: { organisationId: admin.organisationId, role: "reference" } },
    },
    select: { id: true, section: { select: { documentId: true, numberText: true } } },
    orderBy: { id: "asc" },
  });
  if (!clause) throw new Error("no active clause in a reference document");

  clauseId = clause.id;
  const documentId = clause.section.documentId;
  const ref = clause.section.numberText ?? "(unnumbered)";
  const before = await judged(documentId);
  console.log(`\n  ${ref} in document ${documentId}\n  engine judges ${before} clause(s) here\n`);

  // ---- the refusals, before anything has moved ---------------------------
  await refuses("a status the vocabulary does not hold is refused", () =>
    setClauseStatus(admin.userId, clause.id, "retired", "tidying", "verify"),
  );
  await refuses("so is a blank one, rather than defaulting to active", () =>
    setClauseStatus(admin.userId, clause.id, "", "tidying", "verify"),
  );
  await refuses("a change with no reason is refused", () =>
    setClauseStatus(admin.userId, clause.id, "suspended", "   ", "verify"),
  );
  await refuses("and so is a move to the state it is already in", () =>
    setClauseStatus(admin.userId, clause.id, "active", "no change", "verify"),
  );

  ok("none of which moved it", await judged(documentId), before);

  // ---- suspend -----------------------------------------------------------
  const moved = await setClauseStatus(
    admin.userId,
    clause.id,
    "suspended",
    "Verification run — superseded by the group policy.",
    "verify-clause-status",
  );
  ok("suspending reports the move it made", [moved.from, moved.to], ["active", "suspended"]);

  const after = await prisma.clause.findUnique({
    where: { id: clause.id },
    select: { status: true, supersededById: true },
  });
  ok("the clause is suspended", after?.status, "suspended");
  // The whole reason status is written in place rather than superseding: it
  // changes nothing the clause says, so forking the library would be recording
  // a new rule to answer a question about an old one.
  ok("and in place — nothing was superseded", after?.supersededById, null);

  ok("the engine stops judging it", await judged(documentId), before - 1);

  // ---- the record --------------------------------------------------------
  const changes = await prisma.clauseStatusChange.findMany({
    where: { clauseId: clause.id },
    orderBy: { createdAt: "desc" },
    select: { from: true, to: true, reason: true, byId: true, byName: true, clauseRef: true },
  });
  ok("the move is recorded", changes.length, 1);
  ok("with where it came from and went to", [changes[0]?.from, changes[0]?.to], ["active", "suspended"]);
  okay("with who made it", changes[0]?.byId === admin.userId, `byId ${changes[0]?.byId}`);
  okay("and why", (changes[0]?.reason ?? "").includes("superseded by the group policy"), changes[0]?.reason);
  ok("and the clause it was about, kept beside it", changes[0]?.clauseRef, clause.section.numberText ?? "");

  // ---- what the library screen shows -------------------------------------
  const listed = (await libraryForDocument(admin.userId, documentId)).find(
    (row) => row.id === clause.id,
  );
  ok("the library lists it as suspended", listed?.status, "suspended");
  okay(
    "and shows the reason beside it rather than only the state",
    Boolean(listed?.lastChange?.reason),
    JSON.stringify(listed?.lastChange ?? null),
  );

  // ---- and back ----------------------------------------------------------
  await setClauseStatus(
    admin.userId,
    clause.id,
    "active",
    "Verification run — putting it back.",
    "verify-clause-status",
  );
  ok("making it active again restores the engine's count", await judged(documentId), before);
  ok(
    "and the record is append-only — both moves are kept",
    await prisma.clauseStatusChange.count({ where: { clauseId: clause.id } }),
    2,
  );
} finally {
  if (clauseId) {
    // Restore whatever happened above, then re-read it rather than trusting
    // that the restore worked.
    await prisma.clause.updateMany({ where: { id: clauseId }, data: { status: "active" } });
    await prisma.clauseStatusChange.deleteMany({ where: { byName: "verify-clause-status" } });

    const restored = await prisma.clause.findUnique({
      where: { id: clauseId },
      select: { status: true },
    });
    const left = await prisma.clauseStatusChange.count({ where: { clauseId } });
    console.log(`\n  restored: clause is "${restored?.status}", ${left} change row(s) left behind`);
    if (restored?.status !== "active" || left !== 0) failed += 1;
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  if (failed) process.exitCode = 1;
}
