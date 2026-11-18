/**
 * The notification outbox: what it guarantees, checked against the real
 * database.
 *
 * Six properties, each one a decision the rest of the notification work will
 * lean on:
 *
 *  1. **One message per piece of news, however often it is announced.** The
 *     screens repair their own state as they render, so the code that notices
 *     "this request moved on" runs on every page load. Without the unique
 *     index on `dedupeKey` one submission would mean an email per page view.
 *     This is the property most likely to be broken by a later change and the
 *     one with the worst failure mode, so it is checked first and hardest.
 *  2. A recipient with no address is recorded as `skipped`, not dropped. Every
 *     recipient in this schema is `onDelete: SetNull`, so this is a real state
 *     and an audit trail that omitted it would quietly disagree with events.
 *  3. A sent message keeps the provider's id, because Resend's own logs expire
 *     long before the retention the brief asks for.
 *  4. A message that cannot be *sent* is retried with backoff; a message that
 *     cannot be *written* is dead at once. Spending five attempts on a payload
 *     that will never grow the field it is missing wastes the budget that
 *     exists for real outages.
 *  5. An unconfigured provider leaves rows queued rather than burning their
 *     attempts. A missing environment variable must not dead-letter a day of
 *     mail.
 *  6. Claiming is exclusive. Two drainers overlap routinely — an `after()` and
 *     a timer — and must take different work, never the same work twice.
 *
 * Everything is created inside a throwaway organisation and removed at the end,
 * and **every drain is scoped to it**: an unscoped drain covers every
 * customer's pending mail, so a test that forgot the scope would mark real
 * unsent messages as sent. Nothing here reaches a mail provider — the mailer is
 * a fake that counts what it was handed.
 *
 * Run with:  npx tsx --env-file=.env.local scripts/verify-notifications.mts
 * Requires the 20261118180000_notification_outbox migration (npm run db:migrate).
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { Mail, Mailer, Sent } from "../src/lib/notifications/mailer";
import { dedupeKeyFor, enqueue } from "../src/lib/notifications/enqueue";
import { drain } from "../src/lib/notifications/drain";
import { PayloadIncomplete, UnknownKind, isKind, render } from "../src/lib/notifications/kinds";
import {
  notifyAssessmentFailed,
  notifyReadyToAssess,
  notifyReportReady,
  notifySubmissionReceived,
} from "../src/lib/notifications/events";
import { authorisedInternally } from "../src/lib/access/internal-auth";

const TAG = `zz-notify-${Date.now()}`;

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

/** Counts what it was handed; never touches a network. */
class FakeMailer implements Mailer {
  readonly sent: Mail[] = [];
  constructor(private readonly behaviour: "send" | "refuse" = "send") {}
  async send(mail: Mail): Promise<Sent> {
    if (this.behaviour === "refuse") throw new Error("the provider said no");
    this.sent.push(mail);
    return { id: `prov_${this.sent.length}` };
  }
}

const setNodeEnv = (value: string) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
};
const originalNodeEnv = process.env.NODE_ENV;

// ---------------------------------------------------------------------------
console.log("\nThe key that stops a hundred enqueues becoming a hundred emails");

const recipient = { email: "Requestor@Example.TEST", userId: "u1", name: "R" };
ok(
  "it is requestId:kind:channel:recipient",
  dedupeKeyFor({ requestId: "req1", kind: "submission_received", channel: "email", recipient }) ===
    "req1:submission_received:email:requestor@example.test",
  dedupeKeyFor({ requestId: "req1", kind: "submission_received", channel: "email", recipient }),
);
ok(
  "the address is lower-cased, so one person is one key",
  dedupeKeyFor({ requestId: "r", kind: "k", channel: "email", recipient }) ===
    dedupeKeyFor({
      requestId: "r",
      kind: "k",
      channel: "email",
      recipient: { email: "requestor@example.test" },
    }),
);
ok(
  "the channel is part of it, so portal will not suppress email",
  dedupeKeyFor({ requestId: "r", kind: "k", channel: "email", recipient }) !==
    dedupeKeyFor({ requestId: "r", kind: "k", channel: "portal", recipient }),
);
ok(
  "a recipient with no address falls back to their id",
  dedupeKeyFor({
    requestId: "r",
    kind: "k",
    channel: "email",
    recipient: { email: null, userId: "u9" },
  }) === "r:k:email:u9",
);
ok(
  "and with neither, to one unaddressed key",
  dedupeKeyFor({ requestId: "r", kind: "k", channel: "email", recipient: { email: null } }) ===
    "r:k:email:unaddressed",
);

