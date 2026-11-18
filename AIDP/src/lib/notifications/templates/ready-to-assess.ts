import type { Composed } from "../mailer";
import { button, facts, greeting, para, shell, urlFallback } from "./shell";

/**
 * "Your submission has been read, and nothing will happen until you say so."
 *
 * ## The message neither document asks for
 *
 * Both the BRD and the workflow doc have intake trigger the significance check
 * and the compliance review automatically, with no step in between. The engine
 * does not work that way, and the difference is not an oversight: `startAssessment`
 * exists because opening a run costs real money in model calls, and deciding to
 * spend it is a person's call, not a pipeline's.
 *
 * So there is a state the documents never anticipated — `ready` — where a
 * request sits indexed and waiting for somebody to press a button. Without this
 * message nobody is told, and a submission can wait there indefinitely while
 * its requestor believes the platform is working on it. That is the worst kind
 * of silence a governance tool can keep.
 *
 * The brief's FR-02 does cover it in spirit: "notified at every status change,
 * from 'Submitted' through to 'Report Ready'". It simply has no row for this
 * one in the §7 table, because the table was written against a workflow where
 * this state does not exist.
 */

export type ReadyToAssessInput = {
  recipientName: string;
  reference: string;
  title: string;
  /** The request page — this is where the button lives. */
  url: string;
};

export function readyToAssessMail(input: ReadyToAssessInput): Composed {
  const reference = input.reference.trim() || "Your request";
  const title = input.title.trim() || "Untitled request";
  const subject = `${reference} is ready to assess`;
  const hello = greeting(input.recipientName);

  const text = [
    hello,
    "",
    `${reference} has been read, and it is ready to be assessed.`,
    "",
    `  Reference: ${reference}`,
    `  Title:     ${title}`,
    "",
    "Nothing runs until somebody starts it. Open the request and press",
    '"Start assessing" to check it against your organisation\'s principles',
    "and standards.",
    "",
    input.url,
    "",
    "You will be told again as soon as the review report is ready.",
    "",
    "— AIDP",
  ].join("\n");

  const html = shell({
    preheader: `${reference} is indexed and waiting for you to start the assessment.`,
    title: subject,
    heading: "Ready to assess",
    body: [
      para(hello),
      para(`${reference} has been read, and it is ready to be assessed.`),
      facts([
        ["Reference", reference],
        ["Title", title],
      ]),
      para(
        'Nothing runs until somebody starts it. Open the request and press "Start assessing" to check it against your organisation\'s principles and standards.',
      ),
      button(input.url, "Open the request"),
      urlFallback(input.url),
    ].join("\n"),
    footer: "You will be told again as soon as the review report is ready.",
  });

  return { subject, html, text };
}
