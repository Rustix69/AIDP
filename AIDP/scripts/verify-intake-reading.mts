/**
 * The diagram branch, and the reading that fills it in — from the app's side.
 *
 * The checks on the model's words are Workers/tests/test_intake_reading.py,
 * which needs neither a database nor a model. This is the half the app owns,
 * and almost all of it is the submission gate, where a mistake is silent:
 * a request waved through on a diagram that was deleted, a proposal accepted
 * onto somebody else's request, a reading that keeps claiming answers for
 * designs it never read.
 *
 * What is asserted here:
 *
 *   1. Group C blocks a submission when there is no diagram — the behaviour
 *      that was there before and must not have moved.
 *   2. A nominated diagram lifts that block, which is the branch that could
 *      never be taken until now because nothing wrote `diagramDocumentId`.
 *   3. A diagram that is no longer attached does not lift it. The column
 *      carries no foreign key on purpose, so a dangling id is the obvious way
 *      this would have gone wrong.
 *   4. Only this request's own designs can be nominated, and never the
 *      rendered answers themselves.
 *   5. `unanswered` says what a diagram-branch submission went in without,
 *      which is what keeps the relaxed gate honest.
 *   6. Accepting a proposal writes the request's real columns, through
 *      `updateRequest`, trimmed and capped exactly as a typed answer is.
 *   7. A reading knows when the designs have moved on under it.
 *
 * No model and no worker: the reading row is written here as the worker would
 * write it, so this runs anywhere a database is reachable. The end-to-end path
 * — queue a job, let the analyse worker read a real design — is
 * verify-request-designs.mts's territory and a live run.
 *
 * Against a throwaway organisation, removed at the end.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/verify-intake-reading.mts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { OWNER } from "../src/lib/access/roles";
import {
  createRequest,
  diagramOf,
  markDiagram,
  unanswered,
  updateRequest,
  whatIsMissing,
} from "../src/lib/ingest/requests";
import { acceptProposals, readingFor, startReading } from "../src/lib/ingest/reading";
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

async function refused(name: string, work: () => Promise<unknown>, expect?: RegExp) {
  try {
    await work();
    ok(name, false, "it was allowed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ok(name, expect ? expect.test(message) : true, message);
  }
}

const tag = randomUUID().slice(0, 8);
const organisationId = `org-intake-${tag}`;
const userId = `user-intake-${tag}`;

async function main() {
  await prisma.organisation.create({
    data: { id: organisationId, name: `Intake reading ${tag}`, slug: `intake-${tag}` },
  });
  await prisma.user.create({
    data: {
      id: userId,
      name: "Dana Kim",
      email: `dana-${tag}@example.test`,
      company: "Intake reading",
      country: "GB",
      phone: "0",
    },
  });
  await prisma.membership.create({
    data: { organisationId, userId, role: OWNER },
  });

  const access = {
    user: { id: userId, name: "Dana Kim", email: `dana-${tag}@example.test` },
    organisation: { id: organisationId, name: `Intake reading ${tag}`, role: OWNER },
  } as unknown as Access;

  const { id: requestId } = await createRequest(access, {
    title: "Customer Portal Upgrade",
  });
  const request = await prisma.architectureRequest.findUniqueOrThrow({
    where: { id: requestId },
  });

  // Groups A and B, so that Group C is the only thing left outstanding and the
  // gate's answer is unambiguous.
  await updateRequest(access, requestId, {
    plannedStart: "2027-03-01",
    problemStatement: "The current portal is out of support.",
    solutionOverview: "A React front end over a Node API.",
  });

  async function design(title: string) {
    return prisma.document.create({
      data: {
        organisationId,
        projectId: request.projectId,
        role: "assessed",
        title,
        storageKey: `verify/${randomUUID()}`,
        mimeType: "application/pdf",
        byteSize: 1,
        sha256: randomUUID(),
        status: "ready",
        uploadedById: userId,
      },
      select: { id: true, title: true },
    });
  }

  const diagram = await design("Portal context diagram.png");
  const other = await design("Portal solution design.pdf");

  async function draft() {
    const row = await prisma.architectureRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    return {
      ...row,
      estimatedCost: row.estimatedCost === null ? null : String(row.estimatedCost),
    };
  }

  console.log("\nthe gate without a diagram");

  let now = await draft();
  let missing = whatIsMissing({ ...now, diagramDocumentId: null });
  ok(
    "every Group C field blocks the submission",
    missing.length === 6 && missing.every((item) => item.startsWith("the ")),
    missing,
  );

  console.log("\nnominating a diagram");

  await markDiagram(access, requestId, diagram.id);
  now = await draft();
  ok("the nomination is stored", now.diagramDocumentId === diagram.id);

  missing = whatIsMissing({
    ...now,
    diagramDocumentId: diagramOf(now, [diagram.id, other.id]),
  });
  ok("and it lifts the Group C block", missing.length === 0, missing);

  ok(
    "what the submission goes in without is still named",
    unanswered(now).length === 6,
    unanswered(now).map((item) => item.field),
  );

  console.log("\nthe nomination is checked, not trusted");

  const elsewhere = await prisma.organisation.create({
    data: { id: `org-other-${tag}`, name: `Other ${tag}`, slug: `other-${tag}` },
  });
  const foreign = await prisma.document.create({
    data: {
      organisationId: elsewhere.id,
      role: "assessed",
      title: "Another customer's diagram.png",
      storageKey: `verify/${randomUUID()}`,
      mimeType: "image/png",
      byteSize: 1,
      sha256: randomUUID(),
      status: "ready",
    },
    select: { id: true },
  });

  await refused(
    "another customer's document cannot be the diagram",
    () => markDiagram(access, requestId, foreign.id),
    /not one of this request's designs/i,
  );

  // The rendered answers are a design by every column that matters. Nominating
  // them would let a request satisfy the diagram rule with the form it is
  // trying to fill in.
  const rendered = await design("AR-0001 Customer Portal Upgrade.docx");
  await prisma.architectureRequest.update({
    where: { id: requestId },
    data: { documentId: rendered.id },
  });
  await refused(
    "the request's own rendered answers cannot be the diagram",
    () => markDiagram(access, requestId, rendered.id),
    /not one of this request's designs/i,
  );
  await prisma.architectureRequest.update({
    where: { id: requestId },
    data: { documentId: null },
  });

  console.log("\na diagram that is no longer attached does not hold the gate open");

  now = await draft();
  ok(
    "a dangling nomination resolves to nothing",
    diagramOf(now, [other.id]) === null,
    now.diagramDocumentId,
  );
  missing = whatIsMissing({ ...now, diagramDocumentId: diagramOf(now, [other.id]) });
  ok("so Group C blocks again", missing.length === 6, missing);

  console.log("\na reading proposes, and accepting writes the answer");

  // Nothing in these fixtures is indexed, so there is genuinely nothing to
  // read — and saying so beats queueing a job that can only fail.
  await refused(
    "a reading is refused while no design has been indexed",
    () => startReading(access, requestId),
    /wait for it to finish being read/i,
  );

  // Written here as the worker writes it, with one proposal per shape.
  await prisma.intakeReading.create({
    data: {
      organisationId,
      requestId,
      state: "ready",
      model: "verify/none",
      requestedByName: "Dana Kim",
      readDocumentIds: [diagram.id, other.id],
      proposals: [
        {
          field: "technologies",
          // Deliberately untidy: blanks, a duplicate and surrounding space, so
          // that the normalisation `updateRequest` applies to a typed answer is
          // visibly applied to an accepted one too.
          value: ["React", " Node.js ", "React", ""],
          documentId: other.id,
          documentTitle: other.title,
          section: "1 Overview",
          page: 1,
          quote: "A React single-page application over a Node.js API.",
        },
        {
          field: "dataClassification",
          value: "Confidential",
          documentId: other.id,
          documentTitle: other.title,
          section: "2 Data",
          page: 2,
          quote: "All customer records are classified Confidential.",
        },
        {
          field: "replacesTechnologyComponent",
          value: "the legacy portal",
          documentId: other.id,
          documentTitle: other.title,
          section: "1 Overview",
          page: 1,
          quote: "This replaces the legacy portal.",
        },
        {
          // No quote: dropped on the way out, because a proposal nobody can
          // check against the design is one a requestor would wave through.
          field: "hostingEnvironment",
          value: "AWS eu-west-1",
          documentId: other.id,
          documentTitle: other.title,
          section: "3 Hosting",
          page: 3,
          quote: "   ",
        },
      ],
    },
  });

  let view = await readingFor(organisationId, requestId, [diagram.id, other.id]);
  ok("the reading reads back", view?.state === "ready");
  ok(
    "a proposal with no quote never reaches the screen",
    view?.proposals.length === 3,
    view?.proposals.map((p) => p.field),
  );
  ok("and it is not stale", view?.stale === false);

  await acceptProposals(access, requestId, [
    "technologies",
    "dataClassification",
    "replacesTechnologyComponent",
  ]);
  now = await draft();

  ok(
    "a list answer is trimmed and de-duplicated as a typed one is",
    JSON.stringify(now.technologies) === JSON.stringify(["React", "Node.js"]),
    now.technologies,
  );
  ok("a text answer is written", now.dataClassification === "Confidential");
  ok(
    "a yes/no answer sets the flag and its detail",
    now.replacesTechnologyComponent === true &&
      now.replacedTechnologyComponentName === "the legacy portal",
    [now.replacesTechnologyComponent, now.replacedTechnologyComponentName],
  );

  view = await readingFor(organisationId, requestId, [diagram.id, other.id]);
  ok(
    "the reading records which answers came from the designs",
    view?.acceptedFields.length === 3,
    view?.acceptedFields,
  );

  // Two of the three accepted answers are Group C fields the gate counts;
  // `replacesTechnologyComponent` is a yes/no about the change rather than one
  // of the six the submission is measured for.
  ok(
    "and the submission now goes in with two fewer blanks",
    unanswered(now).length === 4,
    unanswered(now).map((item) => item.field),
  );

  console.log("\na reading knows when the designs have moved on");

  const third = await design("Integration note.pdf");
  view = await readingFor(organisationId, requestId, [diagram.id, other.id, third.id]);
  ok("attaching a design makes the reading stale", view?.stale === true);

  console.log("\nrefusals");

  await refused(
    "a field that was never proposed cannot be accepted",
    () => acceptProposals(access, requestId, ["authMechanism"]),
    /no longer in this reading/i,
  );
  await refused(
    "and neither can a field that is not a question",
    () => acceptProposals(access, requestId, ["estimatedCost"]),
    /nothing was selected/i,
  );

  // Submitted requests stop taking readings for the same reason they stop
  // taking designs: the answers are the thing that was assessed.
  await prisma.architectureRequest.update({
    where: { id: requestId },
    data: { state: "reported" },
  });
  await refused(
    "a submitted request cannot be read again",
    () => startReading(access, requestId),
    /has been submitted/i,
  );
  await refused(
    "nor can its diagram be changed",
    () => markDiagram(access, requestId, other.id),
    /has been submitted/i,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("\nthrew:", error);
  })
  .finally(async () => {
    await prisma.organisation.deleteMany({
      where: { id: { in: [organisationId, `org-other-${tag}`] } },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
  });