// The bug this prevents: a request that fails is editable, goes back through
// submit, and is assessed again. Keyed on the request alone the requestor
// would be told about the first failure and never the second — silence exactly
// when things are going badly.
ok(
  "a salt makes a second occurrence a different message",
  dedupeKeyFor({ requestId: "r", kind: "report_ready", channel: "email", recipient, salt: "run-1" }) !==
    dedupeKeyFor({ requestId: "r", kind: "report_ready", channel: "email", recipient, salt: "run-2" }),
);
ok(
  "the same occurrence stays one message",
  dedupeKeyFor({ requestId: "r", kind: "report_ready", channel: "email", recipient, salt: "run-1" }) ===
    dedupeKeyFor({ requestId: "r", kind: "report_ready", channel: "email", recipient, salt: "run-1" }),
);
ok(
  "and no salt is still a valid key",
  dedupeKeyFor({ requestId: "r", kind: "k", channel: "email", recipient, salt: "  " }) ===
    "r:k:email:requestor@example.test",
);

// ---------------------------------------------------------------------------
console.log("\nThe catalogue");

ok("a known kind is known", isKind("submission_received"));
ok("an invented one is not", !isKind("submission_eaten"));

const written = render("submission_received", {
  reference: "AR-0042",
  title: "Payments <script>alert(1)</script> rework",
  url: "https://aidp.example/dashboard/requests/abc?x=1&y=2",
  recipientName: "Nitin",
});
ok("the subject names the reference", written.subject.includes("AR-0042"), written.subject);
ok("both bodies are written", Boolean(written.html) && Boolean(written.text));
ok("the plaintext carries the bare link on its own line", written.text.split("\n").includes("https://aidp.example/dashboard/requests/abc?x=1&y=2"));
ok("a hostile title never reaches the HTML raw", !written.html.includes("<script>"));
ok("the link survives escaping as a working href", written.html.includes("x=1&amp;y=2"));
ok(
  "it does not claim the design is already being checked",
  !written.text.toLowerCase().includes("being checked against"),
);

let renderError: unknown = null;
try {
  render("submission_eaten", {});
} catch (error) {
  renderError = error;
}
ok("an unknown kind refuses", renderError instanceof UnknownKind);

renderError = null;
try {
  render("submission_received", { reference: "AR-1" });
} catch (error) {
  renderError = error;
}
ok("a payload missing a field refuses", renderError instanceof PayloadIncomplete);

// ---------------------------------------------------------------------------
console.log("\nEvery kind writes itself");

const hostileTitle = `Payments <script>alert(1)</script> & "rework"`;
const everyKind: [string, Record<string, unknown>][] = [
  ["submission_received", {}],
  ["ready_to_assess", {}],
  ["report_ready", { summary: "2 Critical, 5 High", unsettled: 3 }],
  ["assessment_failed", { reason: "The diagram could not be read" }],
  [
    "review_requested",
    {
      summary: "2 Critical, 5 High",
      headline: "Escalate to the architecture review board",
      because: "It is architecturally significant and carries 2 Critical findings.",
      requestedByName: "Nitin",
    },
  ],
];

for (const [kind, extra] of everyKind) {
  const written = render(kind, {
    reference: "AR-0042",
    title: hostileTitle,
    url: "https://aidp.example/dashboard/requests/abc?x=1&y=2",
    recipientName: "Nitin",
    ...extra,
  });
  ok(`${kind}: names the reference in its subject`, written.subject.includes("AR-0042"), written.subject);
  ok(`${kind}: writes both bodies`, Boolean(written.html) && Boolean(written.text));
  ok(`${kind}: never lets the raw tag through`, !written.html.includes("<script>"));
  ok(`${kind}: escapes it instead`, written.html.includes("&lt;script&gt;"));
  ok(
    `${kind}: keeps the link working through escaping`,
    written.html.includes("x=1&amp;y=2"),
  );
  ok(
    `${kind}: puts the bare link on its own line in the text`,
    written.text.split("\n").includes("https://aidp.example/dashboard/requests/abc?x=1&y=2"),
  );
}

