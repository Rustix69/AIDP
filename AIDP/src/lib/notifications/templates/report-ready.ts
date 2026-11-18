import type { Composed } from "../mailer";
import { button, facts, greeting, para, shell, urlFallback } from "./shell";

/**
 * "Your review report is ready."
 *
 * The message the whole platform exists to send, and the one the brief names
 * directly: FR-02 promises notification "from 'Submitted' through to 'Report
 * Ready'". (The workflow doc's §7 table has no row for it — that is a gap in
 * the table, not a decision.)
 *
 * ## It links rather than attaches
 *
 * The workflow doc's Step 5 Path A says the report is attached. The BRD
 * classifies reports Confidential and requires role-based access "enforced at
 * the API layer, not only in the user interface". An attachment satisfies the
 * first document by breaking the second: a forwarded mail is an unauthenticated
 * copy of a governance record, outside every control the platform has. So the
 * message links to the report and the reader signs in, and the export route is
 * still there for the times somebody genuinely wants the file.
 *
 * ## It summarises without judging
 *
 * The counts go in the message so a requestor can tell a clean report from a
 * serious one without opening it. The routing line does not: what happens next
 * is the architect's call, and a mail that told the requestor "this is going to
 * the board" before a human had looked would be the platform pre-empting the
 * decision it exists to inform.
 */

export type ReportReadyInput = {
  recipientName: string;
  reference: string;
  title: string;
  /** "2 Critical, 5 High", or "no findings that need acting on". */
  summary: string;
  /** How many findings the engine could not settle. */
  unsettled: number;
  /** The report page. */
  url: string;
};

export function reportReadyMail(input: ReportReadyInput): Composed {
  const reference = input.reference.trim() || "Your request";
  const title = input.title.trim() || "Untitled request";
  const subject = `${reference} — your review report is ready`;
  const hello = greeting(input.recipientName);

  const unsettledLine =
    input.unsettled > 0
      ? `${input.unsettled} ${input.unsettled === 1 ? "finding" : "findings"} could not be graded from the document, so a person has to look at ${input.unsettled === 1 ? "it" : "them"}.`
      : "";

  const text = [
    hello,
    "",
    `${reference} has been checked against your organisation's principles and`,
    "standards, and the review report is ready.",
    "",
    `  Reference: ${reference}`,
    `  Title:     ${title}`,
    `  Found:     ${input.summary}`,
    "",
    ...(unsettledLine ? [unsettledLine, ""] : []),
    "Read it here:",
    "",
    input.url,
    "",
    "An architect records the decision from here. You will be told what they",
    "decide and why.",
    "",
    "— AIDP",
  ].join("\n");

  const html = shell({
    preheader: `${reference}: ${input.summary}.`,
    title: subject,
    heading: "Your report is ready",
    body: [
      para(hello),
      para(
        `${reference} has been checked against your organisation's principles and standards, and the review report is ready.`,
      ),
      facts([
        ["Reference", reference],
        ["Title", title],
        ["Found", input.summary],
      ]),
      ...(unsettledLine ? [para(unsettledLine)] : []),
      button(input.url, "Read the report"),
      urlFallback(input.url),
    ].join("\n"),
    footer:
      "An architect records the decision from here. You will be told what they decide and why.",
  });

  return { subject, html, text };
}
