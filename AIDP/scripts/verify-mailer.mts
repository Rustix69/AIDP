/**
 * The mail seam: what it promises, checked without sending anything.
 *
 * Six properties, each one a decision in src/lib/notifications/mailer.ts that
 * the notification work to come will lean on:
 *
 *  1. Configuration is both halves or neither. A key with no verified sender
 *     cannot send; a sender with no key has nothing to send through.
 *  2. Unconfigured is the console in development and an error in production —
 *     and the error names the variable that is actually missing, so nobody has
 *     to read this file to find out which one.
 *  3. **A refusal is thrown, not returned.** `resend.emails.send` resolves with
 *     `{ data: null, error }` when the API declines, and does the same when the
 *     network never answered. Code that awaits it and reads no further is
 *     indistinguishable from code that worked. Half these checks are that one
 *     case, because it is the mistake this seam exists to make impossible.
 *  4. A sent message gives back the provider's id — the handle an audit record
 *     keeps, since the provider's own logs expire long before the brief's
 *     retention requirement does.
 *  5. The template escapes what people typed. A name goes into an HTML body
 *     that cannot be corrected once it has been delivered.
 *  6. The reset mail states the window the token actually honours, because the
 *     two are fed from one constant rather than two.
 *
 * Nothing here reaches the network or the database. `fetch` is replaced for the
 * provider checks, and RESEND_API_KEY / MAIL_FROM are cleared before anything
 * runs, so a developer with real credentials in .env.local cannot cause this
 * script to send live mail.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/verify-mailer.mts
 * (the env file is optional — this script supplies what it needs)
 */

// Before anything else, and before the module under test is imported: a real
// key in .env.local must not become a real send.
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

// src/lib/prisma.ts builds its client at module load and refuses an empty
// DATABASE_URL, and auth-options imports it. No query is ever run here, so a
// placeholder is enough to let the import through when there is no env file.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://verify:verify@localhost:5432/verify";
}

