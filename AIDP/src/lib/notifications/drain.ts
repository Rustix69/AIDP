import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { MailNotConfigured, type Mailer, mailer } from "./mailer";
import { PayloadIncomplete, UnknownKind, render } from "./kinds";

/**
 * Emptying the outbox.
 *
 * ## Claiming
 *
 * Two drainers can run at once — a server action's `after()` and a scheduled
 * call, or two actions in the same second — and both must not send the same
 * message. The claim is the optimistic one: read some ids, then update them
 * with the state they were read in still in the WHERE clause, then read back
 * what carries this run's lease id. Postgres re-evaluates that predicate
 * against the committed row, so of two drainers reaching for one row exactly
 * one takes it and the other sees it already leased.
 *
 * This is `FOR UPDATE SKIP LOCKED` in Workers/aidp/queue.py's shape, written
 * in the query builder instead of raw SQL because the volume here is a handful
 * of rows and the contention is two callers rather than four worker fleets.
 *
 * An expired lease is claimable again. That is what recovers a drainer killed
 * between leasing a row and sending it — the row would otherwise sit `leased`
 * for ever, which is the one state nothing else would ever look at.
 *
 * ## Failing
 *
 * Two kinds, and they are not treated alike.
 *
 * A message that cannot be *written* — an unknown kind, a payload missing a
 * field — is dead immediately. Waiting will not supply the field. Retrying
 * those would spend the budget proving a point nobody is arguing.
 *
 * A message that cannot be *sent* is retried with the backoff queue.py uses:
 * `min(3600, 2^attempts)` seconds, dead-lettering at `maxAttempts`. A provider
 * is usually briefly unavailable rather than permanently hostile, and the cap
 * stops a long outage from pushing a retry a week into the future.
 *
 * ## Being unconfigured is not a failure
 *
 * With no provider set, rows stay queued and nothing is attempted. Burning
 * five attempts against an absent provider would dead-letter a day's mail for
 * a missing environment variable, and the messages would still be owed. They
 * wait instead, and go out when somebody sets the key.
 */

const QUEUED = "queued";
const LEASED = "leased";
const SENT = "sent";
const SKIPPED = "skipped";
const DEAD = "dead";

/** Long enough for a slow provider, short enough that a dead drainer's rows
 *  come back while somebody is still watching. */
const LEASE_MS = 2 * 60 * 1000;

/** Per pass. Small because a pass runs inside a request's `after()`, and a
 *  long one would outlive the function's budget — the next pass takes the
 *  rest, and nothing is lost in the meantime. */
const DEFAULT_LIMIT = 25;

/** The ceiling queue.py uses. An hour is long enough to ride out an outage
 *  and short enough that recovery is not an overnight wait. */
const BACKOFF_CAP_SECONDS = 3600;

export type DrainResult = {
  claimed: number;
  sent: number;
  skipped: number;
  /** Failed this pass and will be tried again. */
  retrying: number;
  /** Out of attempts, or impossible to write. Needs a person. */
  dead: number;
  /** No provider is configured; nothing was attempted and nothing was lost. */
  unconfigured: boolean;
};

const nothing = (unconfigured = false): DrainResult => ({
  claimed: 0,
  sent: 0,
  skipped: 0,
  retrying: 0,
  dead: 0,
  unconfigured,
});

function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_CAP_SECONDS, 2 ** Math.max(1, attempts));
}

/** Permanent: no amount of waiting makes this message writable. */
function unwritable(error: unknown): boolean {
  return error instanceof UnknownKind || error instanceof PayloadIncomplete;
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

export type DrainOptions = {
  limit?: number;
  /** Injected by the verification script so it can drain without a provider.
   *  Production passes nothing and gets the environment's own. */
  mailer?: Mailer;
  /**
   * Drain one customer's outbox rather than everything due.
   *
   * Production passes nothing: a timer or an `after()` should carry off
   * whatever is owed, to anyone. This exists because a drain with no scope is
   * a drain over *every* customer's pending mail, which makes it unsafe to
   * exercise against a database with real rows in it —
   * scripts/verify-notifications.mts scopes itself to a throwaway organisation
   * so a test can never mark somebody's unsent message as sent.
   *
   * It is also the handle an operator wants when one customer's mail has
   * dead-lettered and theirs is the only outbox worth retrying.
   */
  organisationId?: string;
};

export async function drain(options: DrainOptions = {}): Promise<DrainResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;

  let send: Mailer;
  try {
    send = options.mailer ?? mailer();
  } catch (error) {
    if (error instanceof MailNotConfigured) return nothing(true);
    throw error;
  }

  const now = new Date();
  // Email only. A portal notification is delivered by rendering it on a screen,
  // which is a different drain; claiming those here would mark them sent
  // without anybody having seen one.
  const claimable = {
    channel: "email",
    ...(options.organisationId ? { organisationId: options.organisationId } : {}),
    OR: [
      { state: QUEUED, runAfter: { lte: now } },
      { state: LEASED, leaseUntil: { lt: now } },
    ],
  };

  const candidates = await prisma.notification.findMany({
    where: claimable,
    // Oldest due first, so a retry cannot be starved by fresh arrivals.
    orderBy: { runAfter: "asc" },
    take: limit,
    select: { id: true },
  });
  if (candidates.length === 0) return nothing();

  const leaseOwner = randomUUID();
  await prisma.notification.updateMany({
    where: { id: { in: candidates.map((row) => row.id) }, ...claimable },
    data: {
      state: LEASED,
      leaseOwner,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      attempts: { increment: 1 },
    },
  });

  // Whatever carries this run's lease id is ours and nobody else's.
  const claimed = await prisma.notification.findMany({
    where: { leaseOwner, state: LEASED },
  });

  const result = nothing();
  result.claimed = claimed.length;

  for (const row of claimed) {
    // Defensive: enqueue() writes these straight to `skipped`, so reaching one
    // here means an address was cleared after the fact.
    if (!row.toEmail) {
      await prisma.notification.update({
        where: { id: row.id },
        data: {
          state: SKIPPED,
          lastError: "No address for this recipient.",
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      result.skipped += 1;
      continue;
    }

    try {
      const composed = render(row.kind, row.payload);
      const { id } = await send.send({ to: row.toEmail, ...composed });

      await prisma.notification.update({
        where: { id: row.id },
        data: {
          state: SENT,
          sentAt: new Date(),
          providerId: id,
          lastError: null,
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      result.sent += 1;
    } catch (error) {
      const permanent = unwritable(error) || row.attempts >= row.maxAttempts;

      await prisma.notification.update({
        where: { id: row.id },
        data: {
          state: permanent ? DEAD : QUEUED,
          lastError: reason(error),
          leaseOwner: null,
          leaseUntil: null,
          ...(permanent
            ? {}
            : {
                runAfter: new Date(Date.now() + backoffSeconds(row.attempts) * 1000),
              }),
        },
      });

      if (permanent) result.dead += 1;
      else result.retrying += 1;
    }
  }

  return result;
}
