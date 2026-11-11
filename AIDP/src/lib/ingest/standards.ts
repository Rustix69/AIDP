import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireMembership } from "./org";
import { canManageStandards } from "@/lib/access/roles";
import {
  CLAUSE_STATUSES,
  CLAUSE_STATUS_META,
  OPEN_DRAFT_STATES,
  isSharpenable,
  mayPublishSeparately,
  readClauseStatus,
  readDraftState,
  readPublishMode,
  type ClauseStatus,
  type DraftState,
  type PublishMode,
} from "./standards-vocabulary";

export {
  CLAUSE_STATUSES,
  CLAUSE_STATUS_META,
  DRAFT_KINDS,
  DRAFT_STATE_META,
  ENFORCED_CLAUSE_STATUSES,
  OPEN_DRAFT_STATES,
  PUBLISH_MODES,
  PUBLISH_MODE_META,
  SHARPENABLE,
  isEnforced,
  isSharpenable,
  mayPublishSeparately,
  readClauseStatus,
  readDraftState,
  readPublishMode,
  readSourceVerdict,
  type ClauseStatus,
  type DraftKind,
  type DraftState,
  type PublishMode,
} from "./standards-vocabulary";

/**
 * Sharpening a clause from a confirmed `partial`.
 *
 * The third way into the standards library, beside the parser and
 * `restoreRule`. A `partial` verdict means the clause could not be judged:
 * "ensure resilience" against a design that retries without a dead-letter path
 * is partial for ever, because the clause never said what the rest was. The
 * reviewer who confirmed that verdict knows what it meant; this is the path
 * from knowing it to the library saying it.
 *
 * Three rules everything here keeps:
 *
 *  1. **A clause is never edited in place.** The old row stays, gains a pointer
 *     to its replacement, and stops being judged — the same reasoning as
 *     `Decision` and `Framework`. A `Finding` denormalises a clause's statement
 *     but not its requirements, so an in-place rewrite would leave last year's
 *     "covered" standing against requirements that exist nowhere.
 *  2. **A model drafts, a person decides.** The worker writes candidate
 *     requirement lines and checks them (Workers/aidp/standards.py); nothing
 *     reaches a clause that a person has not read and approved.
 *  3. **Only additions.** The statement, the rationale and the existing
 *     requirements are carried over untouched. A model permitted to reword the
 *     rule would change what the customer requires, and an approver would have
 *     no way to see that it had.
 */

export type SetAsideLine = { text: string; reason: string };

// The register row a proposal would become. Defined in the vocabulary rather
// than here because the screens that read it are client components and this
// module reaches Prisma — see the note at the top of standards-vocabulary.ts.
export { readEntry, hasEntry, type DraftEntry } from "./standards-vocabulary";
// Re-exported above for the callers that already reach for this module;
// imported here because a re-export does not put the names in scope.
import { readEntry, type DraftEntry } from "./standards-vocabulary";

export type DraftView = {
  id: string;
  clauseId: string;
  clauseRef: string;
  clauseTitle: string;
  /** Null only on a historical adoption proposal — see DRAFT_KINDS. Every
   *  proposal written now comes from a reviewed finding. */
  sourceFindingId: string | null;
  state: DraftState;
  /** The lines proposed, in the words a standard would use. */
  requirements: string[];
  /** The model's one line on what the clause left unsaid. */
  note: string;
  model: string | null;
  error: string | null;
  setAside: SetAsideLine[];
  /** The register row this would become — see DraftEntry. */
  entry: DraftEntry;
  appliedClauseId: string | null;
  requestedByName: string;
  approvedByName: string;
  approvedAt: Date | null;
  publishedByName: string;
  publishedAt: Date | null;
  /** The verdict this was drafted from, and the design it was found on. The
   *  register is read away from the report, so it has to carry its own case. */
  sourceVerdict: string;
  sourceDesignTitle: string | null;
  /** How it was published, once it has been. Empty until then. */
  publishMode: string;
  createdAt: Date;
  /** The requirements the clause has today, to show the proposal beside them. */
  existing: string[];
  /** What the clause states today. The starting point when a contradiction is
   *  published as a rule of its own, which needs a statement that is not a
   *  copy of the one it stands beside. */
  clauseStatement: string;
  /**
   * Active decisions anchored to this clause's reference.
   *
   * The hole this closes: the worker matches decisions on `clauseRef`, not on a
   * clause id, so every ruling on §9.3 carries straight over to a sharpened
   * §9.3 — including one recorded against the *vaguer* wording. Sharpen the
   * clause and an older "this satisfies it" would quietly excuse the new
   * requirement. Named here so the approver sees what they are about to leave
   * standing.
   */
  decisionsInTheWay: { id: string; title: string; effect: string }[];
};

const SELECT = {
  id: true,
  clauseId: true,
  clauseRef: true,
  clauseTitle: true,
  sourceFindingId: true,
  state: true,
  requirements: true,
  note: true,
  model: true,
  error: true,
  setAside: true,
  entry: true,
  sourceVerdict: true,
  publishMode: true,
  appliedClauseId: true,
  requestedByName: true,
  approvedByName: true,
  approvedAt: true,
  publishedByName: true,
  publishedAt: true,
  createdAt: true,
} as const;

/** Read defensively: a malformed entry is dropped, never guessed at. */
export function readSetAside(value: unknown): SetAsideLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.text !== "string" || typeof row.reason !== "string") return [];
    return [{ text: row.text, reason: row.reason }];
  });
}


