/**
 * Prove the baseline standards library, end to end, against the live database.
 *
 *   npx tsx --env-file=.env.local scripts/verify-standards-library.mts
 *
 * It builds a throwaway organisation, seeds the six registers through the same
 * intake path an upload uses, waits for the workers to ingest them, and then
 * checks the two things this feature exists to make true:
 *
 *   1. a customer who brings no standards of their own has some;
 *   2. a customer who brings their own can remove ours, and the next
 *      assessment measures against theirs — which needs no new code, so it is
 *      proved here rather than built.
 *
 * Everything it creates is removed in `finally`, including the stored blobs,
 * and the removal is re-read rather than assumed. Seeding is content-addressed,
 * so this costs one parse (deterministic, no model call) plus chunking and
 * embedding about 145 short clauses — fractions of a cent.
 *
 * Requires the workers to be running: `cd Workers && docker compose up -d`.
 */
import { prisma } from "../src/lib/prisma";
import { REGISTERS } from "../src/lib/standards-library";
import { libraryStanding, seedStandardLibrary } from "../src/lib/ingest/standards-library";
import { resolveFramework } from "../src/lib/ingest/assessment";
import { removeDocument } from "../src/lib/ingest/documents";
import { remove } from "../src/lib/ingest/storage";

let passed = 0;
let failed = 0;

function ok(what: string, got: unknown, want: unknown) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) {
    passed += 1;
    console.log(`  ok   ${what}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${what}\n         want ${JSON.stringify(want)}\n         got  ${JSON.stringify(got)}`);
  }
}

