import { randomUUID } from "node:crypto";
import { Resend } from "resend";

/**
 * Outbound mail, and the single seam the provider is allowed to live behind.
 *
 * ## Why an interface for what is currently one message
 *
 * AIDP is a governance tool sold to enterprises, and the mail it will carry is
 * confidential by classification — a report's findings, a board packet, a
 * decision rationale. A customer whose security team has standardised on
 * Microsoft 365 will ask that this mail leave through their own tenant rather
 * than a third party's, and that is a reasonable enough request that it should
 * cost one file to answer. So `resend` is imported here and nowhere else: a
 * `GraphMailer` or an `SmtpMailer` implementing `Mailer` drops in underneath
 * without a single caller changing.
 *
 * The same seam is what the notification outbox will sit on top of, so it is
 * worth getting right while there is only one message to break.
 *
 * ## Configuration is read per call
 *
 * Not captured at module load, for the reason src/lib/access/secrets.ts reads
 * its encryption key per call: a missing variable should surface as an error on
 * the one action that needs it, rather than as a server that will not boot. It
 * also means a rotated key takes effect without a redeploy.
 *
 * ## `html` and `text` are both required
 *
 * The plaintext alternative is not decoration. Enterprise gateways strip HTML,
 * some clients prefer the text part outright, and a password-reset mail that
 * arrives blank is worse than one that never arrives — the recipient believes
 * something was sent and waits for it. Putting `text` in the type means no
 * template can quietly omit it.
 *
 * ## The provider does not throw
 *
 * `resend.emails.send` resolves with `{ data: null, error }` when the API
 * declines — an unverified sending domain, a malformed address, a spent quota.
 * Code that awaits it and reads no further looks exactly like code that worked,
 * and sends nothing. `ResendMailer` turns that into a thrown `MailRefused`, so
 * the contract every caller sees is the plain one: it returns an id, or it
 * throws.
 */

/** One message, ready to send. */
export type Mail = {
  to: string;
  subject: string;
  /** The HTML body. */
  html: string;
  /**
   * The plaintext alternative — required, see the note above.
   *
   * Any link should appear bare and on its own line, so that it survives a
   * gateway that rewrites anchors, and so that `ConsoleMailer` stays usable in
   * development: copying the URL out of the terminal is the whole local
   * password-reset flow.
   */
  text: string;
  replyTo?: string;
};

/**
 * A message that has been written but not yet addressed.
 *
 * What every template returns. Keeping the recipient out of it is what lets one
 * composed message be sent to several people, and what stops a template from
 * deciding who should receive it — a question that belongs to the catalogue in
 * kinds.ts, not to the words.
 */
export type Composed = Omit<Mail, "to" | "replyTo">;

/**
 * What the provider gives back.
 *
 * The id is the provider's own handle for the message, and it is the thing an
 * audit record keeps: Resend's dashboard retains logs for days, while the
 * brief's auditability requirement is measured in years, so the id has to be
 * stored on our side to be worth anything.
 */
export type Sent = { id: string };

export interface Mailer {
  send(mail: Mail): Promise<Sent>;
}

/** No provider is configured, in an environment where that cannot be survived. */
export class MailNotConfigured extends Error {
  constructor(detail: string) {
    super(
      `Cannot send mail — ${detail}. Set RESEND_API_KEY and MAIL_FROM, or ` +
        `implement another Mailer in src/lib/notifications/mailer.ts.`,
    );
    this.name = "MailNotConfigured";
  }
}

/** The provider took the request and declined to send it. */
export class MailRefused extends Error {
  constructor(detail: string) {
    super(`The mail provider refused this message: ${detail}`);
    this.name = "MailRefused";
  }
}

type Settings = { apiKey: string; from: string };

/**
 * Both halves, or neither.
 *
 * A key with no verified sender address cannot send, and a sender address with
 * no key has nothing to send through, so there is no half-configured state
 * worth representing. Resend rejects a `from` outside a verified domain, which
 * is why the address is configuration rather than a constant in this file.
 */
function settings(): Settings | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (apiKey && from) return { apiKey, from };
  return null;
}

/**
 * Whether mail will actually leave the building.
 *
 * Deliberately distinct from "`mailer()` will not throw": in development
 * `mailer()` returns a `ConsoleMailer` quite happily, and a screen that wants
 * to tell somebody "we have emailed you" should ask this rather than assume it.
 */
export function mailerConfigured(): boolean {
  return settings() !== null;
}

class ResendMailer implements Mailer {
  private readonly apiKey: string;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(mail: Mail): Promise<Sent> {
    // Constructed per send rather than held: the client is a thin wrapper over
    // fetch, so there is nothing to pool, and a rotated key would otherwise be
    // ignored until the process restarted.
    const resend = new Resend(this.apiKey);

    const { data, error } = await resend.emails.send({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    });

    if (error) throw new MailRefused(`${error.name} — ${error.message}`);
    if (!data?.id) throw new MailRefused("it returned neither an id nor an error");

    return { id: data.id };
  }
}

/**
 * Development's mailer: print the message instead of sending it.
 *
 * This preserves the behaviour the password-reset flow had before a provider
 * existed — the link appears in the terminal running `npm run dev` and is
 * copied out by hand — while routing through the same interface, so the
 * development path exercises the same template code the real one does.
 */
class ConsoleMailer implements Mailer {
  async send(mail: Mail): Promise<Sent> {
    console.info(
      [
        "",
        "[AIDP] No mail provider configured — printing instead of sending.",
        `[AIDP] To:      ${mail.to}`,
        `[AIDP] Subject: ${mail.subject}`,
        "",
        mail.text,
        "",
      ].join("\n"),
    );
    return { id: `console-${randomUUID()}` };
  }
}

/**
 * The mailer for this environment.
 *
 * Configured, it is Resend. Unconfigured, it is the console in development and
 * an error in production — refusing by omission rather than discovering months
 * later that no customer has ever received anything. That is the same stance
 * /api/internal/credentials takes about an unset shared secret, and the one
 * this file replaced already took about an unset provider.
 */
export function mailer(): Mailer {
  const configured = settings();
  if (configured) return new ResendMailer(configured.apiKey, configured.from);

  if (process.env.NODE_ENV === "production") {
    const missing = [
      process.env.RESEND_API_KEY?.trim() ? null : "RESEND_API_KEY",
      process.env.MAIL_FROM?.trim() ? null : "MAIL_FROM",
    ].filter((name): name is string => name !== null);

    throw new MailNotConfigured(
      `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set`,
    );
  }

  return new ConsoleMailer();
}