/**
 * The register row a clause came from, read off its `sourceRefs`.
 *
 * The mirror of `register_of` in Workers/aidp/standards.py, and deliberately
 * the same two places: `register` where the parser wrote it, and
 * `inherited.register` for a clause published before that block was preserved.
 * Returns null for a clause parsed from prose, which has no register row and
 * must not be given one.
 */
export function registerBlock(
  sourceRefs: unknown,
): Record<string, unknown> | null {
  if (!sourceRefs || typeof sourceRefs !== "object") return null;
  const refs = sourceRefs as Record<string, unknown>;
  const direct = refs.register;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  const inherited = refs.inherited;
  if (inherited && typeof inherited === "object" && !Array.isArray(inherited)) {
    const nested = (inherited as Record<string, unknown>).register;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return null;
}

/** The clause reference, which comes from the section rather than the clause. */
function refOf(section: { numberText: string | null; headingPath: string }): string {
  return section.numberText || section.headingPath || "";
}

export class NotSharpenable extends Error {}

/**
 * Deciding what the library requires is the administrator's, always.
 *
 * The same policy `guardStandards` applies to uploading, deleting and
 * re-parsing a reference document, and for the same reason: whoever decides
 * what the library requires decides every verdict the product will produce for
 * this customer. A member must not be able to add a requirement to the standard
 * they are about to be judged by — or, worse, to the one they have just been
 * judged by.
 *
 * Note where this now sits. *Proposing* a standard from a finding is open to
 * any member, because the reviewer reading the breach is the one who knows what
 * the clause should have said; a proposal lands in the register as pending and
 * binds nothing. Approving it and publishing it are checked with this, and both
 * are checked here rather than only in the action, because a Server Action
 * accepts a direct POST and this module is the thing that writes.
 */
const REFUSED =
  "Only an administrator can change the standards. You can confirm the finding without it.";

/**
 * Ask for the requirement lines a clause was missing.
 *
 * Refuses more than it accepts, on purpose. A sharpening rests entirely on one
 * reviewer having agreed with one verdict, so every part of that has to be true
 * before a model is paid to write anything.
 */
export async function requestDraft(
  userId: string,
  findingId: string,
  requestedByName: string,
): Promise<{ id: string; state: DraftState }> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    select: {
      id: true,
      clauseId: true,
      clauseRef: true,
      clauseTitle: true,
      verdict: true,
      reviewerState: true,
      evidence: true,
      run: { select: { id: true, organisationId: true, documentId: true } },
    },
  });
  if (!finding) throw new NotSharpenable("That finding no longer exists.");

  const organisationId = finding.run.organisationId;
  // Membership, and nothing more. Proposing a standard is not changing one:
  // this queues a draft that lands in the register as *pending*, and an
  // administrator is still the only person who can approve it or publish it.
  //
  // It used to be administrator-only, which put the gate in the wrong place. A
  // reviewer working the findings queue is the person who has just read the
  // breach and knows what the clause should have said; making them ask somebody
  // else to press the button meant the knowledge was lost between the two.
  await requireMembership(userId, organisationId);

  if (!isSharpenable(finding.verdict)) {
    throw new NotSharpenable(
      "A standard can only be drafted from a partial or a contradiction. Those are the two " +
        "verdicts that say something about the wording of the clause; the rest are arguments " +
        "about the design.",
    );
  }
  // Not from a finding somebody has rejected. An override says the engine got
  // this wrong, and drafting a rule on the strength of a verdict the reviewer
  // threw out would write the model's mistake into the library.
  //
  // Pending is allowed, which is the change the three-action review needed: a
  // reviewer reading a breach may well decide the right answer is a sharper
  // rule rather than a decision about this design, and making them confirm the
  // finding first forced a judgement they had not reached.
  if (finding.reviewerState === "overridden") {
    throw new NotSharpenable(
      "This finding has been rejected, so there is nothing to draft from. A standard is only " +
        "written from a finding that stands.",
    );
  }

  const clause = await prisma.clause.findUnique({
    where: { id: finding.clauseId },
    select: {
      id: true,
      supersededById: true,
      section: {
        select: { numberText: true, headingPath: true, document: { select: { organisationId: true } } },
      },
    },
  });
  if (!clause) {
    throw new NotSharpenable(
      "The clause behind this finding is no longer in the library — the standard was re-read since this assessment.",
    );
  }
  // The clause is reached through the finding, which is reached through the run,
  // whose organisation we checked. This closes the remaining gap: a clause that
  // belongs to another customer's document must not be editable from here.
  if (clause.section.document.organisationId !== organisationId) {
    throw new NotSharpenable("That clause belongs to another organisation.");
  }
  if (clause.supersededById) {
    throw new NotSharpenable(
      "That clause has already been replaced by a sharper version. Assess again and start from the new one.",
    );
  }

  // Said here as well as in the worker: paying for a model call that rule 6
  // would refuse every line of is worse than saying so now.
  const cited = Array.isArray(finding.evidence) ? finding.evidence.length : 0;
  if (cited === 0) {
    throw new NotSharpenable(
      "This finding cites no passage of the design, so there is nothing to write a requirement from.",
    );
  }

  const live = await prisma.clauseDraft.findFirst({
    where: { sourceFindingId: findingId, state: { in: ["drafting", "ready"] } },
    select: { id: true, state: true },
  });
  if (live) return { id: live.id, state: readDraftState(live.state) };

  const draftId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.clauseDraft.create({
      data: {
        id: draftId,
        organisationId,
        clauseId: finding.clauseId,
        clauseRef: finding.clauseRef || refOf(clause.section),
        clauseTitle: finding.clauseTitle,
        sourceFindingId: findingId,
        sourceRunId: finding.run.id,
        // Copied now, because this is the moment it is true. The finding may be
        // corrected afterwards, and the proposal has to keep stating the case
        // it was actually written from — it is also what decides how this may
        // be published.
        sourceVerdict: finding.verdict,
        state: "drafting",
        requestedById: userId,
        requestedByName,
      },
    });
    await tx.job.create({
      data: {
        organisationId,
        /**
         * Deliberately null, exactly as a project run's analyse job is.
         *
         * `job_live_document_stage_idx` is UNIQUE (documentId, stage) WHERE the
         * job is live, and it exists so a double-submit cannot queue the same
         * *document* twice. A draft job is not about the design at all: it
         * reads a clause out of a reference standard and the finding's words,
         * and `handle` in Workers/aidp/stages/analyse.py dispatches on
         * `payload.draftId` without ever looking at this column.
         *
         * Carrying the design's id here made it collide with work it has
         * nothing to do with. Two findings on one design sent to decision —
         * ordinary, and now that any member may send a partial or a
         * contradiction, common — and the second one failed on a unique
         * constraint. Worse in the other direction: a draft still queued made
         * "Assess" refuse the design with "Something is already running for
         * this design", which was true of nothing.
         *
         * Postgres treats NULLs as distinct in a unique index, so this is the
         * same escape the project run already uses, for the same reason: the
         * job is found by an id on the payload rather than by a document.
         */
        documentId: null,
        stage: "analyse",
        correlationId: randomUUID(),
        // `runId` so the job reads like every other analyse job in the activity
        // log; `draftId` is what the stage dispatches on.
        payload: { runId: finding.run.id, draftId },
      },
    });
  });

  return { id: draftId, state: "drafting" };
}