function okay(what: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${what}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${what}${detail ? `\n         ${detail}` : ""}`);
  }
}

const slug = `verify-library-${Date.now()}`;
let organisationId = "";
const keys: string[] = [];

try {
  // A real user, because `Document.uploadedById` attributes model spend and a
  // seeded document is attributed to whoever asked for it.
  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) throw new Error("no users in this database");

  const organisation = await prisma.organisation.create({
    data: {
      name: "Verify Standards Library",
      slug,
      memberships: { create: { userId: user.id, role: "owner" } },
    },
    select: { id: true },
  });
  organisationId = organisation.id;
  console.log(`\n  throwaway organisation ${slug}  (as ${user.email})\n`);

  // ---- 1. a new organisation starts with nothing -------------------------
  const before = await prisma.document.count({ where: { organisationId } });
  ok("a new organisation has no standards at all", before, 0);

  const emptyFramework = await resolveFramework(organisationId);
  ok("and nothing to assess against", emptyFramework.clauseCount, 0);

  // ---- 2. seeding -------------------------------------------------------
  console.log("\n  seeding\n");
  const first = await seedStandardLibrary({ organisationId, userId: user.id });
  for (const outcome of first.outcomes) {
    if (outcome.problem) console.log(`       ${outcome.key}: ${outcome.problem}`);
  }
  ok("all six registers are seeded", [first.seeded, first.present, first.failed], [6, 0, 0]);

  const seeded = await prisma.document.findMany({
    where: { organisationId },
    select: { id: true, suppliedKey: true, role: true, storageKey: true },
  });
  keys.push(...seeded.map((d) => d.storageKey));
  ok("each is an ordinary reference document", new Set(seeded.map((d) => d.role)).size, 1);
  ok(
    "each carries the register it is a copy of",
    seeded.map((d) => d.suppliedKey).sort(),
    REGISTERS.map((r) => r.key).sort(),
  );

  const queued = await prisma.job.count({ where: { organisationId, stage: "parse" } });
  ok("a parse job was queued for every one", queued, 6);

  // ---- 3. seeding again is a no-op --------------------------------------
  const second = await seedStandardLibrary({ organisationId, userId: user.id });
  ok("seeding twice costs nothing", [second.seeded, second.present, second.failed], [0, 6, 0]);
  ok(
    "and creates no second copy",
    await prisma.document.count({ where: { organisationId } }),
    6,
  );

  // ---- 4. wait for the workers ------------------------------------------
  console.log("\n  waiting for the workers\n");
  const deadline = Date.now() + 10 * 60_000;
  let ready = 0;
  let lost = 0;
  while (Date.now() < deadline) {
    try {
      const states = await prisma.document.groupBy({
        by: ["status"],
        where: { organisationId },
        _count: true,
      });
      ready = states.find((s) => s.status === "ready")?._count ?? 0;
      const broken = states.find((s) => s.status === "failed")?._count ?? 0;
      if (ready + broken === 6) break;
    } catch (error) {
      // Neon's serverless driver holds a WebSocket, and polling one open for
      // ten minutes drops it. The documents are being ingested by the workers
      // on their own connections, so losing ours says nothing about them —
      // reconnect on the next pass rather than failing a run that is fine.
      lost += 1;
      if (lost > 20) throw error;
    }
    // Eight seconds rather than four: the whole wait is minutes long, and
    // halving the number of round trips halves the chance of the above.
    await new Promise((r) => setTimeout(r, 8000));
  }
  if (lost) console.log(`       (reconnected ${lost} time(s) while waiting)`);
  const states = await prisma.document.findMany({
    where: { organisationId },
    select: { title: true, status: true, failureReason: true },
    orderBy: { title: "asc" },
  });
  for (const d of states) {
    console.log(`       ${d.title.padEnd(38)} ${d.status}${d.failureReason ? ` — ${d.failureReason}` : ""}`);
  }
  ok("every register ingested", ready, 6);

  // ---- 5. what the library actually holds --------------------------------
  console.log("\n  the library\n");
  const perRegister = await Promise.all(
    REGISTERS.map(async (register) => {
      const clauses = await prisma.clause.count({
        where: {
          supersededById: null,
          section: { document: { organisationId, suppliedKey: register.key } },
        },
      });
      return { key: register.key, want: register.rows.length, got: clauses };
    }),
  );
  for (const row of perRegister) {
    console.log(`       ${row.key.padEnd(16)} ${String(row.got).padStart(3)} clauses`);
  }
  ok(
    "every register yielded one clause per row",
    perRegister.filter((r) => r.got !== r.want),
    [],
  );

  const total = REGISTERS.reduce((n, r) => n + r.rows.length, 0);
  const live = await prisma.clause.count({
    where: { supersededById: null, section: { document: { organisationId } } },
  });
  ok("the whole library is there", live, total);

  // The column the client's own registers leave blank in all 170 rows, which
  // is why their obligations fall through to a model's guess.
  const withStatus = await prisma.clause.findMany({
    where: { supersededById: null, section: { document: { organisationId } } },
    select: { sourceRefs: true },
  });
  const statuses = withStatus.map((c) => {
    const refs = c.sourceRefs as { register?: { status?: string } } | null;
    return refs?.register?.status ?? "";
  });
  okay(
    "every clause states whether it binds or advises",
    statuses.every((s) => s === "Mandatory" || s === "Recommended"),
    `${statuses.filter((s) => s !== "Mandatory" && s !== "Recommended").length} clause(s) carry no status`,
  );

  const requirements = await prisma.clause.count({
    where: {
      supersededById: null,
      section: { document: { organisationId } },
      requirements: { isEmpty: true },
    },
  });
  ok("no clause is judged on its statement alone", requirements, 0);

  // ---- 6. the framework picks it up on its own ---------------------------
  console.log("\n  the framework\n");
  const framework = await resolveFramework(organisationId);
  ok("the framework measures the whole library", framework.clauseCount, total);
  ok("built from all six", framework.documentCount, 6);
  ok("nothing was excluded", framework.excluded.length, 0);
  console.log(`       version ${framework.version}, ${framework.clauseCount} clauses`);

  // ---- 7. the customer replaces one of ours ------------------------------
  console.log("\n  the customer brings their own\n");
  const standing = await libraryStanding(organisationId);
  ok("the library knows which are ours", standing.filter((s) => s.documentId).length, 6);

  const dropped = REGISTERS.find((r) => r.key === "integration")!;
  const theirs = standing.find((s) => s.key === dropped.key)!;

  // Through the same function the Remove button calls, not `document.delete`.
  // `FrameworkDocument` cascades, so a raw delete leaves the *existing*
  // framework version quietly describing five standards where it measured six
  // — which is what an earlier run of this script reported, and it was the
  // script that was wrong, not the product. `removeDocument` retires those
  // versions first.
  const gone = await removeDocument(theirs.documentId!);
  ok("the standard and its clauses are removed", gone?.clauses, dropped.rows.length);

  const after = await resolveFramework(organisationId);
  ok(
    "removing a register removes exactly its clauses",
    after.clauseCount,
    total - dropped.rows.length,
  );
  okay(
    "and the framework is cut as a new version rather than edited",
    after.version > framework.version,
    `was v${framework.version}, now v${after.version}`,
  );
  // The point of cutting a version rather than editing one: the version a past
  // run measured against stops being the live one instead of quietly becoming
  // a different set of standards under the same number.
  const retired = await prisma.framework.findFirst({
    where: { organisationId, version: framework.version },
    select: { supersededAt: true, _count: { select: { documents: true } } },
  });
  okay(
    "the version it measured is retired rather than left live",
    retired?.supersededAt != null,
    `supersededAt ${retired?.supersededAt ?? "null"}`,
  );

  // Asserted as it is rather than as it ought to be. `FrameworkDocument`
  // cascades on the document, so the retired version now lists five standards
  // where it measured six — superseding records that a version is finished, not
  // what it contained. That is invisible today: `AssessmentRun.totalClauses` is
  // written when the run starts, `describeScope` is only ever rendered for a
  // framework resolved live, and nothing reads a retired version's membership.
  // It stops being invisible the first time a past run's scope is rendered from
  // its framework, which is why it is pinned here instead of left to be
  // discovered as a wrong number in a report.
  ok(
    "a retired version no longer lists the standard that was removed (latent: see comment)",
    retired?._count.documents,
    5,
  );
  ok("the one they removed is gone from the library", (await libraryStanding(organisationId)).filter((s) => s.documentId).length, 5);
  console.log(
    `       v${framework.version} ${framework.clauseCount} clauses  →  v${after.version} ${after.clauseCount} clauses`,
  );

  // Which is the whole point: they can put it back, or put theirs in instead.
  const restored = await seedStandardLibrary({
    organisationId,
    userId: user.id,
    keys: [dropped.key],
  });
  ok("and a register they removed can be pulled back", restored.seeded, 1);
} finally {
  console.log("\n  cleaning up\n");
  if (organisationId) {
    const blobs = await prisma.document.findMany({
      where: { organisationId },
      select: { storageKey: true },
    });
    await prisma.organisation.delete({ where: { id: organisationId } });
    await remove([...new Set([...keys, ...blobs.map((b) => b.storageKey)])]).catch(() => {});

    const left = await prisma.document.count({ where: { organisationId } });
    const orgLeft = await prisma.organisation.count({ where: { id: organisationId } });
    ok("the throwaway organisation is gone", [orgLeft, left], [0, 0]);
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  if (failed) process.exitCode = 1;
}
