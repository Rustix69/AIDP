/**
 * Put an organisation's technology stack into its library, and prove it landed.
 *
 *   npx tsx --env-file=.env.local scripts/ingest-technology-stack.mts <slug> <file>
 *   npx tsx --env-file=.env.local scripts/ingest-technology-stack.mts \
 *     satyamindustry "../templates/AIDP_Technology_Stack_Template (1).xlsx"
 *
 * A one-off, because there is no reason for this to be a product feature: a
 * stack is uploaded through the Reference Library like anything else. This
 * exists so a stack already on somebody's disk can be put where the engine can
 * see it without clicking through the browser.
 *
 * It goes through `intake.record()` — the same funnel both upload doors use —
 * and uploads it as a *reference* document, because that is the only role a
 * person may choose. The parse stage decides it is a stack from what the file
 * turns out to be and flips the role itself; that is the whole point of
 * `Document.role` being written by the parser rather than the uploader, and
 * this script must not pre-empt it.
 *
 * Nothing is deleted and nothing is overwritten. Re-running it on the same
 * bytes resolves to the document already there.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/lib/prisma";
import { XLSX_MIME, record } from "../src/lib/ingest/intake";

const [slug, file] = process.argv.slice(2);
if (!slug || !file) {
  console.error("usage: ingest-technology-stack.mts <organisation-slug> <path-to-xlsx>");
  process.exit(2);
}

try {
  const organisation = await prisma.organisation.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!organisation) throw new Error(`no organisation with slug "${slug}"`);

  // Attributed to an administrator of that organisation, because
  // `Document.uploadedById` is what the workers book model spend against and
  // "whoever submits the work owns what it costs".
  const admin = await prisma.membership.findFirst({
    where: { organisationId: organisation.id, role: "owner" },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (!admin) throw new Error(`${slug} has no administrator to attribute this to`);

  const resolved = path.resolve(process.cwd(), file);
  const bytes = await readFile(resolved);
  console.log(`\n  ${organisation.name}  ←  ${path.basename(resolved)} (${bytes.byteLength} bytes)`);
  console.log(`  as ${admin.user?.email}\n`);

  const { document, duplicate } = await record({
    organisationId: organisation.id,
    userId: admin.userId,
    role: "reference",
    projectId: null,
    bytes,
    fileName: path.basename(resolved),
    format: { mimeType: XLSX_MIME, extension: "xlsx" },
  });

  if (duplicate) {
    // The ordinary reason to be here: the file was uploaded before the parser
    // learned to read a technology stack, so it sits in the library as a
    // reference document that yielded no clauses — present, ready, and
    // measuring nothing. Content-addressed intake will not ingest it again, so
    // the only way forward is to re-queue the parse, exactly as the Re-process
    // button does.
    console.log(`  already on record as ${document.id} — re-queueing the parse`);
    await prisma.$transaction(async (tx) => {
      // Deleting the jobs would delete a waiting analyse job too, and a run
      // left "queued" without one is never picked up while still holding the
      // document's live-run slot. Stop those runs and say why, as
      // `reprocessDocument` does.
      await tx.assessmentRun.updateMany({
        where: { documentId: document.id, state: { in: ["queued", "running"] } },
        data: {
          state: "failed",
          failureReason:
            "Stopped because the document was re-processed. Assess it again once it has been read.",
          completedAt: new Date(),
        },
      });
      await tx.job.deleteMany({ where: { documentId: document.id } });
      await tx.document.update({
        where: { id: document.id },
        data: { status: "pending", failureReason: null },
      });
      await tx.job.create({
        data: {
          organisationId: organisation.id,
          documentId: document.id,
          stage: "parse",
          correlationId: randomUUID(),
        },
      });
    });
    console.log("");
  } else {
    console.log(`  recorded as ${document.id}, parse queued\n`);
  }

  // ---- wait for the workers -------------------------------------------
  const deadline = Date.now() + 10 * 60_000;
  let state = document.status;
  let lost = 0;
  while (Date.now() < deadline) {
    try {
      const row = await prisma.document.findUnique({
        where: { id: document.id },
        select: { status: true, role: true, failureReason: true },
      });
      if (!row) throw new Error("the document disappeared while it was being read");
      state = row.status;
      if (state === "ready" || state === "failed") {
        console.log(`  ${state}${row.failureReason ? ` — ${row.failureReason}` : ""}, role "${row.role}"`);
        break;
      }
    } catch (error) {
      // Neon holds a WebSocket and polling one open for minutes drops it. The
      // workers are on their own connections; losing ours says nothing.
      lost += 1;
      if (lost > 20) throw error;
    }
    await new Promise((r) => setTimeout(r, 8000));
  }

  // ---- what it actually produced ---------------------------------------
  const technologies = await prisma.technology.groupBy({
    by: ["status"],
    where: { documentId: document.id },
    _count: true,
  });
  const total = technologies.reduce((n, row) => n + row._count, 0);
  console.log(`\n  ${total} technologies\n`);
  for (const row of technologies.sort((a, b) => b._count - a._count)) {
    console.log(`     ${row.status.padEnd(8)} ${row._count}`);
  }

  const held = await prisma.technology.findMany({
    where: { documentId: document.id, status: "hold" },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 8,
  });
  if (held.length) {
    console.log("\n  on hold, which is what a design naming one has to answer for:");
    for (const row of held) console.log(`     ${row.name}`);
  }

  const clauses = await prisma.clause.count({
    where: { section: { documentId: document.id } },
  });
  console.log(
    `\n  ${clauses} clauses — a stack states no rules, so a design is never ` +
      "measured against it directly.\n",
  );
} finally {
  await prisma.$disconnect();
}