/**
 * Active rulings that already excuse this clause, so a reviewer sees them
 * before approving a sharpening that would contradict one.
 */
async function decisionsOn(
  organisationId: string,
  clauseRef: string,
): Promise<{ id: string; title: string; effect: string }[]> {
  if (!clauseRef) return [];
  return prisma.decision.findMany({
    where: {
      organisationId,
      clauseRef,
      status: "active",
      // Only the ones that would excuse the new requirement. A "rejects" or a
      // "context" ruling does not blunt a sharpening, and naming it would be
      // noise in front of the one that does.
      effect: "accepts",
    },
    select: { id: true, title: true, effect: true },
  });
}

/**
 * One stored row as the screens read it.
 *
 * Shared by the report lookup and the register listing below, so the two cannot
 * disagree about what a draft looks like — the register is read away from the
 * report and has to carry the same case the report showed.
 */
function toView(
  row: {
    setAside: unknown;
    entry: unknown;
    state: string;
    clauseRef: string;
    organisationId: string;
    clause?: { requirements: string[]; statement: string } | null;
  } & Record<string, unknown>,
  decisions: { id: string; title: string; effect: string }[],
  designTitle: string | null,
): DraftView {
  // organisationId is destructured away rather than spread into the view: it
  // is on the row for the decisions lookup above and is not part of the shape
  // the screens receive.
  const { organisationId, clause, setAside, entry, state, ...rest } = row;
  void organisationId;
  return {
    // `sourceVerdict` and `publishMode` are in `rest`, straight off the row.
    ...(rest as unknown as Omit<
      DraftView,
      | "state"
      | "setAside"
      | "entry"
      | "existing"
      | "clauseStatement"
      | "decisionsInTheWay"
      | "sourceDesignTitle"
    >),
    state: readDraftState(state),
    setAside: readSetAside(setAside),
    entry: readEntry(entry),
    existing: clause?.requirements ?? [],
    clauseStatement: clause?.statement ?? "",
    decisionsInTheWay: decisions,
    // `sourceVerdict` and `publishMode` come through `rest` from the row: both
    // are stored on the draft precisely so a proposal keeps stating its own
    // case after the finding behind it has moved.
    sourceDesignTitle: designTitle,
  };
}

