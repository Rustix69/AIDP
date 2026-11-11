/**
 * The reading end to end: a real design, a real worker, a real model call.
 *
 * verify-intake-reading.mts owns the gate and the accept path and needs no
 * model. This is the other half — the one that cannot be faked and is the only
 * way to see what the prompt actually produces: queue a reading over a design
 * that is really in the index, let the analyse worker pick it up, and look at
 * what comes back.
 *
 * What it asserts is deliberately not "the model got the right answer". It is:
 *
 *   - the job is claimed and the reading leaves "reading";
 *   - every proposal names a field that was asked for;
 *   - every proposal carries a quote, and that quote is really in the design it
 *     is attributed to — checked here, independently of the worker's own check,
 *     because that check is the one thing standing between a model's guess and
 *     a form somebody signs;
 *   - no yes/no answer came back as "no".
 *
 * An existing indexed design is copied — row, sections, lines and chunks —
 * into a throwaway organisation, so nothing real is touched and the whole
 * fixture goes at the end. Needs a live analyse worker and a model key.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/verify-intake-reading-live.mts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { OWNER } from "../src/lib/access/roles";
import { createRequest } from "../src/lib/ingest/requests";
import { readingFor, startReading } from "../src/lib/ingest/reading";
import { READABLE, type ReadableField } from "../src/lib/ingest/reading-vocabulary";
import type { Access } from "../src/lib/access/gate";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean, extra?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

/**
 * Words only, lower-cased, single-spaced.
 *
 * Punctuation is dropped rather than matched because the quote and the document
 * reach this point through different renderings — a quote is stitched back
 * together from the passages it spans, and a table line carries the column
 * structure the parse gave it. Comparing words is what makes "is this really in
 * the document" the question being asked, instead of "did two renderers agree
 * about a dash".
 */
