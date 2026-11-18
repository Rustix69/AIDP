import type { Composed } from "../mailer";
import { button, facts, greeting, para, paraWith, shell, urlFallback } from "./shell";

/**
 * "We have your submission."
 *
 * The first message the platform sends about a request, and the one the
 * workflow doc's notification table calls "Submission received (Step 1)". Step
 * 1 of the workflow spells out what it owes the reader: confirmation of
 * receipt, and when to expect an answer.
 *
 * ## What it is careful not to promise
 *
 * The brief has intake trigger both checks automatically. The engine does not
 * work that way: a submitted request is rendered, indexed, and then **waits for
 * somebody to press "Start assessing"** — see the `ready` state in
 * src/lib/ingest/requests.ts, which exists precisely because that press is a
 * human decision.
 *
 * So this message says the submission has been received and is being read, and
 * stops there. Telling a requestor their design is "being checked against the
 * standards now" would be false for as long as the request sits in `ready`,
 * and a governance tool that is casually wrong about its own state is not one
 * anybody should trust about a finding.
 *
 * The five-day target is stated as a target, which is what the brief calls it,
 * and no date is computed: a promised date that slipped a weekend or a public
 * holiday would be a worse failure than a plain sentence.
 */

export type SubmissionReceivedInput = {
  /** The requestor's name. May be empty; the greeting adapts. */
  recipientName: string;
  /** "AR-0012" — what everybody will call this submission from now on. */
  reference: string;
  /** The request's own title. */
  title: string;
  /** Absolute link to the request, from ../links.ts. */
  url: string;
};

export function submissionReceivedMail(input: SubmissionReceivedInput): Composed {
  const reference = input.reference.trim() || "Your request";
  const title = input.title.trim() || "Untitled request";
  const subject = `${reference} received — ${title}`;
  const hello = greeting(input.recipientName);

  const text = [
    hello,
    "",
    `We have your architecture review request, and it is now ${reference}.`,
    "",
    `  Reference: ${reference}`,
    `  Title:     ${title}`,
    "",
    "Your submission is being read. Once that finishes it is checked against",
    "your organisation's principles and standards, and you will be told as",
    "soon as the review report is ready.",
    "",
    "You can follow it here:",
    "",
    // Bare, on its own line: see the note on Mail.text in ../mailer.ts.
    input.url,
    "",
    "The target for a decision is five business days from submission.",
    "",
    "— AIDP",
  ].join("\n");

  const html = shell({
    preheader: `${reference} is being read. We will tell you when the report is ready.`,
    title: subject,
    heading: "Request received",
    body: [
      para(hello),
      paraWith("We have your architecture review request, and it is now ", reference, "."),
      facts([
        ["Reference", reference],
        ["Title", title],
      ]),
      para(
        "Your submission is being read. Once that finishes it is checked against your organisation's principles and standards, and you will be told as soon as the review report is ready.",
      ),
      button(input.url, "Follow this request"),
      urlFallback(input.url),
    ].join("\n"),
    footer: "The target for a decision is five business days from submission.",
  });

  return { subject, html, text };
}