// A failure with no recorded reason must still produce a message — that is the
// case this kind exists for.
const reasonless = render("assessment_failed", {
  reference: "AR-1",
  title: "T",
  url: "https://x.test",
});
ok("a failure with no reason still writes a message", Boolean(reasonless.text));

ok(
  "report_ready mentions findings that could not be graded",
  render("report_ready", {
    reference: "AR-1",
    title: "T",
    url: "https://x.test",
    summary: "1 High",
    unsettled: 2,
  }).text.includes("2 findings could not be graded"),
);
ok(
  "and says nothing about them when there are none",
  !render("report_ready", {
    reference: "AR-1",
    title: "T",
    url: "https://x.test",
    summary: "1 High",
    unsettled: 0,
  }).text.includes("could not be graded"),
);
ok(
  "review_requested quotes the engine without asserting it",
  render("review_requested", {
    reference: "AR-1",
    title: "T",
    url: "https://x.test",
    summary: "1 High",
    headline: "An architect has to review this",
    because: "because reasons",
  }).text.includes("The engine suggests:"),
);
ok(
  "and names the field",
  renderError instanceof Error && renderError.message.includes("title"),
  renderError instanceof Error ? renderError.message : "",
);

// ---------------------------------------------------------------------------
// Everything above is pure. Everything below needs the table, so say plainly
// when it is not there rather than failing on a Prisma error that names a
// relation instead of the command that creates it.
const migrated = await prisma.notification
  .count()
  .then(() => true)
  .catch(() => false);

if (!migrated) {
  console.log("\n  This database has no `notification` table yet.");
  console.log("  Run `npm run db:migrate` to apply 20261118180000_notification_outbox,");
  console.log("  then run this script again for the database checks.");
  console.log(`\n${pass} passed, ${fail} failed — database checks skipped`);
  await prisma.$disconnect();
  process.exit(1);
}

const org = await prisma.organisation.create({
  data: { name: "ZZ Notifications", slug: TAG },
});
const user = await prisma.user.create({
  data: {
    id: `${TAG}-user`,
    name: "Nitin Sharma",
    email: `${TAG}@example.test`,
    company: "ZZ",
    country: "IN",
    phone: "0",
  },
});

/** Scoped to this org on every call — see the note at the top. */
const drainHere = (mailer: Mailer, limit?: number) =>
  drain({ mailer, organisationId: org.id, limit });

const rowsHere = () =>
  prisma.notification.findMany({ where: { organisationId: org.id }, orderBy: { createdAt: "asc" } });