const words = (value: string) =>
  (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .match(/[a-z0-9]+(?:['’][a-z0-9]+)*/g)
    ?.join(" ") ?? "";

/**
 * Is every part of this quote in the text, in order?
 *
 * Written here rather than imported, deliberately: the worker's own check is
 * the thing under test, and verifying it with itself would assert nothing. The
 * rule it is reproducing is Workers/aidp/whole_document.py's `contains` — a
 * quote may span passages, the gaps are marked with an ellipsis, and each part
 * has to appear as whole words after the one before it.
 */
function quoted(haystack: string, quote: string): boolean {
  const parts = quote
    .split(/\.\.\.|…/)
    .map(words)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return false;
  const padded = ` ${haystack} `;
  let position = 0;
  for (const part of parts) {
    const found = padded.indexOf(` ${part} `, position);
    if (found === -1) return false;
    position = found + part.length + 1;
  }
  return true;
}

const tag = randomUUID().slice(0, 8);
const organisationId = `org-live-${tag}`;
const userId = `user-live-${tag}`;

async function main() {
  // The richest indexed design available: the more it says, the more of the
  // prompt's rules get exercised in one call.
  const source = await prisma.document.findFirst({
    where: { role: "assessed", status: "ready", sourceLines: { some: {} } },
    select: { id: true, title: true, mimeType: true, _count: { select: { sourceLines: true } } },
    orderBy: { sourceLines: { _count: "desc" } },
  });
  if (!source) {
    console.log("no indexed design in this database to read — nothing to verify");
    return;
  }
  console.log(`reading "${source.title}" (${source._count.sourceLines} lines)\n`);

  await prisma.organisation.create({
    data: { id: organisationId, name: `Live reading ${tag}`, slug: `live-${tag}` },
  });
  await prisma.user.create({
    data: {
      id: userId,
      name: "Dana Kim",
      email: `dana-live-${tag}@example.test`,
      company: "Live reading",
      country: "GB",
      phone: "0",
    },
  });
  await prisma.membership.create({ data: { organisationId, userId, role: OWNER } });

  const access = {
    user: { id: userId, name: "Dana Kim", email: `dana-live-${tag}@example.test` },
    organisation: { id: organisationId, name: `Live reading ${tag}`, role: OWNER },
  } as unknown as Access;

  const { id: requestId } = await createRequest(access, { title: "Live reading check" });
  const request = await prisma.architectureRequest.findUniqueOrThrow({ where: { id: requestId } });

  // The design, copied into the throwaway organisation's project. Sections and
  // lines are what the reading is built from; the chunks exist only so the
  // app's "has this been indexed" precondition is satisfied honestly.
  const copy = await prisma.document.create({
    data: {
      organisationId,
      projectId: request.projectId,
      role: "assessed",
      title: source.title,
      storageKey: `verify/${randomUUID()}`,
      mimeType: source.mimeType,
      byteSize: 1,
      sha256: randomUUID(),
      status: "ready",
      uploadedById: userId,
    },
    select: { id: true, title: true },
  });

  const sections = await prisma.documentSection.findMany({
    where: { documentId: source.id },
    orderBy: { ordinal: "asc" },
  });
  await prisma.documentSection.createMany({
    data: sections.map((section) => ({
      documentId: copy.id,
      ordinal: section.ordinal,
      numberText: section.numberText,
      title: section.title,
      headingPath: section.headingPath,
      pageStart: section.pageStart,
      pageEnd: section.pageEnd,
      isEmpty: section.isEmpty,
    })),
  });

  const lines = await prisma.sourceLine.findMany({
    where: { documentId: source.id },
    orderBy: { ordinal: "asc" },
  });
  await prisma.sourceLine.createMany({
    data: lines.map((line) => ({
      documentId: copy.id,
      ordinal: line.ordinal,
      ref: line.ref,
      page: line.page,
      kind: line.kind,
      text: line.text,
      sectionOrdinal: line.sectionOrdinal,
      depth: line.depth,
    })),
  });

  await prisma.chunk.create({
    data: {
      organisationId,
      documentId: copy.id,
      sourceKind: "section",
      ordinal: 0,
      headingPath: "",
      text: "indexed",
      contentHash: randomUUID(),
    },
  });

  console.log(`copied ${sections.length} sections and ${lines.length} lines\n`);

  await startReading(access, requestId);
  ok("the reading was queued", true);

  // Readings are one model call over a long document; a minute is generous and
  // a failure to finish inside it is a failure worth reporting as one.
  const deadline = Date.now() + 180_000;
  let view = await readingFor(organisationId, requestId, [copy.id]);
  while (view?.state === "reading" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    view = await readingFor(organisationId, requestId, [copy.id]);
  }

  ok("it finished", view?.state !== "reading", view?.state);
  if (view?.state === "failed") {
    ok("it did not fail", false, view.error);
  }
  if (view?.state !== "ready") {
    console.log(`\n${passed} passed, ${failed} failed`);
    return;
  }

  console.log(`\n${view.proposals.length} answers proposed, model ${view.model}\n`);
  for (const proposal of view.proposals) {
    const value = Array.isArray(proposal.value) ? proposal.value.join(", ") : proposal.value;
    console.log(`  ${proposal.field}: ${value || "(yes, nothing named)"}`);
    console.log(`      “${proposal.quote.slice(0, 140)}”`);
    console.log(`      ${proposal.documentTitle} · ${proposal.section}\n`);
  }

  // Vacuous success is the failure mode this script is most likely to have:
  // every assertion below holds trivially over an empty list. A real solution
  // design states its technologies and where it runs, so nothing proposed means
  // the reading is broken — a drifted field name, a prompt the model will not
  // follow, a renderer whose labels do not match what it is asked to cite.
  ok(
    "the design answered at least one question",
    view.proposals.length > 0,
    "nothing was proposed — check the worker log for dropped answers and their reasons",
  );

  const asked = new Set(Object.keys(READABLE));
  ok(
    "every proposal answers a question that was asked",
    view.proposals.every((proposal) => asked.has(proposal.field)),
    view.proposals.map((proposal) => proposal.field),
  );
  ok(
    "every proposal carries a quote",
    view.proposals.every((proposal) => proposal.quote.trim().length > 0),
  );
  ok(
    "every proposal is attributed to a design in this request",
    view.proposals.every((proposal) => proposal.documentId === copy.id),
    view.proposals.map((proposal) => proposal.documentId),
  );

  // The check that matters, run here rather than trusted from the worker: the
  // words a requestor is shown have to be in the document they are told the
  // words came from. Built from the same rows the worker built its copy from.
  const body = words(lines.map((line) => line.text).join(" "));
  const invented = view.proposals.filter((proposal) => !quoted(body, proposal.quote));
  ok(
    "and every quote is really in that design",
    invented.length === 0,
    invented.map((proposal) => `${proposal.field}: ${proposal.quote}`),
  );

  const noes = view.proposals.filter(
    (proposal) =>
      READABLE[proposal.field as ReadableField].shape === "yes" &&
      typeof proposal.value === "string" &&
      /^(no|none|n\/a)$/i.test(proposal.value.trim()),
  );
  ok("no yes/no question came back as 'no'", noes.length === 0, noes);

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("\nthrew:", error);
  })
  .finally(async () => {
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  });
