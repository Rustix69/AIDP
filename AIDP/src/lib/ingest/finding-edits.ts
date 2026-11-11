import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { EDITABLE_FIELDS, type EditableField } from "./verdicts";
import {
  EditRefused,
  MAX_REASON,
  planEdit,
  trimmed,
  type EditEvent,
  type EditSummary,
  type FindingPatch,
} from "./finding-edit-plan";

/**
 * Writing a reviewer's edit down, and reading back what has been written.
 *
 * The rules themselves are in finding-edit-plan.ts, which has no database
 * behind it; this is the half that needs one.
 */

// Re-exported so a caller that only writes or only reads has one import rather
// than two, and so moving the rules out did not become a change to every call
// site.
export {
  EditRefused,
  MAX_NOTE,
  MAX_RATIONALE,
  MAX_REASON,
  planEdit,
  type EditEvent,
  type EditPlan,
  type EditSummary,
  type FindingPatch,
  type FindingRow,
} from "./finding-edit-plan";

/**
 * Editing a finding, and keeping the record of it.
 *
 * A reviewer used to have two moves: agree with the engine, or correct its
 * verdict and leave a note. Everything else the finding said was the model's
 * and stayed the model's — including the rationale, which is the sentence that
 * reaches the board packet and the exported report, and the obligation, which
 * is what decides whether a breach is Critical or merely worth a look.
 *
 * That last one is the sharp edge. `severityOf` deliberately refuses to invent
 * an obligation the standard did not state, and most enterprise standards are
 * written in declarative prose — "All external APIs are exposed through
 * Apigee" — which parses as `unstated`. So a genuine breach of a genuine rule
 * came out as Check, and the reviewer who knew perfectly well it was mandatory
 * had no way to say so. Now they do, and the severity, the register ordering,
 * the risk matrix and the route the submission takes all move with it.
 *
 * ## What this file is careful about
 *
 * **The engine's answer is never overwritten.** Every correction is written to
 * a column that sits beside the engine's, exactly as `reviewerVerdict` sits
 * beside `verdict`. The disagreement between the two is the only evaluation
 * data this product will ever have — it is the one thing that can say how well
 * the model is actually doing — and overwriting the model's answer destroys it
 * permanently. `effectiveFinding` resolves the pair at read time.
 *
 * **Every change is appended, never replaced.** `reviewerNote` is one column
 * and has always been overwritten; so a reviewer who corrected a verdict in
 * March, thought again in April and corrected it back left no trace of either.
 * `FindingEdit` is the trace: one row per field moved, so "who changed this,
 * when, and what did they say about it" has an answer. That is the question a
 * governance audit asks, and this product exists to survive one.
 *
 * **A correction back to the engine's own answer is not a correction.** Setting
 * a field to what the engine already said clears the override rather than
 * storing a duplicate of it, so `corrected` stays meaningful and the "edited"
 * badge keeps meaning something.
 *
 * ## Who may do it
 *
 * Any member of the organisation that owns the run — the same gate
 * `reviewFinding` has always had, and deliberately not a narrower one. Working
 * the findings queue is the work a member is here to do; deciding what happens
 * to the submission afterwards is the architect's, and that is a different
 * action with a different check (see `canDecideSubmissions`).
 */

/**
 * Apply a reviewer's edit, and append the history rows for it.
 *
 * The decision is `planEdit`'s; this is the part that needs a database. A save
 * that moves nothing writes nothing and says so, rather than stamping
 * `editedAt` and adding an empty event — a reviewer who opened the editor, read
 * it and closed it has not edited anything, and a history full of those is one
 * nobody reads.
 */
export async function applyEdit(
  findingId: string,
  editor: { id: string; name: string },
  patch: FindingPatch,
): Promise<EditSummary> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    select: {
      verdict: true,
      obligation: true,
      rationale: true,
      reviewerVerdict: true,
      reviewerObligation: true,
      reviewerSeverity: true,
      reviewerRationale: true,
      reviewerNote: true,
      reviewerState: true,
    },
  });
  if (!finding) throw new EditRefused("That finding no longer exists.");

  const plan = planEdit(finding, patch);
  if (plan.events.length === 0) return { changed: [], state: null };

  const batch = randomUUID();
  const data: Record<string, unknown> = {
    ...plan.data,
    editedAt: new Date(),
    editedById: editor.id,
    editedByName: editor.name,
  };
  if (plan.reviewed) data.reviewedAt = new Date();
  const reason = trimmed(patch.reason, MAX_REASON) ?? "";

  // One transaction: a finding whose history is missing the change that
  // produced its current value is worse than one that was never edited.
  await prisma.$transaction([
    prisma.finding.update({ where: { id: findingId }, data }),
    prisma.findingEdit.createMany({
      data: plan.events.map((event) => ({
        findingId,
        batch,
        field: event.field,
        before: event.before,
        after: event.after,
        reason,
        editedById: editor.id,
        editedByName: editor.name,
      })),
    }),
  ]);

  return {
    changed: plan.events
      .map((event) => event.field)
      .filter((field): field is EditableField =>
        (EDITABLE_FIELDS as readonly string[]).includes(field),
      ),
    state: plan.state,
  };
}


/**
 * One finding's history, newest first, grouped into the saves that produced it.
 *
 * Grouped by `batch` rather than listed row by row, because a reviewer who
 * corrected the verdict and the obligation together did one thing, and a panel
 * that reports it as two leaves a reader wondering what happened in between.
 *
 * Dates come back as strings: this is read on the server and handed to a client
 * component, and a Date does not survive that boundary.
 */
export async function editHistory(findingId: string): Promise<EditEvent[]> {
  const rows = await prisma.findingEdit.findMany({
    where: { findingId },
    orderBy: { createdAt: "desc" },
  });
  return group(rows).get(findingId) ?? [];
}

/** Group raw rows, newest save first. Shared by the two readers below so they
 *  cannot disagree about what one save looks like. */
function group(
  rows: {
    findingId: string;
    batch: string;
    field: string;
    before: string | null;
    after: string | null;
    reason: string;
    editedByName: string;
    createdAt: Date;
  }[],
): Map<string, EditEvent[]> {
  const byFinding = new Map<string, Map<string, EditEvent>>();
  for (const row of rows) {
    const events = byFinding.get(row.findingId) ?? new Map<string, EditEvent>();
    byFinding.set(row.findingId, events);
    const change = {
      field: row.field as EditableField | "state",
      before: row.before,
      after: row.after,
    };
    const existing = events.get(row.batch);
    if (existing) {
      existing.changes.push(change);
      continue;
    }
    events.set(row.batch, {
      batch: row.batch,
      at: row.createdAt.toISOString(),
      byName: row.editedByName || "Someone no longer in this workspace",
      reason: row.reason,
      changes: [change],
    });
  }
  return new Map([...byFinding].map(([id, events]) => [id, [...events.values()]]));
}

/**
 * Every finding's history for one run, in one query.
 *
 * The report draws eighty findings and any of them may have been corrected, so
 * the alternative is eighty lookups to render a list — or a modal that fetches
 * on open and shows a reviewer a spinner where the record of their own last
 * edit should be. These rows are short text and most runs have none of them.
 *
 * Returns a plain object rather than a Map because this crosses into a client
 * component, and a Map does not survive that boundary.
 */
export async function historiesForRun(
  runId: string,
): Promise<Record<string, EditEvent[]>> {
  const rows = await prisma.findingEdit.findMany({
    where: { finding: { runId } },
    orderBy: { createdAt: "desc" },
  });
  return Object.fromEntries(group(rows));
}
