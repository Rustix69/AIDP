import type { Composed } from "./mailer";
import { assessmentFailedMail } from "./templates/assessment-failed";
import { readyToAssessMail } from "./templates/ready-to-assess";
import { reportReadyMail } from "./templates/report-ready";
import { reviewRequestedMail } from "./templates/review-requested";
import { submissionReceivedMail } from "./templates/submission-received";

/**
 * The catalogue: every kind of message the platform sends, and how each one is
 * written.
 *
 * One definition, the way src/lib/ingest/*-vocabulary.ts hold theirs. A kind is
 * a string in the database so the vocabulary can grow without a migration — the
 * choice SubmissionOutcome.decision already made — and this file is what gives
 * those strings meaning.
 *
 * ## Rendering happens at send, from a payload captured at enqueue
 *
 * A row carries everything its message needs. Nothing here reads the database,
 * so a message cannot change its mind between being owed and being sent, and a
 * notification stuck behind a failed provider for an hour still says what was
 * true when the news happened.
 *
 * ## A message that cannot be written is dead, not retried
 *
 * `UnknownKind` and `PayloadIncomplete` are both permanent: a kind this
 * deployment does not know will not become known by waiting, and a payload
 * missing a field will not grow one. The drainer dead-letters those
 * immediately rather than spending five attempts discovering the same thing,
 * which keeps the retry budget for the failures that are actually transient.
 */

export const KINDS = [
  /** To the requestor, the moment a submission is accepted. */
  "submission_received",
  /** To the requestor, once the documents are indexed and the button is theirs
   *  to press. The state neither document anticipated — see the template. */
  "ready_to_assess",
  /** To the requestor, when the report lands. */
  "report_ready",
  /** To the requestor, when a request stops instead of finishing. */
  "assessment_failed",
  /** To the architects, when a report is waiting on a decision. */
  "review_requested",
] as const;
export type Kind = (typeof KINDS)[number];

/**
 * Where a message is delivered.
 *
 * "portal" is the in-app notification the brief pairs with email on three of
 * its six triggers. Nothing renders it yet; it is named here because the
 * dedupe key includes the channel, and a key format that has to change later
 * is a migration over a unique constraint.
 */
export const CHANNELS = ["email", "portal"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

/** This deployment has no template for that kind. Permanent. */
export class UnknownKind extends Error {
  constructor(kind: string) {
    super(`No template for a notification of kind "${kind}".`);
    this.name = "UnknownKind";
  }
}

/** The payload is missing something its template cannot do without. Permanent. */
export class PayloadIncomplete extends Error {
  constructor(kind: string, field: string) {
    super(`A "${kind}" notification is missing its "${field}".`);
    this.name = "PayloadIncomplete";
  }
}

/** A payload comes back from Postgres as JSON of unknown shape. */
function field(payload: unknown, name: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value : null;
}

function required(payload: unknown, name: string, kind: string): string {
  const value = field(payload, name);
  if (value === null) throw new PayloadIncomplete(kind, name);
  return value;
}

function optional(payload: unknown, name: string): string {
  return field(payload, name) ?? "";
}

/** A number off the payload. Absent or unreadable reads as none, because a
 *  count is a detail of the message rather than the message itself. */
function count(payload: unknown, name: string): number {
  if (!payload || typeof payload !== "object") return 0;
  const value = (payload as Record<string, unknown>)[name];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Write the message this row owes.
 *
 * Throws `UnknownKind` or `PayloadIncomplete` rather than rendering something
 * half-true — a notification with a blank reference in its subject line is
 * worse than one the operator can see failed.
 */
export function render(kind: string, payload: unknown): Composed {
  switch (kind) {
    case "submission_received":
      return submissionReceivedMail({
        recipientName: optional(payload, "recipientName"),
        reference: required(payload, "reference", kind),
        title: required(payload, "title", kind),
        url: required(payload, "url", kind),
      });

    case "ready_to_assess":
      return readyToAssessMail({
        recipientName: optional(payload, "recipientName"),
        reference: required(payload, "reference", kind),
        title: required(payload, "title", kind),
        url: required(payload, "url", kind),
      });

    case "report_ready":
      return reportReadyMail({
        recipientName: optional(payload, "recipientName"),
        reference: required(payload, "reference", kind),
        title: required(payload, "title", kind),
        summary: required(payload, "summary", kind),
        unsettled: count(payload, "unsettled"),
        url: required(payload, "url", kind),
      });

    case "assessment_failed":
      return assessmentFailedMail({
        recipientName: optional(payload, "recipientName"),
        reference: required(payload, "reference", kind),
        title: required(payload, "title", kind),
        // A request can fail without a reason being recorded, and a message
        // that refused to render over a blank one would leave the requestor
        // with no message at all — which is the thing this kind exists to fix.
        reason: optional(payload, "reason"),
        url: required(payload, "url", kind),
      });

    case "review_requested":
      return reviewRequestedMail({
        recipientName: optional(payload, "recipientName"),
        reference: required(payload, "reference", kind),
        title: required(payload, "title", kind),
        requestedByName: optional(payload, "requestedByName"),
        summary: required(payload, "summary", kind),
        headline: required(payload, "headline", kind),
        because: required(payload, "because", kind),
        url: required(payload, "url", kind),
      });

    default:
      throw new UnknownKind(kind);
  }
}
