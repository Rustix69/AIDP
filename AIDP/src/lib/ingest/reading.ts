import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Access } from "@/lib/access/gate";
import {
  RequestRefused,
  canEditRequest,
  takesDesigns,
  updateRequest,
  type UpdateInput,
} from "@/lib/ingest/requests";
import { assessableDesigns } from "@/lib/ingest/projects";
import {
  READABLE,
  READABLE_FIELDS,
  isReadableField,
  isReadingState,
  type Proposal,
  type ReadableField,
  type ReadingState,
} from "@/lib/ingest/reading-vocabulary";

/**
 * Reading the attached designs for the answers the form is about to ask for.
 *
 * The brief says Group C is "auto-extracted from the diagram and shown for
 * confirmation". This is that, widened to every design in the request rather
 * than the diagram alone — a requestor who attached a twelve-page solution
 * document and a picture has stated the hosting environment in one of them, and
 * which one is not a distinction worth making them think about.
 *
 * ## Three rules
 *
 * **A reading proposes and a person accepts.** Nothing written here is read by
 * the significance check, by the renderer, or by the report. Accepting is what
 * writes the answer, and it writes it through `updateRequest` — the same door
 * the wizard types into, with the same trimming, the same limits and the same
 * refusals. Two writers that could disagree about what a stored answer looks
 * like is the trap intake.ts and requests.ts are both built to avoid.
 *
 * **It runs where the model keys are.** The reading is one model call over the
 * design text, and the analyse worker already holds a provider key, a long
 * lease, usage accounting and a retry policy. So it is queued as an analyse job
 * carrying a `requestId`, exactly as a clause draft is queued carrying a
 * `draftId` — see the note on `draftId` in standards.ts, whose reasoning is
 * this one word for word: a fifth container for a single call would idle.
 *
 * **A stale reading is worse than none.** The row is keyed one-per-request and
 * replaced rather than appended to, and it records which designs it read. Add a
 * design after a reading and the reading is about a submission that no longer
 * exists, which the screen says rather than quietly showing yesterday's answers
 * beside today's documents.
 */

export class ReadingRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadingRefused";
  }
}

export const READING = "reading";
export const READY = "ready";
export const FAILED = "failed";

/** A proposal that survived the worker's checks, as a reader meets it. */
export type ReadingView = {
  id: string;
  state: ReadingState;
  proposals: Proposal[];
  acceptedFields: ReadableField[];
  /** True when designs have been added or removed since this was read. */
  stale: boolean;
  model: string | null;
  error: string | null;
  requestedByName: string;
  createdAt: Date;
  updatedAt: Date;
};

/** The stored JSON, which arrives as `unknown` and is never trusted.
 *
 *  Checked rather than cast. The worker writes this column and the worker is a
 *  different language in a different process: a field it no longer emits, or a
 *  shape an older version wrote, must read as "no proposal" instead of
 *  reaching the wizard as `undefined` and rendering as the word "undefined" in
 *  a box somebody then submits. */
function toProposals(stored: unknown): Proposal[] {
  if (!Array.isArray(stored)) return [];
  const out: Proposal[] = [];
  const seen = new Set<string>();
  for (const entry of stored) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const field = row.field;
    if (!isReadableField(field) || seen.has(field)) continue;

    const shape = READABLE[field].shape;
    const rawValue = row.value;
    let value: string[] | string;
    if (shape === "list") {
      if (!Array.isArray(rawValue)) continue;
      value = rawValue.map((item) => String(item ?? "").trim()).filter(Boolean);
      if (value.length === 0) continue;
    } else {
      value = String(rawValue ?? "").trim();
      // A "yes" carries its detail or nothing; the answer is the boolean. Every
      // other shape is the text itself, and an empty one is not a proposal.
      if (shape === "text" && !value) continue;
    }

    const quote = String(row.quote ?? "").trim();
    // The quote is what makes the proposal reviewable at a glance. Without one
    // there is nothing to accept on but the model's word, which is the thing
    // this product does not ask anyone to do.
    if (!quote) continue;

    const page = Number(row.page);
    seen.add(field);
    out.push({
      field,
      value,
      documentId: String(row.documentId ?? ""),
      documentTitle: String(row.documentTitle ?? ""),
      section: String(row.section ?? "").trim(),
      page: Number.isFinite(page) && page > 0 ? page : null,
      quote,
    });
  }
  return out;
}

