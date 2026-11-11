/**
 * The clause-draft vocabulary — no database, no server-only imports.
 *
 * Split from standards.ts for the reason given at the top of verdicts.ts: that
 * module reaches Prisma, which reaches `node:module`, and a client component
 * importing it fails the build with a chunking error naming the component
 * rather than the import that caused it. The register and the finding dialog
 * are both client components and both need these words.
 *
 * ## What a clause draft is
 *
 * A standard written out of a real finding. The design broke — or could not be
 * judged against — a rule the library states too vaguely to enforce, and this
 * is the sharper wording that would have settled it. A model proposes the
 * lines, code checks them, and a person decides; nothing here reaches the
 * library that somebody has not read.
 *
 * Anything in this file must stay pure and dependency-free.
 */

/**
 * Verdicts a standard may be drafted from.
 *
 * `partial` was the original and the obvious one: it means the clause could not
 * be judged, so the wording is the thing at fault.
 *
 * `contradicts` is here because the client's reviewers kept reaching for it and
 * could not. A breach of a vague clause is the same problem wearing a worse
 * face — "ensure resilience" against a design that states it drops failed
 * messages is a contradiction *and* a clause that never said what resilience
 * required, so the next design will argue about it again. The reviewer who has
 * just read the breach is the person best placed to write the rule that would
 * have caught it.
 *
 * Deliberately no further. `covered` and `not_applicable` have nothing to
 * sharpen; `absent` is not reported as a finding at all; `needs_review` and
 * `not_assessable` are the engine saying it could not tell, which is not
 * evidence about the wording of the clause.
 */
export const SHARPENABLE = ["partial", "contradicts"] as const;

export type DraftState =
  | "drafting"
  | "ready"
  | "approved"
  | "failed"
  | "applied"
  | "discarded";

/** A line the checks threw away, with the reason, as the worker recorded it. */

export const STATES: DraftState[] = [
  "drafting",
  "ready",
  "approved",
  "failed",
  "applied",
  "discarded",
];

/**
 * What the register calls each state, and what a reader should take from it.
 *
 * Here rather than in the component because the same words belong on the
 * finding that produced the draft and in the register that carries it, and two
 * copies would drift — the same reasoning as ROLES in access/roles.ts.
 */
export const DRAFT_STATE_META: Record<
  DraftState,
  { label: string; tone: "pending" | "good" | "bad" | "neutral"; blurb: string }
> = {
  drafting: {
    label: "Drafting",
    tone: "neutral",
    blurb: "A model is writing the requirement lines. This takes a few moments.",
  },
  ready: {
    label: "Pending review",
    tone: "pending",
    blurb: "Written and checked. Waiting for an administrator to agree the wording.",
  },
  approved: {
    label: "Approved",
    tone: "good",
    blurb:
      "The wording is agreed. It is not in the library until somebody publishes it.",
  },
  failed: {
    label: "Could not be drafted",
    tone: "bad",
    blurb: "The model could not be reached, or wrote nothing that passed the checks.",
  },
  applied: {
    label: "Published",
    tone: "good",
    blurb: "In the library. Every assessment from now on is measured against it.",
  },
  discarded: {
    label: "Discarded",
    tone: "neutral",
    blurb: "Read and refused. Kept, because what was refused is worth knowing.",
  },
};

/** A state string from the database, or "failed" for one nobody recognises. */
export function readDraftState(value: string): DraftState {
  return (STATES as string[]).includes(value) ? (value as DraftState) : "failed";
}

/** Whether this verdict can have a standard drafted from it. */
export function isSharpenable(verdict: string): boolean {
  return (SHARPENABLE as readonly string[]).includes(verdict);
}

/**
 * The states a draft is still moving through, which is what the register's
 * pending section lists. `applied` and `discarded` are finished with.
 */
export const OPEN_DRAFT_STATES: DraftState[] = ["drafting", "ready", "approved", "failed"];

