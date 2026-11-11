import {
  OBLIGATIONS,
  SEVERITIES,
  VERDICTS,
  effectiveFinding,
  severityOf,
  type EditableField,
  type Obligation,
} from "./verdicts";

/**
 * What a save to a finding means — the rules, with no database behind them.
 *
 * Split out from finding-edits.ts for the reason verdicts.ts was split out of
 * assessment.ts: that module reaches Prisma, and anything importing it drags a
 * database connection in with it. A verification script could not exercise
 * these rules without one, and a client component could not import the
 * vocabulary at all.
 *
 * So the decisions live here and the writing lives there. Everything in this
 * file is pure: a finding's columns and a patch go in, a plan comes out.
 *
 * ## What the rules are for
 *
 * A reviewer used to have two moves — agree with the engine, or correct its
 * verdict and leave a note. Everything else the finding said was the model's
 * and stayed the model's, including the rationale that reaches the board packet
 * and the obligation that decides how serious the finding is.
 *
 * That last one is the sharp edge. `severityOf` deliberately refuses to invent
 * an obligation the standard did not state, and most enterprise standards are
 * written in declarative prose — "All external APIs are exposed through
 * Apigee" — which parses as `unstated`. So a genuine breach of a genuine rule
 * came out as "Check: a person has to look", and the person who looked had no
 * way to say what they found.
 *
 * ## Two things these rules are careful about
 *
 * **The engine's answer is never overwritten.** Every correction goes to a
 * column beside the engine's, exactly as `reviewerVerdict` sits beside
 * `verdict`. The disagreement between the two is the only evaluation data this
 * product will ever have — the one thing that can say how well the model is
 * doing — and overwriting the model's answer destroys it permanently.
 * `effectiveFinding` resolves the pair at read time.
 *
 * **A correction back to the engine's own answer is not a correction.** Setting
 * a field to what the engine already said clears the override rather than
 * storing a duplicate of it, so "edited" keeps meaning something.
 */

export class EditRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditRefused";
  }
}

/** Four sentences of reasoning, generously. Long enough for a real argument,
 *  short enough that the column is not where somebody pastes a document. */
export const MAX_RATIONALE = 4000;
export const MAX_NOTE = 2000;
/** Why the change was made. One or two lines. */
export const MAX_REASON = 600;

/**
 * A change to one finding.
 *
 * `undefined` leaves a field alone; `null` clears the correction and puts the
 * engine's own answer back. The two are different on purpose — a form that
 * submits only what it touched must not wipe what it did not.
 */
export type FindingPatch = {
  verdict?: string | null;
  obligation?: string | null;
  severity?: string | null;
  rationale?: string | null;
  note?: string | null;
  /** Why, recorded against every field this save moves. */
  reason?: string;
};

export type EditSummary = {
  changed: EditableField[];
  /** Set where the save also moved the finding's review state. */
  state: { from: string; to: string } | null;
};

/** A field's value as it will be stored: trimmed, capped, and null when blank.
 *  Exported because the writer caps the edit's stated reason the same way. */
export function trimmed(value: string | null | undefined, cap: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, cap) : null;
}

/**
 * The finding's own columns, as this module needs to see them.
 *
 * Structural rather than a Prisma type, so the decision below can be checked
 * without a database — see `planEdit`.
 */
export type FindingRow = {
  verdict: string;
  obligation: string | null;
  rationale: string | null;
  reviewerVerdict: string | null;
  reviewerObligation: string | null;
  reviewerSeverity: string | null;
  reviewerRationale: string | null;
  reviewerNote: string | null;
  reviewerState: string;
};

export type EditPlan = {
  /** Columns to write. Empty when the save moves nothing. */
  data: Record<string, unknown>;
  /** One per field moved, in the order the panel reads them. */
  events: {
    field: EditableField | "state";
    before: string | null;
    after: string | null;
  }[];
  state: { from: string; to: string } | null;
  /** Whether this save counts as adjudicating the finding, which stamps
   *  `reviewedAt`. Separate from `state` because re-confirming an already
   *  confirmed finding adjudicates it again without moving anything. */
  reviewed: boolean;
};

/**
 * What a save should do, decided without touching the database.
 *
 * Pure, and split out from the write for one specific reason: the rule about
 * the review state is subtle enough that it was wrong the first time, and a
 * rule that can only be exercised against a live Postgres is a rule nobody
 * exercises. See scripts/verify-finding-edit.mts.
 *
 * ## The two questions, which are not the same question
 *
 * **Did the stored column change?** Decides whether to write it, and whether
 * the history gains a row. Writing a column to the value it already holds is
 * not an edit and should not look like one.
 *
 * **Did this save address the verdict at all?** Decides the review state. These
 * come apart in the most common action in the product: confirming a *pending*
 * finding agrees with the engine, which means writing null over a null. The
 * column does not change, and a rule keyed on the column would leave the
 * finding pending for ever.
 *
 * ## Why the state follows the verdict and nothing else
 *
 * Correcting a verdict is by definition disagreeing with the engine, so it
 * overrides. Clearing that correction means landing on the engine's answer,
 * which is confirming it. Rewording a rationale or sharpening an obligation is
 * neither — a finding can perfectly well be unreviewed and better explained,
 * and marking it reviewed because somebody tidied its wording would make the
 * register's "Unreviewed" count a lie.
 */