/** The drafts for a run's findings, by finding id, for the report to show. */
export async function draftsForRun(runId: string): Promise<Map<string, DraftView>> {
  const rows = await prisma.clauseDraft.findMany({
    where: { sourceRunId: runId },
    select: {
      ...SELECT,
      organisationId: true,
      clause: { select: { requirements: true, statement: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const out = new Map<string, DraftView>();
  for (const row of rows) {
    // This map is keyed by finding, for a report that hangs each proposal off
    // the finding it came from. A historical adoption proposal has none — it
    // was raised against a clause in the library, with no design in sight — so
    // it has nowhere to hang and is not part of this view.
    if (!row.sourceFindingId) continue;
    // Newest first, so the first one seen for a finding is the live one and a
    // discarded predecessor does not overwrite it.
    if (out.has(row.sourceFindingId)) continue;
    const state = readDraftState(row.state);
    out.set(
      row.sourceFindingId,
      toView(
        row,
        // Named on anything still awaiting a person, because an "accepts"
        // ruling on this clause reference would carry straight over and excuse
        // the requirement about to be added.
        state === "ready" || state === "approved"
          ? await decisionsOn(row.organisationId, row.clauseRef)
          : [],
        // The report already shows the design this came from — it *is* the
        // design. Only the register needs the title spelled out.
        null,
      ),
    );
  }
  return out;
}

/**
 * A draft as a client component may receive it.
 *
 * `DraftView` carries a Date and a clause id a report has no use for; a Server
 * Component cannot hand either across the boundary, so the report maps through
 * this. Kept beside the view it narrows rather than in the page, because both
 * reports need the same shape.
 */
export type ClientDraft = {
  id: string;
  state: DraftState;
  requirements: string[];
  note: string;
  error: string | null;
  setAside: SetAsideLine[];
  existing: string[];
  decisionsInTheWay: { id: string; title: string; effect: string }[];
};

/**
 * Only a draft still in play reaches the report.
 *
 * `applied` and `discarded` are history: the clause itself says what was added
 * — see `Clause.authoredByName` — and a panel offering to approve something
 * already approved is a bug waiting to be clicked.
 */
export function draftView(draft: DraftView | undefined): ClientDraft | null {
  if (!draft) return null;
  if (draft.state === "applied" || draft.state === "discarded") return null;
  return {
    id: draft.id,
    state: draft.state,
    requirements: draft.requirements,
    note: draft.note,
    error: draft.error,
    setAside: draft.setAside,
    existing: draft.existing,
    decisionsInTheWay: draft.decisionsInTheWay,
  };
}

export class NotApplicable extends Error {}

/** A clause's status could not be changed, with the reason a person reads. */
export class StatusRefused extends Error {}

/**
 * Publish an approved draft into the library: the clause gains the lines, as a
 * new version of itself.
 *
 * The second and irreversible gate. From here the organisation's standard says
 * something it did not say before, every assessment from now on is measured
 * against it, and the previous wording is superseded rather than deleted — a
 * report written last year has to keep meaning what it meant.
 *
 * `requirements` is what the approver settled on, not what the model wrote —
 * they may have edited the wording or dropped a line, and what a person
 * published is what binds.
 */
export async function applyDraft(
  userId: string,
  draftId: string,
  requirements: string[],
  authoredByName: string,
  options: {
    /** "sharpen" replaces the clause with a sharper version of itself;
     *  "separate" adds a new clause beside it and leaves the original standing.
     *  Only a contradiction may ask for the second — see PUBLISH_MODES. */
    mode?: string;
    /** The new clause's own title, statement and rationale, for "separate"
     *  only. A new rule has to say what it is; it is not a version of the old
     *  one. Omitted means "take what the worker drafted" — see the entry
     *  fallback below — not "leave it blank". */
    title?: string;
    statement?: string;
    rationale?: string;
  } = {},
): Promise<{ clauseId: string; added: number; mode: PublishMode }> {
  const draft = await prisma.clauseDraft.findUnique({
    where: { id: draftId },
    select: {
      id: true,
      organisationId: true,
      clauseId: true,
      state: true,
      sourceFindingId: true,
      sourceRunId: true,
      sourceVerdict: true,
      entry: true,
    },
  });
  if (!draft) throw new NotApplicable("That proposal no longer exists.");
  const membership = await requireMembership(userId, draft.organisationId);
  if (!canManageStandards(membership.role)) throw new NotApplicable(REFUSED);

  // The second gate. A draft reaches the library only from "approved", so the
  // sentence has been read and agreed by somebody before this supersedes a live
  // clause — see `approveDraft` on why the two are separate acts.
  if (draft.state !== "approved") {
    throw new NotApplicable(
      draft.state === "applied"
        ? "That proposal has already been added to the standard."
        : draft.state === "ready"
          ? "Approve this proposal first. Publishing supersedes a live clause and changes what " +
            "every assessment from now on is measured against, so it is a second decision."
          : "That proposal is not ready to be published.",
    );
  }

  // Refused rather than quietly downgraded when a partial asks to be published
  // as a separate clause: the caller asked for something specific and getting
  // the other one without being told is how a library gains a rule nobody
  // intended. `readPublishMode` already refuses it, so this says why.
  if (options.mode === "separate" && !mayPublishSeparately(draft.sourceVerdict)) {
    throw new NotApplicable(
      "This was drafted from a partial, which means the clause could not be judged as " +
        "written — so the clause is what changes. Only a contradiction can produce a second, " +
        "separate rule.",
    );
  }
  const mode = readPublishMode(options.mode, draft.sourceVerdict);

  const added = requirements
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .slice(0, 3);
  if (added.length === 0) {
    throw new NotApplicable("Keep at least one requirement, or discard the proposal.");
  }

  const clause = await prisma.clause.findUnique({
    where: { id: draft.clauseId },
    select: {
      id: true,
      sectionId: true,
      title: true,
      statement: true,
      rationale: true,
      requirements: true,
      guidance: true,
      pageStart: true,
      pageEnd: true,
      origin: true,
      sourceRefs: true,
      supersededById: true,
      status: true,
    },
  });
  if (!clause) throw new NotApplicable("That clause is no longer in the library.");
  if (clause.supersededById) {
    throw new NotApplicable(
      "Somebody has already replaced that clause. Reload the report and start from the new one.",
    );
  }

  /**
   * A separate clause is a new rule, so it needs its own words.
   *
   * It cannot inherit the original's statement: two live clauses in one section
   * saying the same sentence and requiring different things is a library nobody
   * can read, and it is exactly the shape that makes a future assessment judge
   * the same subject twice and disagree with itself. The model only ever writes
   * requirement lines — by design, so it cannot reword what the customer
   * requires — so the person publishing supplies the statement.
   */
  const entry = readEntry(draft.entry);
  // The register row the parent sits in, if it sits in one. Read from the
  // clause rather than from the draft, because the draft states what was true
  // when it was asked for and this has to state what is true now.
  const register = registerBlock(clause.sourceRefs);

  // What the approver settled on, falling back to what the worker drafted.
  //
  // The fallback is not a convenience. The approver edits these in a form that
  // arrives pre-filled from the entry, so an untouched field comes back as the
  // drafted text and a cleared one comes back empty — but a call that does not
  // know about the entry at all sends neither, and taking the drafted row there
  // is what stops a publish producing the orphan clause this was added to
  // prevent.
  const title = (options.title ?? entry.title).replace(/\s+/g, " ").trim().slice(0, 200);
  const statement = (options.statement ?? entry.statement).trim().slice(0, 2000);
  const rationale = (options.rationale ?? entry.rationale).trim().slice(0, 2000);
  if (mode === "separate" && !statement) {
    throw new NotApplicable(
      "A separate rule needs a statement of its own. Say what it requires, in the words the " +
        "standard would use.",
    );
  }

  const newId = randomUUID();
  await prisma.$transaction(async (tx) => {
    // Appended rather than inserted at the old ordinal, exactly as a restored
    // rule is. The clause reference comes from the section, so the sharper
    // version keeps it either way, and appending means the partial unique index
    // never sees two live clauses at one ordinal mid-transaction.
    const last = await tx.clause.findFirst({
      where: { sectionId: clause.sectionId },
      orderBy: { ordinal: "desc" },
      select: { ordinal: true },
    });

    await tx.clause.create({
      data: {
        id: newId,
        sectionId: clause.sectionId,
        ordinal: (last?.ordinal ?? 0) + 1,
        title: mode === "separate" ? title || clause.title : clause.title,
        // Sharpening: untouched, all three, and only the requirements grow —
        // see rule 3 at the top. Separate: the new rule's own words, and only
        // the new lines, because the originals stay where they are on a clause
        // that is still live.
        statement: mode === "separate" ? statement : clause.statement,
        rationale: mode === "separate" ? rationale : clause.rationale,
        requirements: mode === "separate" ? added : [...clause.requirements, ...added],
        guidance: clause.guidance,
        pageStart: clause.pageStart,
        pageEnd: clause.pageEnd,
        // "register" where the rule it came from was a register row, so the
        // library keeps reading it as one. Flipping every published clause to
        // "authored" was how a sharpened DAT-004 stopped looking like the rest
        // of its register: the badge changed, and `register_of` in the worker
        // lost the block it reads the category and the owner from.
        origin: register ? "register" : "authored",
        // Sharpening: carried forward, because this is the same rule said
        // better and the organisation's decision about it has not changed. The
        // default is "accepted", so without this a clause somebody deliberately
        // suspended would quietly rejoin the assessment the moment anybody
        // improved its wording — the same shape as the parsed obligations a
        // sharpening already loses.
        //
        // Separate: a new rule, published by an administrator who means it to
        // apply, so it starts active rather than inheriting a suspension from
        // the clause it was raised beside.
        status: mode === "separate" ? "active" : clause.status,
        sourceRefs: {
          // The parse's own refs for the parts that came from the document, so
          // inherited text can still be traced to its lines. A separate clause
          // inherits no text, so it carries none.
          inherited:
            mode === "separate"
              ? null
              : ((clause.sourceRefs ?? null) as Prisma.InputJsonValue),
          /**
           * The register row, kept at the top level where it was written.
           *
           * Everything that reads one — the worker's `register_of`, and any
           * screen showing a reference, a category or an owner — looks for
           * `sourceRefs.register`. Publishing used to leave only the copy
           * nested under `inherited`, so a sharpened rule lost its category and
           * owner, and a rule published beside one never had them: it landed in
           * the library with no reference at all.
           *
           * A sharpening keeps the parent's reference, because it *is* that
           * rule in a later version. A separate rule carries the one the worker
           * derived beside it — "DAT-004a" — and its register status stays
           * "proposed", because nothing published through here has been
           * through the customer's own standards process. That is the
           * register's own Status column, not Clause.status.
           */
          ...(register
            ? {
                register:
                  mode === "separate" && entry.identifier
                    ? { ...register, id: entry.identifier, status: entry.status || "proposed" }
                    : register,
              }
            : {}),
          // Named differently on purpose: one of these says "this replaced
          // that", the other says "this was written beside that". A reader of
          // the stored refs should not have to guess which happened.
          ...(mode === "separate"
            ? { addedBeside: clause.id }
            : { sharpenedFrom: clause.id }),
          draftId: draft.id,
          addedRequirements: added,
        } as Prisma.InputJsonValue,
        sourceFindingId: draft.sourceFindingId,
        sourceRunId: draft.sourceRunId,
        authoredByName,
        authoredAt: new Date(),
      },
    });

    // Only a sharpening retires the original. "Keep both" leaves it exactly as
    // it is, still live and still judged — that is the whole point of it.
    //
    // Conditional, so two approvals racing make one new version, not two. The
    // loser's update matches nothing and the transaction is rolled back.
    if (mode === "sharpen") {
      const marked = await tx.clause.updateMany({
        where: { id: clause.id, supersededById: null },
        data: { supersededById: newId },
      });
      if (marked.count !== 1) {
        throw new NotApplicable("Somebody has already replaced that clause.");
      }
    }

    const closed = await tx.clauseDraft.updateMany({
      where: { id: draft.id, state: "approved" },
      data: {
        state: "applied",
        appliedClauseId: newId,
        publishMode: mode,
        publishedAt: new Date(),
        publishedById: userId,
        publishedByName: authoredByName,
      },
    });
    if (closed.count !== 1) throw new NotApplicable("That proposal has already been dealt with.");
  });

  return { clauseId: newId, added: added.length, mode };
}

/**
 * Agree the wording. The first of the two gates.
 *
 * Says the proposed sentence is right. It does *not* put it in the library —
 * that is `publishDraft`, and the separation is the point: approving is a
 * judgement about a sentence, publishing changes what every future assessment
 * in this organisation is measured against and supersedes a live clause.
 * Collapsing them means the irreversible half happens as a side effect of
 * agreeing with some words.
 *
 * Administrator only, like everything that curates the standards. Any member
 * may *propose* one from a finding they are reviewing; nobody but an
 * administrator decides the library will carry it.
 */
export async function approveDraft(
  userId: string,
  draftId: string,
  approvedByName: string,
): Promise<void> {
  const draft = await prisma.clauseDraft.findUnique({
    where: { id: draftId },
    select: { id: true, organisationId: true, state: true },
  });
  if (!draft) throw new NotApplicable("That proposal no longer exists.");
  const membership = await requireMembership(userId, draft.organisationId);
  if (!canManageStandards(membership.role)) throw new NotApplicable(REFUSED);

  if (draft.state !== "ready") {
    throw new NotApplicable(
      draft.state === "approved"
        ? "That proposal has already been approved. Publish it to add it to the standard."
        : draft.state === "applied"
          ? "That proposal is already part of the standard."
          : "That proposal is not ready to be approved yet.",
    );
  }

  // Conditional, so two administrators pressing at once record one approval
  // rather than overwriting each other's name on the row.
  const moved = await prisma.clauseDraft.updateMany({
    where: { id: draftId, state: "ready" },
    data: {
      state: "approved",
      approvedAt: new Date(),
      approvedById: userId,
      approvedByName,
    },
  });
  if (moved.count !== 1) throw new NotApplicable("That proposal has already been dealt with.");
}

/** Send an approved draft back for another look, without discarding it. */
export async function unapproveDraft(userId: string, draftId: string): Promise<void> {
  const draft = await prisma.clauseDraft.findUnique({
    where: { id: draftId },
    select: { id: true, organisationId: true, state: true },
  });
  if (!draft) throw new NotApplicable("That proposal no longer exists.");
  const membership = await requireMembership(userId, draft.organisationId);
  if (!canManageStandards(membership.role)) throw new NotApplicable(REFUSED);
  if (draft.state !== "approved") {
    throw new NotApplicable(
      draft.state === "applied"
        ? "That proposal is already part of the standard, so it cannot be withdrawn here."
        : "That proposal is not approved.",
    );
  }
  // The approver's name is cleared with the state: a row reading "approved by"
  // while sitting in "pending review" is a register contradicting itself.
  await prisma.clauseDraft.updateMany({
    where: { id: draftId, state: "approved" },
    data: { state: "ready", approvedAt: null, approvedById: null, approvedByName: "" },
  });
}

/** Say no to a draft. Kept, not deleted: what was refused is worth knowing. */
export async function discardDraft(userId: string, draftId: string): Promise<void> {
  const draft = await prisma.clauseDraft.findUnique({
    where: { id: draftId },
    select: { id: true, organisationId: true, state: true },
  });
  if (!draft) throw new NotApplicable("That proposal no longer exists.");
  const membership = await requireMembership(userId, draft.organisationId);
  if (!canManageStandards(membership.role)) throw new NotApplicable(REFUSED);
  if (draft.state === "applied") {
    throw new NotApplicable("That proposal is already part of the standard.");
  }
  await prisma.clauseDraft.updateMany({
    // "approved" among them: agreeing with a sentence is not a commitment to
    // publish it, and an approval nobody has acted on has to be refusable
    // without first being undone.
    where: { id: draftId, state: { in: ["drafting", "ready", "approved", "failed"] } },
    data: { state: "discarded" },
  });
}

/**
 * Set where a clause stands in the library: active, or suspended.
 *
 * Direct, immediate, administrator only, and recorded. There is no proposal and
 * no approval gate, and that is the point rather than a shortcut.
 *
 * The decision register is how a new standard is promoted **into** the library.
 * Running a clause that is already in the library back through it would make
 * that a loop: "promote a decision to a standard" would stop describing one
 * act, and a reviewer opening the register would find two different kinds of
 * question in one queue. One direction in, and this is the far end of it.
 *
 * What replaces the gate is the record. Suspending a clause changes what every
 * future assessment measures, so every move writes a `ClauseStatusChange` with
 * who, when, from, to and why — and `reason` is required here rather than
 * merely permitted, because an unexplained withdrawal of a rule the whole
 * organisation is judged against is the one thing an auditor will ask about.
 *
 * Written in place, like the adoption it replaces, and for the same reason: it
 * changes nothing the clause *says*. Superseding would fork the library every
 * time somebody triaged a register, and every finding ever recorded would point
 * at a retired row for a reason that was never about its wording. Findings
 * already on record stay exactly as they were — suspending a clause is not a
 * claim that last quarter's breach never happened. It decides what the next run
 * measures.
 */
export async function setClauseStatus(
  userId: string,
  clauseId: string,
  status: string,
  reason: string,
  byName: string,
): Promise<{
  clauseId: string;
  clauseRef: string;
  from: ClauseStatus;
  to: ClauseStatus;
}> {
  // The raw request, not `readClauseStatus`. That reader resolves anything
  // unrecognised to "active" so an odd value already in the database is still
  // judged; doing the same to a *request* would turn a typo into somebody
  // switching a clause back on.
  const wanted = String(status ?? "").trim().toLowerCase();
  if (!(CLAUSE_STATUSES as readonly string[]).includes(wanted)) {
    throw new StatusRefused("That is not a status a clause can be in.");
  }
  const to = wanted as ClauseStatus;

  const why = String(reason ?? "").trim();
  if (!why) {
    throw new StatusRefused("Say why this is changing — the record keeps it.");
  }

  const clause = await prisma.clause.findUnique({
    where: { id: clauseId },
    select: {
      id: true,
      status: true,
      supersededById: true,
      section: {
        select: {
          numberText: true,
          document: { select: { organisationId: true } },
        },
      },
    },
  });
  if (!clause) throw new StatusRefused("That clause is no longer in the library.");

  const organisationId = clause.section.document.organisationId;
  const membership = await requireMembership(userId, organisationId);
  if (!canManageStandards(membership.role)) throw new StatusRefused(REFUSED);

  // A superseded clause is judged by nothing, so a status on it would record a
  // decision that takes no effect and reads, later, as though it had.
  if (clause.supersededById) {
    throw new StatusRefused(
      "That clause was replaced by a sharper version. Change the one that replaced it.",
    );
  }

  const from = readClauseStatus(clause.status);
  if (from === to) {
    throw new StatusRefused(`That clause is already ${CLAUSE_STATUS_META[to].label.toLowerCase()}.`);
  }

  const clauseRef = clause.section.numberText ?? "";

  await prisma.$transaction(async (tx) => {
    // Conditional on the value it was read at, so two administrators acting at
    // the same moment record one move rather than two rows describing a
    // transition only one of them made.
    const moved = await tx.clause.updateMany({
      where: { id: clauseId, status: clause.status, supersededById: null },
      data: { status: to },
    });
    if (moved.count !== 1) {
      throw new StatusRefused("Somebody changed that clause first. Open it again.");
    }

    await tx.clauseStatusChange.create({
      data: {
        clauseId,
        clauseRef,
        organisationId,
        from,
        to,
        reason: why.slice(0, 2000),
        byId: userId,
        byName: byName.slice(0, 200),
      },
    });
  });

  return { clauseId, clauseRef, from, to };
}


/** One clause as the library lists it. */
export type LibraryClause = {
  id: string;
  ref: string;
  title: string;
  statement: string;
  /** The register's own category column, where the clause came from a register. */
  category: string;
  status: ClauseStatus;
  /**
   * The last time somebody moved this clause's status, if anybody has.
   *
   * Carried because the status alone does not answer the question a reviewer
   * actually has about a suspended rule — who stopped requiring it, when, and
   * why. Without it the list says a clause is suspended and leaves the reader
   * to go looking for a reason that is one join away.
   */
  lastChange: { at: Date; by: string; reason: string } | null;
};

/**
 * A standard as a list of its clauses, for the page it is read on.
 *
 * Why this exists beside the parse view: `ParsedContent` shows what the
 * pipeline *made* of the document — sections, the lines behind them, what it
 * set aside — and nests the clauses inside expandable rows as evidence. That
 * answers "did it read this correctly". The question somebody triaging their
 * library is asking is a different one — "which of these rules do we still
 * require" — and it cannot be answered from a page that hides the rules one
 * section at a time.
 *
 * Superseded clauses are left out. A clause that has been sharpened is no
 * longer judged and its replacement is in the list already; offering a status
 * control on the retired copy would record a decision against nothing.
 */
export async function libraryForDocument(
  userId: string,
  documentId: string,
): Promise<LibraryClause[]> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, organisationId: true },
  });
  if (!document) return [];
  await requireMembership(userId, document.organisationId);

  const rows = await prisma.clause.findMany({
    where: { section: { documentId }, supersededById: null },
    select: {
      id: true,
      title: true,
      statement: true,
      status: true,
      ordinal: true,
      sourceRefs: true,
      section: { select: { numberText: true, headingPath: true, ordinal: true } },
    },
    orderBy: [{ section: { ordinal: "asc" } }, { ordinal: "asc" }],
  });
  if (rows.length === 0) return [];

  // One query for the whole page rather than one per clause. Newest first, and
  // the first of each id wins, so this is the most recent move of each.
  const changes = await prisma.clauseStatusChange.findMany({
    where: { clauseId: { in: rows.map((row) => row.id) } },
    select: { clauseId: true, createdAt: true, byName: true, reason: true },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, { at: Date; by: string; reason: string }>();
  for (const change of changes) {
    if (latest.has(change.clauseId)) continue;
    latest.set(change.clauseId, {
      at: change.createdAt,
      by: change.byName,
      reason: change.reason,
    });
  }

  return rows.map((row) => {
    const register = (row.sourceRefs as { register?: { category?: unknown } } | null)?.register;
    return {
      id: row.id,
      ref: refOf(row.section),
      title: row.title ?? "",
      statement: row.statement,
      category: typeof register?.category === "string" ? register.category : "",
      status: readClauseStatus(row.status),
      lastChange: latest.get(row.id) ?? null,
    };
  });
}

/**
 * What each of these clauses requires, by clause id.
 *
 * A finding denormalises its clause's `statement` and nothing else, because
 * that is what a report has always printed. The requirements were left in the
 * clause — and they are where the breach usually lives.
 *
 * What that costs the reader, measured on this workspace's seven
 * contradictions: six of the seven clauses carry requirements the report never
 * shows. On one of them the finding's own first sentence is "lacks integration
 * with enterprise identity and access management", which is the clause's first
 * requirement almost word for word, while the panel above it shows only
 * "Security, privacy, and regulatory compliance must be embedded into
 * application design from the start, not added as an afterthought." The
 * reviewer is given a principle and an accusation with nothing joining them,
 * and the honest reaction is "how is that a breach?".
 *
 * Read at render rather than copied onto the finding: a migration would leave
 * every report already written exactly as unreadable as it is now, and this
 * costs one keyed query per page. A clause a re-parse has since removed simply
 * has no entry, which is why the finding keeps its own copy of the statement
 * and why this returns a map rather than throwing.
 */
export async function requirementsForClauses(
  clauseIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const wanted = [...new Set(clauseIds.filter(Boolean))];
  if (wanted.length === 0) return out;

  const rows = await prisma.clause.findMany({
    where: { id: { in: wanted } },
    select: { id: true, requirements: true },
  });
  for (const row of rows) {
    // An empty list and a missing clause render the same, so only say
    // something when there is something to say.
    if (row.requirements.length > 0) out.set(row.id, row.requirements);
  }
  return out;
}

/**
 * The organisation's proposed standards, for the decisions register.
 *
 * Every draft that is still moving — being written, waiting for a person,
 * approved and waiting to be published, or failed — plus the ones recently
 * published, so somebody arriving at the register can see that what they
 * approved last week did reach the library.
 *
 * Read here rather than on the report because this is the screen that answers
 * "what is waiting on me?". A draft is created from a finding on a report that
 * the approver may never open: the reviewer who proposed it has moved on, and
 * an administrator should not have to hunt through assessments to find the
 * three sentences somebody wants added to the standards.
 *
 * Which is also why each row carries its own case. `sourceVerdict` and
 * `sourceDesignTitle` come from the finding the draft was written from, so the
 * register can say "drafted from a contradiction on Field Telemetry Ingestion"
 * without the reader going to look. The finding is addressed by id rather than
 * by a relation, for the reason `Finding.clauseId` is not a foreign key either:
 * a governance record outlives the thing it came from, and a run deleted since
 * must not take the proposed standard with it.
 */
export async function listPendingDrafts(
  userId: string,
  organisationId: string,
  options: { includePublished?: number } = {},
): Promise<DraftView[]> {
  await requireMembership(userId, organisationId);

  const open = await prisma.clauseDraft.findMany({
    where: { organisationId, state: { in: OPEN_DRAFT_STATES } },
    select: {
      ...SELECT,
      organisationId: true,
      clause: { select: { requirements: true, statement: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // A short tail of finished ones, so the register shows its own outcome rather
  // than silently emptying as things are dealt with.
  const recent = options.includePublished
    ? await prisma.clauseDraft.findMany({
        where: { organisationId, state: "applied" },
        select: {
      ...SELECT,
      organisationId: true,
      clause: { select: { requirements: true, statement: true } },
    },
        orderBy: { publishedAt: "desc" },
        take: options.includePublished,
      })
    : [];

  const rows = [...open, ...recent];
  if (rows.length === 0) return [];

  // One query for every source finding, rather than one per row — and only for
  // the design's title. The verdict is on the draft itself: it is the case the
  // proposal was written from, and it must not change under the approver
  // because somebody corrected the finding afterwards.
  // Only the proposals that came from one. A historical adoption proposal
  // carries no finding, and asking for `id IN (null)` would both fail to
  // typecheck and mean nothing if it did.
  const findings = await prisma.finding.findMany({
    where: {
      id: {
        in: [...new Set(rows.map((row) => row.sourceFindingId).filter((id) => id !== null))],
      },
    },
    select: { id: true, document: { select: { title: true } } },
  });
  const titles = new Map(
    findings.map((finding) => [finding.id, finding.document?.title ?? null]),
  );

  const out: DraftView[] = [];
  for (const row of rows) {
    const state = readDraftState(row.state);
    out.push(
      toView(
        row,
        state === "ready" || state === "approved"
          ? await decisionsOn(row.organisationId, row.clauseRef)
          : [],
        // Null for a historical adoption proposal, which named no design
        // because none was assessed. The view renders that as "no design".
        (row.sourceFindingId ? titles.get(row.sourceFindingId) : null) ?? null,
      ),
    );
  }
  return out;
}