/**
 * Where a clause stands in this organisation's library.
 *
 * **active** — the clause governs this organisation's designs. The default,
 * because a register somebody uploaded is a library they chose, and silently
 * judging nothing would be the worse surprise.
 *
 * **suspended** — the organisation no longer requires it. It is not judged,
 * does not appear in a report, and does not count toward a run's clause total.
 * A design cannot breach a rule its owner has set aside, and reporting it as a
 * gap would be the engine arguing with the customer about their own standards.
 *
 * ## Set directly, never proposed
 *
 * An administrator changes this from the standards library and it takes effect
 * at once; `ClauseStatusChange` records the move. It does **not** go through
 * the decision register.
 *
 * That is a rule about direction, not about convenience. The decision register
 * is how a new standard is promoted *into* the library — one way in, so that
 * every standard arrives having been argued for in the same place. A standard
 * already in the library travelling back to decisions would make that a loop,
 * and "promote a decision to a standard" would stop meaning one thing.
 *
 * This replaced an accepted/rejected pair proposed through that register.
 * "Suspended" is also the better word: a library of a hundred rules does not
 * reject one, it stops requiring it.
 */
export const CLAUSE_STATUSES = ["active", "suspended"] as const;

export type ClauseStatus = (typeof CLAUSE_STATUSES)[number];

/** What is in force, as a set, for the one question every reader asks. */
export const ENFORCED_CLAUSE_STATUSES: readonly ClauseStatus[] = ["active"];

export const CLAUSE_STATUS_META: Record<
  ClauseStatus,
  { label: string; tone: "good" | "neutral"; blurb: string }
> = {
  active: {
    label: "Active",
    tone: "good",
    blurb: "This clause governs your designs. Assessments judge against it.",
  },
  suspended: {
    label: "Suspended",
    tone: "neutral",
    blurb:
      "No longer required. Assessments skip it, and it is left out of every report. Reports already written keep it.",
  },
};

/**
 * Anything unrecognised reads as active.
 *
 * The same direction the worker's query takes (`status <> 'suspended'` rather
 * than `status = 'active'`), and for the same reason: of the two ways to be
 * wrong about an unexpected value, measuring a design against a rule its owner
 * has set aside is a conversation, and failing to measure it against one they
 * still hold is a missed breach nobody sees.
 */
export function readClauseStatus(value: unknown): ClauseStatus {
  const candidate = String(value ?? "").trim().toLowerCase();
  return (CLAUSE_STATUSES as readonly string[]).includes(candidate)
    ? (candidate as ClauseStatus)
    : "active";
}

/** Whether a clause in this state is assessed against. */
export function isEnforced(status: string): boolean {
  return (ENFORCED_CLAUSE_STATUSES as readonly string[]).includes(readClauseStatus(status));
}

/**
 * What a pending proposal is asking for.
 *
 * **sharpen** — the wording of a clause should change. A model drafts the new
 * requirement lines, which is why these are born `drafting`.
 *
 * Only one kind, now. There was briefly a second, "adoption", proposing that a
 * clause be accepted into or rejected from the library; that is set directly on
 * the clause instead — see CLAUSE_STATUSES for why a standard already in the
 * library must not travel back to the decision register. The vocabulary stays a
 * list because a second kind of proposal is a plausible thing to want again,
 * and because historical rows still carry the old value.
 */
export const DRAFT_KINDS = ["sharpen"] as const;

export type DraftKind = (typeof DRAFT_KINDS)[number];

/**
 * How an approved standard may be put into the library.
 *
 * **sharpen** — the clause gains the new lines as a new version of itself, and
 * the old version is superseded. One rule, said better. This is what every
 * proposal did before the choice existed, and it stays the default.
 *
 * **separate** — a new clause is added beside the original, and the original is
 * left standing. Two rules.
 *
 * The choice only exists for a contradiction, and the reason is what the two
 * verdicts mean. A `partial` says the clause *could not be judged as written* —
 * the clause is the thing at fault, so the clause is the thing that changes,
 * and adding a second vague clause beside it would make the library worse.
 *
 * A `contradicts` says the design stated something the standard forbids, and
 * what the breach shows is often that a *different* rule was missing rather
 * than that the broken one was vague. "All external APIs are exposed through
 * Apigee" is not improved by bolting "direct database-to-application
 * connections are prohibited" onto it: those are two rules about two things,
 * and a clause carrying both is harder to judge than either, so every future
 * design comes back `partial` against it.
 */