function toFields(stored: string[]): ReadableField[] {
  return stored.filter(isReadableField);
}

/**
 * The reading for this request, or null when none has been made.
 *
 * `stale` is worked out here rather than stored, because it is a comparison
 * between two things that both move: what the reading read, and what the
 * request now carries. Storing it would mean writing to the reading every time
 * a design is uploaded, which is a write on a row nobody asked about.
 */
export async function readingFor(
  organisationId: string,
  requestId: string,
  designIds: string[],
): Promise<ReadingView | null> {
  const row = await prisma.intakeReading.findFirst({
    where: { requestId, organisationId },
  });
  if (!row) return null;

  const state = isReadingState(row.state) ? row.state : FAILED;
  const read = new Set(row.readDocumentIds);
  const now = new Set(designIds);
  const stale =
    state === READY &&
    (read.size !== now.size || designIds.some((id) => !read.has(id)));

  return {
    id: row.id,
    state,
    proposals: toProposals(row.proposals),
    acceptedFields: toFields(row.acceptedFields),
    stale,
    model: row.model,
    error: row.error,
    requestedByName: row.requestedByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The designs a reading may be made from: attached, finished, and with
 *  something indexed in them. The rendered answers are excluded by the caller,
 *  as they are everywhere else — reading the form back to itself would propose
 *  the answers it was built from. */
async function readable(organisationId: string, request: { projectId: string; documentId: string | null }) {
  const attached = await assessableDesigns(organisationId, request.projectId);
  return attached.filter(
    (design) =>
      design.id !== request.documentId &&
      design.status === "ready" &&
      design._count.chunks > 0,
  );
}

/**
 * Read the attached designs, and put the answers in front of the requestor.
 *
 * Refuses rather than queues when there is nothing to read: a job that can only
 * fail costs a worker a model key's worth of nothing and tells the person
 * waiting even less.
 */
export async function startReading(
  access: Access,
  requestId: string,
): Promise<{ state: ReadingState; designs: number }> {
  const request = await prisma.architectureRequest.findFirst({
    where: { id: requestId, organisationId: access.organisation.id },
    select: { id: true, projectId: true, documentId: true, state: true, requestedById: true },
  });
  if (!request) throw new ReadingRefused("That request does not exist.");

  if (!canEditRequest(access, request)) {
    throw new ReadingRefused(
      "This request belongs to a colleague. Only they, or an administrator, can fill it in.",
    );
  }
  // The same window designs may be added in, and for the same reason: once a
  // request is submitted its answers are the thing that was assessed, and
  // proposing new ones would invite somebody to change them afterwards.
  if (!takesDesigns(request.state)) {
    throw new ReadingRefused(
      "This request has been submitted, so its answers are now the thing that was assessed.",
    );
  }

  const designs = await readable(access.organisation.id, request);
  if (designs.length === 0) {
    throw new ReadingRefused(
      "Attach a design or a diagram first, and wait for it to finish being read.",
    );
  }

  const existing = await prisma.intakeReading.findUnique({
    where: { requestId },
    select: { id: true, state: true },
  });
  // Already on the queue. Returned rather than refused: the button was pressed
  // twice, which is not an error, and a second job would read the same designs
  // with the same key for the same answers.
  if (existing?.state === READING) return { state: READING, designs: designs.length };

  await prisma.$transaction(async (tx) => {
    await tx.intakeReading.upsert({
      where: { requestId },
      create: {
        organisationId: access.organisation.id,
        requestId,
        state: READING,
        readDocumentIds: designs.map((design) => design.id),
        requestedById: access.user.id,
        requestedByName: access.user.name || access.user.email,
      },
      // Replaced, not appended to. The previous proposals were about the
      // designs as they were; `acceptedFields` goes with them, because what a
      // person accepted from a reading that no longer exists is not a claim
      // this row can keep making.
      update: {
        state: READING,
        proposals: [],
        acceptedFields: [],
        readDocumentIds: designs.map((design) => design.id),
        model: null,
        error: null,
        requestedById: access.user.id,
        requestedByName: access.user.name || access.user.email,
      },
    });

    await tx.job.create({
      data: {
        organisationId: access.organisation.id,
        // Null for the reason spelled out on the clause-draft job in
        // standards.ts: `job_live_document_stage_idx` is unique per live
        // (documentId, stage), and this job is about a request rather than any
        // one of its designs. Naming a design here would collide with that
        // design's own work.
        documentId: null,
        stage: "analyse",
        correlationId: randomUUID(),
        // The questions travel with the job. The worker lists none of its own,
        // so the catalogue has one definition — reading-vocabulary.ts — rather
        // than a second copy in Python that drifts the first time a question is
        // reworded. A job queued before a wording change still asks what it was
        // queued to ask, which is the right answer for a reading somebody is
        // already waiting on.
        payload: {
          requestId,
          questions: READABLE_FIELDS.map((field) => ({
            field,
            shape: READABLE[field].shape,
            looksFor: READABLE[field].looksFor,
          })),
        },
      },
    });
  });

  return { state: READING, designs: designs.length };
}

/**
 * Write the proposals the requestor accepted onto the request itself.
 *
 * Through `updateRequest`, so an accepted answer is stored exactly as a typed
 * one — trimmed, capped, de-duplicated, and refused on the same grounds. From
 * the moment this returns there is no such thing as an extracted answer: there
 * is the request, and there is a note on the reading saying where six of its
 * answers came from.
 */
export async function acceptProposals(
  access: Access,
  requestId: string,
  fields: string[],
): Promise<{ accepted: ReadableField[] }> {
  const wanted = fields.filter(isReadableField);
  if (wanted.length === 0) throw new ReadingRefused("Nothing was selected.");

  const row = await prisma.intakeReading.findFirst({
    where: { requestId, organisationId: access.organisation.id },
    select: { id: true, state: true, proposals: true, acceptedFields: true },
  });
  if (!row || row.state !== READY) {
    throw new ReadingRefused("There is nothing to accept — read the designs first.");
  }

  const proposals = toProposals(row.proposals);
  const chosen = proposals.filter((proposal) => wanted.includes(proposal.field));
  if (chosen.length === 0) {
    throw new ReadingRefused("Those answers are no longer in this reading.");
  }

  const input: UpdateInput = {};
  for (const proposal of chosen) {
    const spec = READABLE[proposal.field];
    if (spec.shape === "list") {
      input.technologies = Array.isArray(proposal.value) ? proposal.value : [];
      continue;
    }
    if (spec.shape === "text") {
      // Narrow to the text fields. A `Record<string, unknown>` cast here would
      // compile and would also accept a field name that is not one of these.
      (input as Record<string, unknown>)[proposal.field] = String(proposal.value);
      continue;
    }
    // A "yes" sets the flag, and its detail when the design named one. The
    // worker never proposes a "no", so there is no branch for one.
    (input as Record<string, unknown>)[proposal.field] = true;
    if (spec.detail && proposal.value) {
      (input as Record<string, unknown>)[spec.detail] = String(proposal.value);
    }
  }

  // `updateRequest` carries the editing rules — who may, and in which states —
  // so they are not restated here and cannot drift from the wizard's.
  await updateRequest(access, requestId, input);

  const accepted = Array.from(
    new Set([...toFields(row.acceptedFields), ...chosen.map((p) => p.field)]),
  );
  await prisma.intakeReading.update({
    where: { id: row.id },
    data: { acceptedFields: accepted },
  });

  return { accepted: chosen.map((proposal) => proposal.field) };
}

/** Throw the reading away. For a requestor who would rather answer the
 *  questions themselves than read six proposals they have already rejected. */
export async function discardReading(access: Access, requestId: string): Promise<void> {
  const request = await prisma.architectureRequest.findFirst({
    where: { id: requestId, organisationId: access.organisation.id },
    select: { id: true, requestedById: true },
  });
  if (!request) throw new ReadingRefused("That request does not exist.");
  if (!canEditRequest(access, request)) {
    throw new ReadingRefused("This request belongs to a colleague.");
  }
  await prisma.intakeReading.deleteMany({ where: { requestId, organisationId: access.organisation.id } });
}

export { RequestRefused };