export function planEdit(finding: FindingRow, patch: FindingPatch): EditPlan {
  // What it says now, before this save. History is written in these terms
  // rather than in the raw columns': a reviewer reading "covered → partial"
  // wants the sequence of positions the finding has held, not a diff of which
  // column happened to hold each one.
  const before = effectiveFinding(finding);

  const data: Record<string, unknown> = {};
  const events: EditPlan["events"] = [];

  // --- verdict ------------------------------------------------------------
  let verdictAddressed = false;
  let verdictStored: string | null = null;
  if (patch.verdict !== undefined) {
    const next = trimmed(patch.verdict, 64);
    if (next && !(VERDICTS as readonly string[]).includes(next)) {
      throw new EditRefused("That is not a verdict this engine uses.");
    }
    // Clearing, or choosing the engine's own answer, puts the column back to
    // null rather than storing an override that overrides nothing.
    const stored = next && next !== before.engine.verdict ? next : null;
    verdictAddressed = true;
    verdictStored = stored;
    if (stored !== finding.reviewerVerdict) {
      data.reviewerVerdict = stored;
      events.push({
        field: "verdict",
        before: before.verdict,
        after: stored ?? before.engine.verdict,
      });
    }
  }

  // --- obligation ---------------------------------------------------------
  let nextObligation: Obligation = before.obligation;
  if (patch.obligation !== undefined) {
    const next = trimmed(patch.obligation, 32);
    if (next && !(OBLIGATIONS as readonly string[]).includes(next)) {
      throw new EditRefused("That is not an obligation this engine uses.");
    }
    const stored = next && next !== before.engine.obligation ? next : null;
    nextObligation = (stored ?? before.engine.obligation) as Obligation;
    if (stored !== finding.reviewerObligation) {
      data.reviewerObligation = stored;
      events.push({
        field: "obligation",
        before: before.obligation,
        after: stored ?? before.engine.obligation,
      });
    }
  }

  // --- severity -----------------------------------------------------------
  //
  // Its own field, and the one rule it has to obey: it cannot move the verdict.
  // Nothing in this block writes `reviewerVerdict`, and nothing in the verdict
  // block above reads a severity — a `contradicts` graded Moderate stays a
  // contradiction in the register, the counts and the export, because the two
  // are separate columns resolved separately. A severity control that quietly
  // reclassified findings would let somebody retire a breach by adjusting a
  // priority, which is the one thing a compliance tool must not allow.
  //
  // Derived from where this save *lands*, not from where it started: a reviewer
  // sharpening the obligation to mandatory and grading the finding Critical in
  // one go has chosen exactly what the obligation now produces, so that stores
  // no override at all.
  if (patch.severity !== undefined) {
    const next = trimmed(patch.severity, 32);
    if (next && !(SEVERITIES as readonly string[]).includes(next)) {
      throw new EditRefused("That is not a severity this engine uses.");
    }
    const nextVerdict = verdictAddressed
      ? (verdictStored ?? before.engine.verdict)
      : before.verdict;
    const derived = severityOf(nextVerdict, nextObligation);
    const stored = next && next !== derived ? next : null;
    if (stored !== finding.reviewerSeverity) {
      data.reviewerSeverity = stored;
      events.push({
        field: "severity",
        before: before.severity,
        after: stored ?? derived,
      });
    }
  }

  // --- rationale ----------------------------------------------------------
  if (patch.rationale !== undefined) {
    const next = trimmed(patch.rationale, MAX_RATIONALE);
    const stored = next && next !== before.engine.rationale.trim() ? next : null;
    if (stored !== finding.reviewerRationale) {
      data.reviewerRationale = stored;
      events.push({
        field: "rationale",
        before: before.rationale,
        after: stored ?? before.engine.rationale,
      });
    }
  }

  // --- note ---------------------------------------------------------------
  // The one field with no engine answer behind it: a note is the reviewer's or
  // it is nothing, so there is no "back to the engine's" to return to.
  if (patch.note !== undefined) {
    const stored = trimmed(patch.note, MAX_NOTE);
    if (stored !== finding.reviewerNote) {
      data.reviewerNote = stored;
      events.push({ field: "note", before: finding.reviewerNote, after: stored });
    }
  }

  // --- review state -------------------------------------------------------
  let state: EditPlan["state"] = null;
  if (verdictAddressed) {
    const next = verdictStored ? "overridden" : "confirmed";
    if (next !== finding.reviewerState) {
      data.reviewerState = next;
      state = { from: finding.reviewerState, to: next };
      events.push({ field: "state", before: finding.reviewerState, after: next });
    }
  }

  return { data, events, state, reviewed: verdictAddressed };
}

/** One save, as the history panel reads it: who, when, why, and what moved. */
export type EditEvent = {
  batch: string;
  at: string;
  byName: string;
  reason: string;
  changes: { field: EditableField | "state"; before: string | null; after: string | null }[];
};
