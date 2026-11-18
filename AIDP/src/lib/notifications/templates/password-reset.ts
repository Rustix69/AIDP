import type { Composed } from "../mailer";
import { button, greeting, note, para, shell, urlFallback } from "./shell";

/**
 * The password-reset message.
 *
 * ## What the message deliberately does not say
 *
 * It does not name the organisation, the inviter, or anything else drawn from
 * the account. A reset mail is the one message that is sent to an address
 * before anyone has proved they control it, so it is also the one message an
 * attacker can cause to be sent to somebody else. It confirms nothing except
 * that a reset was asked for, and says plainly that ignoring it is safe.
 *
 * ## The window is passed in, not written here
 *
 * `expiresInSeconds` comes from `RESET_TOKEN_SECONDS` in
 * src/lib/auth-options.ts, which is the same constant Better Auth is configured
 * with. A message that stated its own number could drift from the token it
 * describes, and the drift would only show up as somebody following a dead
 * link.
 */

export type PasswordResetInput = {
  /** The account holder's name. May be empty; the greeting adapts. */
  name: string;
  /** Better Auth's one-time reset URL. */
  url: string;
  /** Must match `resetPasswordTokenExpiresIn`, so the message cannot promise a
   *  window the token does not honour. */
  expiresInSeconds: number;
};

export function passwordResetMail(input: PasswordResetInput): Composed {
  const window = humanDuration(input.expiresInSeconds);
  const hello = greeting(input.name);
  const subject = "Reset your AIDP password";

  const text = [
    hello,
    "",
    "Someone asked to reset the password on your AIDP account.",
    "",
    "Open this link to choose a new one:",
    "",
    // Bare, on its own line: see the note on Mail.text in ../mailer.ts.
    input.url,
    "",
    `The link works once, and expires in ${window}.`,
    "",
    "If you did not ask for this, you can ignore this message. Your password",
    "has not changed and nobody has been given access to your account.",
    "",
    "— AIDP",
  ].join("\n");

  const html = shell({
    preheader: `Choose a new password. The link expires in ${window}.`,
    title: subject,
    heading: "Reset your password",
    body: [
      para(hello),
      para("Someone asked to reset the password on your AIDP account."),
      button(input.url, "Choose a new password"),
      urlFallback(input.url),
      note(`The link works once, and expires in ${window}.`),
    ].join("\n"),
    footer:
      "If you did not ask for this, you can ignore this message. Your password has not changed and nobody has been given access to your account.",
  });

  return { subject, html, text };
}

/**
 * Seconds as something a person would say.
 *
 * Only the exact cases are spelled out, because the only caller passes a whole
 * number of hours and a reset window that is not a round number is a
 * configuration mistake worth seeing rather than smoothing over.
 */
function humanDuration(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}
