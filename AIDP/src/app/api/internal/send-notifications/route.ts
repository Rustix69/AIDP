import { NextResponse } from "next/server";
import { authorisedInternally } from "@/lib/access/internal-auth";
import { drain } from "@/lib/notifications/drain";

/**
 * Send whatever the outbox owes.
 *
 *   POST /api/internal/send-notifications
 *   GET  /api/internal/send-notifications
 *     → { claimed, sent, skipped, retrying, dead, unconfigured }
 *
 * ## What actually guarantees delivery
 *
 * Three things, in the order they usually fire.
 *
 * The server action that enqueued a message drains in `after()`, so the common
 * case is sent within a second of the news and nothing waits on this endpoint
 * at all.
 *
 * A drain pass takes *everything* that is due, not only what the caller just
 * wrote. So any message left behind — by a process that died mid-send, by a
 * provider that was briefly down — goes out on the next pass that anybody
 * triggers. In a system with traffic that is self-healing, and it is the same
 * bet /api/internal/advance-requests already makes.
 *
 * This endpoint is the third: somewhere for a timer to point. Vercel's Hobby
 * plan allows one cron a day, which is too coarse to be the primary path but
 * exactly right as a floor under a quiet week — a message enqueued on Friday
 * with nothing else happening still leaves before Monday. Add it when the plan
 * allows:
 *
 *   { "crons": [{ "path": "/api/internal/send-notifications", "schedule": "0 * * * *" }] }
 *
 * It is deliberately not wired by default, for the same reason the advance
 * endpoint is not: a `crons` entry on a plan that refuses it fails the
 * deployment rather than the feature.
 *
 * ## Safe to call as often as you like
 *
 * Every row is claimed under a lease before anything is sent, so two callers
 * overlapping take different work rather than the same work twice. A call with
 * nothing to do is three indexed queries returning nothing.
 *
 * ## Who may call it
 *
 * A worker or a timer, proving itself with one of the two secrets in
 * src/lib/access/internal-auth.ts.
 */

export const runtime = "nodejs";
/** Sends mail and writes rows on every call; a cached response would be a lie. */
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  if (!authorisedInternally(request)) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  const result = await drain();
  return NextResponse.json(result);
}

export const POST = handle;
/** Vercel Cron issues a GET. The work is the same. */
export const GET = handle;