export const PUBLISH_MODES = ["sharpen", "separate"] as const;

export type PublishMode = (typeof PUBLISH_MODES)[number];

export const PUBLISH_MODE_META: Record<
  PublishMode,
  { label: string; blurb: string; after: string }
> = {
  sharpen: {
    label: "Replace the existing rule",
    blurb: "The clause gains these lines and the old wording is superseded.",
    after: "One rule, said better. The earlier wording stays on the record as a superseded version, so reports written against it still mean what they meant.",
  },
  separate: {
    label: "Keep both rules",
    blurb: "A new clause is added beside the original, which is left as it is.",
    after: "Two rules in this section. The original keeps judging what it always judged; the new one judges what the breach showed was missing.",
  },
};

/** The verdict this draft came from, with the empty value read as the only one
 *  that existed before drafts recorded it. */
export function readSourceVerdict(value: string): string {
  return value || "partial";
}

/** Whether a draft from this verdict may be published as a separate clause. */
export function mayPublishSeparately(sourceVerdict: string): boolean {
  return readSourceVerdict(sourceVerdict) === "contradicts";
}

/** A publish mode this build knows, refusing anything it does not — and
 *  refusing "separate" on a verdict that may not use it. */
export function readPublishMode(value: unknown, sourceVerdict: string): PublishMode {
  if (value === "separate" && mayPublishSeparately(sourceVerdict)) return "separate";
  return "sharpen";
}

/**
 * The register row a proposal would become.
 *
 * Six of this organisation's standards are spreadsheets, and every rule in them
 * is a row with these columns. A proposal that carried only requirement lines
 * could not be filed back beside them, so publishing one as a rule of its own
 * meant hand-typing a title and a statement and leaving the new clause with no
 * reference, no category and no owner.
 *
 * `identifier` is derived by the worker from the row this grew out of —
 * "DAT-004a" beside "DAT-004" — never chosen by the model, so a reference
 * already cited in a design or a waiver cannot be made to point somewhere else.
 * Every field may be empty: a clause parsed from prose has no register row
 * behind it, and a column the checks refused is dropped rather than shown.
 */
export type DraftEntry = {
  identifier: string;
  /** The row it grew out of, so the screen can say what it stands beside. */
  parentIdentifier: string;
  category: string;
  owner: string;
  /** Always "proposed" until it is published. */
  status: string;
  title: string;
  statement: string;
  rationale: string;
};

const NO_ENTRY: DraftEntry = {
  identifier: "",
  parentIdentifier: "",
  category: "",
  owner: "",
  status: "",
  title: "",
  statement: "",
  rationale: "",
};

/**
 * Read defensively, exactly as `readSetAside` is: this is free JSON written by
 * a worker, and every draft created before the column existed holds `{}`.
 */
export function readEntry(value: unknown): DraftEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return NO_ENTRY;
  const row = value as Record<string, unknown>;
  const text = (key: keyof DraftEntry) =>
    typeof row[key] === "string" ? (row[key] as string) : "";
  return {
    identifier: text("identifier"),
    parentIdentifier: text("parentIdentifier"),
    category: text("category"),
    owner: text("owner"),
    status: text("status"),
    title: text("title"),
    statement: text("statement"),
    rationale: text("rationale"),
  };
}

/** Whether there is a register row here at all, rather than eight blanks. */
export function hasEntry(entry: DraftEntry): boolean {
  return Boolean(entry.identifier || entry.statement || entry.title || entry.category);
}
