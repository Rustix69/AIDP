import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../prisma";
import type { Channel, Kind } from "./kinds";

/**
 * Putting a message in the outbox.
 *
 * ## Why this is a row and not a send
 *
 * Sending inline would make a person wait on somebody else's API, and would
 * lose the message entirely if that API were down — with no record that it was
 * ever owed. A row is written in the same breath as the thing it is about, and
 * src/lib/notifications/drain.ts worries about delivery separately. The queue
 * in Workers/aidp/queue.py makes the same trade for the same reasons.
 *
 * ## The duplicate problem this exists to solve
 *
 * The screens repair their own state as they render — `advanceSubmitted` and
 * `advanceChecking` are called from `requests/page.tsx` on every load, which is
 * deliberate and documented there. So the code that notices "this request has
 * moved on" runs constantly, and anything hung off it runs constantly too.
 * Without a guard, one submission would mean an email per page view.
 *
 * The guard is `dedupeKey` and its unique index, with `skipDuplicates` turning
 * the insert into ON CONFLICT DO NOTHING — the same shape `enqueue()` in
 * queue.py uses against its partial unique index, where a conflict is likewise
 * a success rather than an error. Callers may therefore enqueue as often as
 * they like, and are expected to.
 *
 * ## A recipient with no address is recorded, not dropped
 *
 * Every recipient in this schema is `onDelete: SetNull` beside a denormalised
 * name, so "we owed this person a message and had nowhere to send it" is a real
 * state. It is written as `skipped`, which is an outcome and not a failure: a
 * silently dropped recipient leaves an audit trail that quietly disagrees with
 * what happened.
 */

const QUEUED = "queued";
const SKIPPED = "skipped";

export type Recipient = {
  /** Null when the account is gone, or was never there. */
  email: string | null;
  userId?: string | null;
  name?: string;
};

export type EnqueueInput = {
  organisationId: string;
  /** Null for messages about an account rather than a submission. */
  requestId?: string | null;
  kind: Kind;
  /** Defaults to email. */
  channel?: Channel;
  recipients: Recipient[];
  /** Everything the template needs, captured now. See kinds.ts. */
  payload: Record<string, unknown>;
  /**
   * What tells one occurrence of this event from the next — the run id, for
   * anything that happens once per assessment. Omit it for an event that
   * happens once in a request's life. See `dedupeKeyFor`.
   */
  dedupeSalt?: string | null;
  /** Matches the correlation id of the work that caused this, where there is
   *  one. A fresh one is minted otherwise. */
  correlationId?: string;
};

export type EnqueueResult = {
  /** Rows this call actually created. */
  created: number;
  /** Recipients whose message was already owed. Expected, not an error. */
  duplicates: number;
};

/**
 * What makes a message the only one of its kind.
 *
 * `requestId:kind:channel:recipient`, with an optional salt on the end. The
 * address is lower-cased so that a recipient recorded two different ways is
 * still one person, and a recipient with no address at all collapses to a
 * single key — there is nothing to tell two unreachable people apart by, and
 * pretending otherwise would write two rows nobody can act on.
 *
 * ## Why there is a salt
 *
 * Without one, "one message per request per kind" is wrong for every event that
 * can happen twice. A request that fails is editable: it goes back through
 * submit, becomes ready again, is assessed again, and produces a second report.
 * Keyed on the request alone, the requestor is told about the first of each and
 * never the rest — and the silence is worst exactly when things are going
 * badly, which is when somebody is actually waiting to hear.
 *
 * So callers whose event can recur pass something that differs between
 * occurrences and holds still within one — the run id, usually, since a new
 * assessment is a new run. Callers whose event genuinely happens once per
 * request pass nothing.
 */
export function dedupeKeyFor(input: {
  requestId?: string | null;
  kind: string;
  channel: string;
  recipient: Recipient;
  salt?: string | null;
}): string {
  const who =
    input.recipient.email?.trim().toLowerCase() ||
    input.recipient.userId?.trim() ||
    "unaddressed";
  const base = [input.requestId ?? "-", input.kind, input.channel, who];
  const salt = input.salt?.trim();
  return (salt ? [...base, salt] : base).join(":");
}

/**
 * Write the rows for one piece of news.
 *
 * Pass `client` to join a transaction that is already open — the state change
 * and the news of it should commit together or not at all. Called without one
 * it writes on its own, which is right when the change it describes has
 * already been committed by a caller that was not transactional.
 */
export async function enqueue(
  input: EnqueueInput,
  client: Prisma.TransactionClient = prisma,
): Promise<EnqueueResult> {
  const channel: Channel = input.channel ?? "email";
  const correlationId = input.correlationId ?? randomUUID();

  const rows = input.recipients.map((recipient) => {
    const addressed = Boolean(recipient.email?.trim());
    return {
      organisationId: input.organisationId,
      requestId: input.requestId ?? null,
      kind: input.kind,
      dedupeKey: dedupeKeyFor({
        requestId: input.requestId,
        kind: input.kind,
        channel,
        recipient,
        salt: input.dedupeSalt,
      }),
      channel,
      toEmail: recipient.email?.trim().toLowerCase() ?? null,
      toUserId: recipient.userId ?? null,
      toName: recipient.name?.trim() ?? "",
      payload: input.payload as Prisma.InputJsonValue,
      state: addressed ? QUEUED : SKIPPED,
      lastError: addressed ? null : "No address for this recipient.",
      correlationId,
    };
  });

  if (rows.length === 0) return { created: 0, duplicates: 0 };

  const { count } = await client.notification.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return { created: count, duplicates: rows.length - count };
}