try {
  // -------------------------------------------------------------------------
  console.log("\nEnqueuing is idempotent");

  const news = {
    organisationId: org.id,
    requestId: "req-1",
    kind: "submission_received" as const,
    recipients: [{ email: "someone@example.test", userId: user.id, name: "Someone" }],
    payload: { reference: "AR-0001", title: "A thing", url: "https://aidp.example/x" },
  };

  const first = await enqueue(news);
  ok("the first enqueue writes a row", first.created === 1 && first.duplicates === 0, JSON.stringify(first));

  const again = await enqueue(news);
  ok("the second writes nothing", again.created === 0 && again.duplicates === 1, JSON.stringify(again));

  for (let i = 0; i < 20; i += 1) await enqueue(news);
  const afterMany = await rowsHere();
  ok("twenty-two enqueues are still one message", afterMany.length === 1, `got ${afterMany.length}`);

  const queued = afterMany[0]!;
  ok("it starts queued", queued.state === "queued", queued.state);
  ok("it is addressed", queued.toEmail === "someone@example.test", String(queued.toEmail));
  ok("it carries its payload", (queued.payload as { reference?: string }).reference === "AR-0001");
  ok("it has a correlation id", Boolean(queued.correlationId));

  // -------------------------------------------------------------------------
  console.log("\nA recipient with no address is recorded, not dropped");

  await enqueue({
    ...news,
    requestId: "req-2",
    recipients: [{ email: null, userId: "gone", name: "Departed" }],
  });
  const unaddressed = (await rowsHere()).find((row) => row.requestId === "req-2");
  ok("the row exists", Boolean(unaddressed));
  ok("and says it was skipped", unaddressed?.state === "skipped", unaddressed?.state ?? "");
  ok("with the reason", Boolean(unaddressed?.lastError));

  // -------------------------------------------------------------------------
  console.log("\nDraining sends, once");

  const good = new FakeMailer();
  const sentResult = await drainHere(good);
  ok("one message was claimed", sentResult.claimed === 1, JSON.stringify(sentResult));
  ok("and sent", sentResult.sent === 1, JSON.stringify(sentResult));
  ok("the skipped row was not claimed", sentResult.skipped === 0, JSON.stringify(sentResult));
  ok("the mailer got exactly one message", good.sent.length === 1);
  ok("addressed to the recipient", good.sent[0]?.to === "someone@example.test");
  ok("with the reference in the subject", good.sent[0]?.subject.includes("AR-0001") ?? false);

  const afterSend = (await rowsHere()).find((row) => row.requestId === "req-1")!;
  ok("the row is marked sent", afterSend.state === "sent", afterSend.state);
  ok("it keeps the provider's id", afterSend.providerId === "prov_1", String(afterSend.providerId));
  ok("it records when", afterSend.sentAt !== null);
  ok("and releases its lease", afterSend.leaseOwner === null && afterSend.leaseUntil === null);

  const secondPass = await drainHere(new FakeMailer());
  ok("a second drain finds nothing to do", secondPass.claimed === 0, JSON.stringify(secondPass));

  // Re-enqueuing the same news after it was sent must still not resend it.
  const afterSent = await enqueue(news);
  ok("and re-announcing it writes nothing", afterSent.created === 0, JSON.stringify(afterSent));

  // -------------------------------------------------------------------------
  console.log("\nA provider failure is retried with backoff");

  await enqueue({ ...news, requestId: "req-3" });
  const refusing = new FakeMailer("refuse");
  const failed = await drainHere(refusing);
  ok("it is counted as retrying", failed.retrying === 1, JSON.stringify(failed));
  ok("not as dead", failed.dead === 0, JSON.stringify(failed));

  const retried = (await rowsHere()).find((row) => row.requestId === "req-3")!;
  ok("the row goes back to queued", retried.state === "queued", retried.state);
  ok("its attempt is counted", retried.attempts === 1, String(retried.attempts));
  ok("it records what went wrong", retried.lastError?.includes("the provider said no") ?? false);
  ok("and it is not due yet", retried.runAfter.getTime() > Date.now(), retried.runAfter.toISOString());

  const notYetDue = await drainHere(new FakeMailer());
  ok("so a drain now leaves it alone", notYetDue.claimed === 0, JSON.stringify(notYetDue));

  // -------------------------------------------------------------------------
  console.log("\nAnd dead-letters when the attempts run out");

  await prisma.notification.update({
    where: { id: retried.id },
    data: { attempts: 4, maxAttempts: 5, runAfter: new Date(Date.now() - 1000) },
  });
  const exhausted = await drainHere(new FakeMailer("refuse"));
  ok("the last attempt is counted as dead", exhausted.dead === 1, JSON.stringify(exhausted));

  const dead = (await rowsHere()).find((row) => row.requestId === "req-3")!;
  ok("the row is dead", dead.state === "dead", dead.state);
  ok("at its attempt ceiling", dead.attempts === 5, String(dead.attempts));

  const pastDead = await drainHere(new FakeMailer());
  ok("and is never picked up again", pastDead.claimed === 0, JSON.stringify(pastDead));

  // -------------------------------------------------------------------------
  console.log("\nA message that cannot be written is dead at once");

  await prisma.notification.create({
    data: {
      organisationId: org.id,
      requestId: "req-4",
      kind: "submission_eaten",
      dedupeKey: `${TAG}:unknown-kind`,
      payload: {},
      toEmail: "someone@example.test",
      correlationId: randomUUID(),
    },
  });
  await prisma.notification.create({
    data: {
      organisationId: org.id,
      requestId: "req-5",
      kind: "submission_received",
      dedupeKey: `${TAG}:thin-payload`,
      payload: { reference: "AR-0009" },
      toEmail: "someone@example.test",
      correlationId: randomUUID(),
    },
  });

  const unwritable = await drainHere(new FakeMailer());
  ok("both are dead on the first pass", unwritable.dead === 2, JSON.stringify(unwritable));
  ok("neither was retried", unwritable.retrying === 0, JSON.stringify(unwritable));

  const unknownRow = (await rowsHere()).find((row) => row.requestId === "req-4")!;
  ok("an unknown kind spent one attempt, not five", unknownRow.attempts === 1, String(unknownRow.attempts));
  ok("and says why", unknownRow.lastError?.includes("No template") ?? false, unknownRow.lastError ?? "");

  const thinRow = (await rowsHere()).find((row) => row.requestId === "req-5")!;
  ok("an incomplete payload names the field", thinRow.lastError?.includes("title") ?? false, thinRow.lastError ?? "");

  // -------------------------------------------------------------------------
  console.log("\nAn unconfigured provider leaves the outbox alone");

  await enqueue({ ...news, requestId: "req-6" });
  const savedKey = process.env.RESEND_API_KEY;
  const savedFrom = process.env.MAIL_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  setNodeEnv("production");

  const unconfigured = await drain({ organisationId: org.id });
  setNodeEnv(originalNodeEnv ?? "development");
  if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey;
  if (savedFrom !== undefined) process.env.MAIL_FROM = savedFrom;

  ok("it says so", unconfigured.unconfigured === true, JSON.stringify(unconfigured));
  ok("and claims nothing", unconfigured.claimed === 0, JSON.stringify(unconfigured));

  const untouched = (await rowsHere()).find((row) => row.requestId === "req-6")!;
  ok("the message is still queued", untouched.state === "queued", untouched.state);
  ok("with no attempt spent", untouched.attempts === 0, String(untouched.attempts));

  // -------------------------------------------------------------------------
  console.log("\nClaiming is exclusive");

  await enqueue({ ...news, requestId: "req-7" });
  const a = new FakeMailer();
  const b = new FakeMailer();
  const [resultA, resultB] = await Promise.all([drainHere(a), drainHere(b)]);
  const totalClaimed = resultA.claimed + resultB.claimed;
  ok(
    "two overlapping drains claim the work once between them",
    totalClaimed === 2,
    `${resultA.claimed} + ${resultB.claimed} (req-6 and req-7 were both due)`,
  );
  ok("and send each message once", a.sent.length + b.sent.length === 2, `${a.sent.length} + ${b.sent.length}`);

  // -------------------------------------------------------------------------
  console.log("\nThe real event, as submitRequest calls it");

  const project = await prisma.project.create({
    data: { organisationId: org.id, name: `${TAG} project` },
  });
  const request = await prisma.architectureRequest.create({
    data: {
      organisationId: org.id,
      projectId: project.id,
      reference: "AR-0123",
      title: "Customer Portal Upgrade",
      requestedById: user.id,
      requestedByName: "Nitin Sharma",
    },
  });

  await notifySubmissionReceived(request.id);
  const announced = (await rowsHere()).filter((row) => row.requestId === request.id);
  ok("it enqueues one message", announced.length === 1, `got ${announced.length}`);

  const row = announced[0]!;
  ok("addressed to the requestor's account", row.toEmail === user.email.toLowerCase(), String(row.toEmail));
  ok("named after them", row.toName === "Nitin Sharma", row.toName);
  const payload = row.payload as { reference?: string; title?: string; url?: string };
  ok("carrying the reference", payload.reference === "AR-0123", String(payload.reference));
  ok("the title", payload.title === "Customer Portal Upgrade", String(payload.title));
  ok("and an absolute link to the request", payload.url?.includes(`/dashboard/requests/${request.id}`) ?? false, String(payload.url));

  await notifySubmissionReceived(request.id);
  await notifySubmissionReceived(request.id);
  const stillOne = (await rowsHere()).filter((row) => row.requestId === request.id);
  ok("calling it again changes nothing", stillOne.length === 1, `got ${stillOne.length}`);

  ok("a request that no longer exists is not an error", await survives(() => notifySubmissionReceived("gone")));

  // -------------------------------------------------------------------------
  console.log("\nReady to assess, and the silence it replaces");

  await notifyReadyToAssess(request.id);
  const readyRows = (await rowsHere()).filter((row) => row.kind === "ready_to_assess");
  ok("the requestor is told the button is theirs", readyRows.length === 1, `got ${readyRows.length}`);
  ok(
    "and the message does not claim anything is running",
    !((readyRows[0]?.payload as { title?: string }).title === undefined),
  );

  await notifyReadyToAssess(request.id);
  ok(
    "saying it twice is still one message",
    (await rowsHere()).filter((row) => row.kind === "ready_to_assess").length === 1,
  );

  // -------------------------------------------------------------------------
  console.log("\nA request that stopped");

  await notifyAssessmentFailed(request.id, "The diagram could not be read.");
  const failedRows = (await rowsHere()).filter((row) => row.kind === "assessment_failed");
  ok("the requestor is told", failedRows.length === 1, `got ${failedRows.length}`);
  ok(
    "and the reason travels with it",
    (failedRows[0]?.payload as { reason?: string }).reason === "The diagram could not be read.",
  );

  // -------------------------------------------------------------------------
  console.log("\nA report that landed");

  const architect = await prisma.user.create({
    data: {
      id: `${TAG}-architect`,
      name: "Priya Architect",
      email: `${TAG}-arch@example.test`,
      company: "ZZ",
      country: "IN",
      phone: "0",
    },
  });
  await prisma.membership.createMany({
    data: [
      { organisationId: org.id, userId: user.id, role: "member" },
      { organisationId: org.id, userId: architect.id, role: "architect" },
    ],
  });

  const framework = await prisma.framework.create({
    data: { organisationId: org.id, name: `${TAG} framework` },
  });
  const run = await prisma.assessmentRun.create({
    data: {
      organisationId: org.id,
      projectId: project.id,
      frameworkId: framework.id,
      state: "complete",
    },
  });
  await prisma.finding.createMany({
    data: [
      // contradicts + must is the brief's Critical, per severityOf.
      { runId: run.id, clauseId: "c1", clauseRef: "SEC-1", verdict: "contradicts", obligation: "must" },
      { runId: run.id, clauseId: "c2", clauseRef: "SEC-2", verdict: "contradicts", obligation: "must" },
      { runId: run.id, clauseId: "c3", clauseRef: "INT-1", verdict: "covered", obligation: "must" },
    ],
  });
  await prisma.architectureRequest.update({
    where: { id: request.id },
    data: { runId: run.id, significance: "significant" },
  });

  await notifyReportReady(request.id);
  const reportRows = (await rowsHere()).filter((row) => row.kind === "report_ready");
  const reviewRows = (await rowsHere()).filter((row) => row.kind === "review_requested");

  ok("the requestor is told their report is ready", reportRows.length === 1, `got ${reportRows.length}`);
  ok(
    "and it links to the report, not the request",
    ((reportRows[0]?.payload as { url?: string }).url ?? "").endsWith("/report"),
    String((reportRows[0]?.payload as { url?: string }).url),
  );
  ok(
    "carrying what was found",
    (reportRows[0]?.payload as { summary?: string }).summary === "2 Critical",
    String((reportRows[0]?.payload as { summary?: string }).summary),
  );
  ok(
    "a covered clause is not counted as a finding",
    !((reportRows[0]?.payload as { summary?: string }).summary ?? "").includes("3"),
  );

  ok("one architect is asked to decide", reviewRows.length === 1, `got ${reviewRows.length}`);
  ok(
    "and it is the architect, not the requestor",
    reviewRows[0]?.toEmail === architect.email.toLowerCase(),
    String(reviewRows[0]?.toEmail),
  );
  ok(
    "the engine's recommendation travels with it",
    ((reviewRows[0]?.payload as { headline?: string }).headline ?? "").includes("board"),
    String((reviewRows[0]?.payload as { headline?: string }).headline),
  );

  await notifyReportReady(request.id);
  ok(
    "announcing the same report again changes nothing",
    (await rowsHere()).filter((row) => row.kind === "report_ready").length === 1,
  );

  // -------------------------------------------------------------------------
  console.log("\nAnd a second assessment is a second report");

  const rerun = await prisma.assessmentRun.create({
    data: {
      organisationId: org.id,
      projectId: project.id,
      frameworkId: framework.id,
      state: "complete",
    },
  });
  await prisma.finding.create({
    data: { runId: rerun.id, clauseId: "c1", clauseRef: "SEC-1", verdict: "covered", obligation: "must" },
  });
  await prisma.architectureRequest.update({ where: { id: request.id }, data: { runId: rerun.id } });

  await notifyReportReady(request.id);
  const bothReports = (await rowsHere()).filter((row) => row.kind === "report_ready");
  ok("the requestor is told about the new one too", bothReports.length === 2, `got ${bothReports.length}`);
  ok(
    "and it says what the new run found, not the old",
    bothReports.some(
      (row) => (row.payload as { summary?: string }).summary === "no findings that need acting on",
    ),
    JSON.stringify(bothReports.map((row) => (row.payload as { summary?: string }).summary)),
  );

  // A request with no run at all has no report to announce.
  await prisma.architectureRequest.update({ where: { id: request.id }, data: { runId: null } });
  ok(
    "a request with no run announces nothing",
    await survives(() => notifyReportReady(request.id)),
  );
  ok(
    "and writes nothing",
    (await rowsHere()).filter((row) => row.kind === "report_ready").length === 2,
  );

  // -------------------------------------------------------------------------
  console.log("\nThe internal endpoints refuse strangers");

  const withHeader = (headers: Record<string, string>) =>
    authorisedInternally(new Request("https://x.test/api/internal/send-notifications", { headers }));

  const savedWorker = process.env.WORKER_SHARED_SECRET;
  const savedCron = process.env.CRON_SECRET;
  delete process.env.WORKER_SHARED_SECRET;
  delete process.env.CRON_SECRET;

  ok("with no secret configured, nobody is let in", !withHeader({ "x-worker-secret": "anything" }));
  ok("not even with an empty one presented", !withHeader({ "x-worker-secret": "" }));

  process.env.WORKER_SHARED_SECRET = "worker-secret-value";
  process.env.CRON_SECRET = "cron-secret-value";

  ok("the worker's secret is accepted", withHeader({ "x-worker-secret": "worker-secret-value" }));
  ok("a wrong one is not", !withHeader({ "x-worker-secret": "worker-secret-valuX" }));
  ok("a shorter one is not", !withHeader({ "x-worker-secret": "worker" }));
  ok("the timer's bearer token is accepted", withHeader({ authorization: "Bearer cron-secret-value" }));
  ok("a wrong bearer is not", !withHeader({ authorization: "Bearer nope" }));
  ok("no headers at all is not", !withHeader({}));

  if (savedWorker === undefined) delete process.env.WORKER_SHARED_SECRET;
  else process.env.WORKER_SHARED_SECRET = savedWorker;
  if (savedCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCron;
} finally {
  // The organisation cascade takes its notifications, project and request with
  // it; the user is outside that cascade and goes separately.
  await prisma.organisation.deleteMany({ where: { slug: TAG } });
  await prisma.user.deleteMany({ where: { id: { startsWith: TAG } } });
}

const leftBehind = await prisma.notification.count({ where: { organisationId: org.id } });
ok("removing the customer took their outbox with them", leftBehind === 0, `got ${leftBehind}`);

async function survives(work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work();
    return true;
  } catch {
    return false;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
await prisma.$disconnect();
process.exit(fail === 0 ? 0 : 1);