import {
  MailNotConfigured,
  MailRefused,
  mailer,
  mailerConfigured,
} from "../src/lib/notifications/mailer";
import { passwordResetMail } from "../src/lib/notifications/templates/password-reset";
import { escapeHtml } from "../src/lib/notifications/html";

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, extra = "") => {
  if (condition) {
    pass += 1;
    console.log(`  PASS ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

/** NODE_ENV is typed as readonly by Next's ambient types; this is a test. */
const setNodeEnv = (value: string) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};
const originalNodeEnv = process.env.NODE_ENV;

const setMailEnv = (apiKey: string | null, from: string | null) => {
  if (apiKey === null) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = apiKey;
  if (from === null) delete process.env.MAIL_FROM;
  else process.env.MAIL_FROM = from;
};

const threw = async (work: () => Promise<unknown>): Promise<unknown> => {
  try {
    await work();
    return null;
  } catch (error) {
    return error;
  }
};

// ---------------------------------------------------------------------------
console.log("\nConfiguration is both halves or neither");

setMailEnv(null, null);
ok("neither set is unconfigured", mailerConfigured() === false);

setMailEnv("re_test", null);
ok("a key with no sender is unconfigured", mailerConfigured() === false);

setMailEnv(null, "AIDP <no-reply@example.test>");
ok("a sender with no key is unconfigured", mailerConfigured() === false);

setMailEnv("re_test", "AIDP <no-reply@example.test>");
ok("both set is configured", mailerConfigured() === true);

setMailEnv("   ", "   ");
ok("whitespace is not configuration", mailerConfigured() === false);

// ---------------------------------------------------------------------------
console.log("\nUnconfigured: the console in development, an error in production");

setMailEnv(null, null);
setNodeEnv("development");

const printed: string[] = [];
const realInfo = console.info;
console.info = (...args: unknown[]) => void printed.push(args.map(String).join(" "));
const devSend = await mailer().send({
  to: "someone@example.test",
  subject: "Subject line",
  html: "<p>body</p>",
  text: "the plaintext body\nhttps://example.test/reset?token=abc",
});
console.info = realInfo;

ok("development sends without throwing", typeof devSend.id === "string" && devSend.id.length > 0);
ok("and marks the id as not having come from a provider", devSend.id.startsWith("console-"));
ok(
  "and prints the plaintext body, which is where the link is",
  printed.join("\n").includes("https://example.test/reset?token=abc"),
);
ok("and says plainly that nothing was sent", printed.join("\n").includes("printing instead of sending"));

setNodeEnv("production");

const bothMissing = await threw(async () => mailer());
ok("production with neither refuses", bothMissing instanceof MailNotConfigured);
ok(
  "and names both variables",
  bothMissing instanceof Error &&
    bothMissing.message.includes("RESEND_API_KEY") &&
    bothMissing.message.includes("MAIL_FROM"),
  bothMissing instanceof Error ? bothMissing.message : "",
);

setMailEnv("re_test", null);
const senderMissing = await threw(async () => mailer());
ok(
  "and names only the half that is missing",
  senderMissing instanceof Error &&
    senderMissing.message.includes("MAIL_FROM") &&
    !senderMissing.message.includes("RESEND_API_KEY is") &&
    senderMissing.message.includes("is not set"),
  senderMissing instanceof Error ? senderMissing.message : "",
);

setNodeEnv(originalNodeEnv ?? "development");

// ---------------------------------------------------------------------------
console.log("\nA provider refusal is thrown, not returned");

const realFetch = globalThis.fetch;
let captured: { url: string; body: Record<string, unknown> | null } | null = null;

const stubFetch = (status: number, payload: unknown) => {
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const options = init as { body?: string } | undefined;
    captured = {
      url: String(input),
      body: options?.body ? (JSON.parse(options.body) as Record<string, unknown>) : null,
    };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
};

setMailEnv("re_test", "AIDP <no-reply@example.test>");
const message = {
  to: "someone@example.test",
  subject: "Subject line",
  html: "<p>body</p>",
  text: "body",
};

// The SDK logs its own error before returning it; that noise is not the subject
// of this check.
const realError = console.error;
console.error = () => {};

stubFetch(422, {
  statusCode: 422,
  name: "validation_error",
  message: "The example.test domain is not verified",
});
const refused = await threw(() => mailer().send(message));
ok("an API refusal throws", refused instanceof MailRefused);
ok(
  "and carries what the provider said",
  refused instanceof Error && refused.message.includes("The example.test domain is not verified"),
  refused instanceof Error ? refused.message : "",
);

// Resend turns a dead network into `{ error }` too, rather than letting the
// fetch rejection escape — so this path would also be silently swallowed.
globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof globalThis.fetch;
const unreachable = await threw(() => mailer().send(message));
ok("an unreachable provider throws", unreachable instanceof MailRefused);

// A 200 carrying neither an id nor an error must not read as success.
stubFetch(200, {});
const empty = await threw(() => mailer().send(message));
ok("a response with no id throws", empty instanceof MailRefused);

console.error = realError;

// ---------------------------------------------------------------------------
console.log("\nA sent message gives back the provider's id");

stubFetch(200, { id: "msg_0123456789" });
const sent = await mailer().send({ ...message, replyTo: "architects@example.test" });
ok("the id is the provider's own", sent.id === "msg_0123456789", sent.id);

const body = (captured as { body: Record<string, unknown> | null } | null)?.body;
ok("the recipient is passed through", body?.to === "someone@example.test");
ok("the sender comes from MAIL_FROM", body?.from === "AIDP <no-reply@example.test>");
ok("the subject is passed through", body?.subject === "Subject line");
ok("both bodies are sent", typeof body?.html === "string" && typeof body?.text === "string");
ok("reply-to is passed through when given", body?.reply_to === "architects@example.test");

stubFetch(200, { id: "msg_no_reply_to" });
await mailer().send(message);
const second = (captured as { body: Record<string, unknown> | null } | null)?.body;
ok("and is absent when not given", second !== null && !("reply_to" in (second ?? {})));

globalThis.fetch = realFetch;
setMailEnv(null, null);

// ---------------------------------------------------------------------------
console.log("\nThe template escapes what people typed");

const hostile = `Ravi <script>alert(1)</script> & "Co"`;
const composed = passwordResetMail({
  name: hostile,
  url: "https://aidp.example/reset?token=abc&id=1",
  expiresInSeconds: 3600,
});

ok("the raw tag never reaches the HTML", !composed.html.includes("<script>"));
ok("it is escaped instead", composed.html.includes("&lt;script&gt;"));
ok("the ampersand is escaped", composed.html.includes("&amp;"));
ok("the plaintext part is left alone", composed.text.includes(hostile));
ok(
  "escapeHtml handles every character it claims to",
  escapeHtml(`<>&"'`) === "&lt;&gt;&amp;&quot;&#39;",
  escapeHtml(`<>&"'`),
);
ok(
  "the URL survives escaping as a working href",
  composed.html.includes("https://aidp.example/reset?token=abc&amp;id=1"),
);

const anonymous = passwordResetMail({ name: "   ", url: "https://x.test", expiresInSeconds: 60 });
ok("an empty name greets without one", anonymous.text.startsWith("Hello,"));
ok("and does not leave a gap", !anonymous.html.includes("Hello ,"));

// ---------------------------------------------------------------------------
console.log("\nThe reset mail matches the token it describes");

const { authOptions, RESET_TOKEN_SECONDS } = await import("../src/lib/auth-options");

ok(
  "the option and the constant are the same number",
  authOptions.emailAndPassword.resetPasswordTokenExpiresIn === RESET_TOKEN_SECONDS,
);

const stated = passwordResetMail({
  name: "Nitin",
  url: "https://aidp.example/reset?token=abc",
  expiresInSeconds: RESET_TOKEN_SECONDS,
});
ok("the message states that window", stated.text.includes("expires in 1 hour"));
ok("and says the link is single-use", stated.text.includes("works once"));
ok(
  "a different window is described differently",
  passwordResetMail({ name: "", url: "https://x.test", expiresInSeconds: 900 }).text.includes(
    "expires in 15 minutes",
  ),
);

// ---------------------------------------------------------------------------
console.log("\nBetter Auth's reset hook goes through the seam");

type ResetArgs = Parameters<typeof authOptions.emailAndPassword.sendResetPassword>[0];
const user = {
  id: "user_1",
  name: "Nitin",
  email: "nitin@example.test",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as ResetArgs["user"];

setNodeEnv("development");
const hookOutput: string[] = [];
console.info = (...args: unknown[]) => void hookOutput.push(args.map(String).join(" "));
await authOptions.emailAndPassword.sendResetPassword({
  user,
  url: "https://aidp.example/reset?token=live-token",
  token: "live-token",
});
console.info = realInfo;
setNodeEnv(originalNodeEnv ?? "development");

const written = hookOutput.join("\n");
ok("the hook sends rather than logging a link itself", written.includes("printing instead of sending"));
ok("it addresses the account holder", written.includes("nitin@example.test"));
ok("it carries the reset URL", written.includes("https://aidp.example/reset?token=live-token"));
ok("it greets them by name", written.includes("Hello Nitin,"));

setNodeEnv("production");
const hookRefused = await threw(() =>
  authOptions.emailAndPassword.sendResetPassword({
    user,
    url: "https://aidp.example/reset?token=live-token",
    token: "live-token",
  }),
);
setNodeEnv(originalNodeEnv ?? "development");
ok(
  "and refuses in production rather than pretending",
  hookRefused instanceof MailNotConfigured,
  hookRefused instanceof Error ? hookRefused.message : "nothing was thrown",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
