import type { Composed } from "../mailer";
import { button, facts, greeting, note, para, shell, urlFallback } from "./shell";

/**
 * "Your submission did not get through."
 *
 * ## Neither document has this message
 *
 * The BRD and the workflow doc model a request that succeeds. There is no
 * failure path in either, and so no notification for one — but `failed` is a
 * real state in the engine with a `failureReason` column beside it, reached
 * when a document cannot be parsed, a run is cancelled, or an assessment dies.
 * Today the requestor is never told: the request simply stops moving, and the
 * only way to find out is to open it.
 *
 * A governance tool that goes quiet when something breaks teaches people not to
 * trust it when it is working, so this is sent even though nobody asked for it.
 *
 * ## It says what went wrong, and that it can be retried
 *
 * `failed` is an editable state — `submitRequest` accepts `DRAFT`, `FAILED` and
 * `SUBMITTED` — so this is recoverable, and the message says so. Stating the
 * reason matters as much: "something went wrong" sends somebody to raise a
 * ticket, while "the diagram could not be read" sends them to replace the
 * diagram.
 */

export type AssessmentFailedInput = {
  recipientName: string;
  reference: string;
  title: string;
  /** `ArchitectureRequest.failureReason`, as recorded. May be empty. */
  reason: string;
  /** The request page, where it can be corrected and sent again. */
  url: string;
};

export function assessmentFailedMail(input: AssessmentFailedInput): Composed {
  const reference = input.reference.trim() || "Your request";
  const title = input.title.trim() || "Untitled request";
  const reason = input.reason.trim();
  const subject = `${reference} could not be assessed`;
  const hello = greeting(input.recipientName);

  const text = [
    hello,
    "",
    `${reference} stopped before it could be assessed.`,
    "",
    `  Reference: ${reference}`,
    `  Title:     ${title}`,
    ...(reason ? [`  Reason:    ${reason}`] : []),
    "",
    "Nothing has been lost. The request can be corrected and submitted again",
    "under the same reference:",
    "",
    input.url,
    "",
    "If the reason above does not make sense, your architecture team can see",
    "the full trace against this request.",
    "",
    "— AIDP",
  ].join("\n");

  const html = shell({
    preheader: reason
      ? `${reference} stopped: ${reason}`
      : `${reference} stopped before it could be assessed.`,
    title: subject,
    heading: "The assessment did not finish",
    body: [
      para(hello),
      para(`${reference} stopped before it could be assessed.`),
      facts([
        ["Reference", reference],
        ["Title", title],
        ...(reason ? ([["Reason", reason]] as [string, string][]) : []),
      ]),
      para(
        "Nothing has been lost. The request can be corrected and submitted again under the same reference.",
      ),
      button(input.url, "Open the request"),
      urlFallback(input.url),
      note(
        "If the reason above does not make sense, your architecture team can see the full trace against this request.",
      ),
    ].join("\n"),
  });

  return { subject, html, text };
}
