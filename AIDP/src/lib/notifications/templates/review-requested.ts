import type { Composed } from "../mailer";
import { button, facts, greeting, note, para, shell, urlFallback } from "./shell";

/**
 * "A report is waiting for your decision."
 *
 * The workflow doc's §7 row 3 — "Routed to Architect (either path) | Requestor,
 * Assigned Architect" — seen from the architect's side. This is the message
 * that makes the platform work as a governance tool rather than a dashboard
 * somebody has to remember to check.
 *
 * ## Why every report sends one
 *
 * The brief has a fast path: Not Significant with no Critical or High findings
 * is auto-approved and no architect is involved. That path does not exist in
 * the engine — `nextStep` computes a recommendation and nothing acts on it, so
 * every report, without exception, waits for a human to record an outcome.
 *
 * Sending this on every report is therefore the honest behaviour today rather
 * than an over-notification: there is no report that does not need somebody.
 * When auto-approval is built, this is the message that stops being sent for
 * the fast path, and the `route` already carried here is what will decide it.
 *
 * ## The engine's recommendation is quoted, not asserted
 *
 * `headline` and `because` come from `nextStep`, which states the brief's Step
 * 5 rule. They are included so the reader can triage from the inbox, and framed
 * as what the engine says rather than what has been decided — the decision is
 * the architect's, and the whole point of FR-04 is that they validate the
 * machine's reading rather than rubber-stamp it.
 */

export type ReviewRequestedInput = {
  /** The architect being asked. */
  recipientName: string;
  reference: string;
  title: string;
  /** Who filed it. */
  requestedByName: string;
  /** "2 Critical, 5 High", or "no findings that need acting on". */
  summary: string;
  /** `nextStep().headline` — one line, in a reviewer's words. */
  headline: string;
  /** `nextStep().because` — why that route and not another. */
  because: string;
  /** The report page. */
  url: string;
};

export function reviewRequestedMail(input: ReviewRequestedInput): Composed {
  const reference = input.reference.trim() || "A request";
  const title = input.title.trim() || "Untitled request";
  const from = input.requestedByName.trim() || "someone in your organisation";
  const subject = `${reference} needs a decision — ${input.summary}`;
  const hello = greeting(input.recipientName);

  const text = [
    hello,
    "",
    `${reference} has been assessed and is waiting for a decision.`,
    "",
    `  Reference: ${reference}`,
    `  Title:     ${title}`,
    `  Raised by: ${from}`,
    `  Found:     ${input.summary}`,
    "",
    `The engine suggests: ${input.headline}`,
    `Because: ${input.because}`,
    "",
    "Read the report and record the decision here:",
    "",
    input.url,
    "",
    "That suggestion is the brief's Step 5 rule applied to the findings. The",
    "decision is yours.",
    "",
    "— AIDP",
  ].join("\n");

  const html = shell({
    preheader: `${reference} from ${from}: ${input.summary}.`,
    title: subject,
    heading: "A report needs your decision",
    body: [
      para(hello),
      para(`${reference} has been assessed and is waiting for a decision.`),
      facts([
        ["Reference", reference],
        ["Title", title],
        ["Raised by", from],
        ["Found", input.summary],
      ]),
      para(`The engine suggests: ${input.headline}`),
      note(input.because),
      button(input.url, "Read the report"),
      urlFallback(input.url),
    ].join("\n"),
    footer:
      "That suggestion is the brief's Step 5 rule applied to the findings. The decision is yours.",
  });

  return { subject, html, text };
}
