import { timingSafeEqual } from "node:crypto";

/**
 * Who may call the endpoints under /api/internal.
 *
 * These are machine entrances, not people's. Nothing behind them has a session,
 * and what they do — starting billable model work, handing back a decrypted
 * customer key, sending mail to a customer's staff — is work nobody anonymous
 * should be able to cause.
 *
 * Two callers, and each proves itself differently.
 *
 * The Python workers present `WORKER_SHARED_SECRET` through `x-worker-secret`,
 * the header they already use for /api/internal/credentials and
 * /api/internal/files. They hold that secret wherever they run, so this needs
 * no new configuration anywhere. The same header is what drives one of these by
 * hand or from a test.
 *
 * Vercel Cron signs its own requests with `CRON_SECRET`, sent as a bearer token
 * when a variable of exactly that name is set on the project. Accepted so that
 * adding a `crons` entry to vercel.json is all a timer takes.
 *
 * With neither configured every call is refused. "No secret set" is a
 * deployment that has not finished rather than a reason to let anyone in, and
 * an endpoint that is open by omission is the kind of mistake nobody notices
 * until it matters.
 *
 * Shared rather than copied into each route: two routes drifting apart on how
 * they check a secret is a class of bug worth spending a file to prevent.
 */

function matches(presented: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // Constant-time, and length-guarded because timingSafeEqual throws on a
  // mismatch rather than returning false.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether this request carries one of the two secrets. */
export function authorisedInternally(request: Request): boolean {
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer && matches(bearer, process.env.CRON_SECRET)) return true;

  const worker = request.headers.get("x-worker-secret") ?? "";
  return Boolean(worker) && matches(worker, process.env.WORKER_SHARED_SECRET);
}
