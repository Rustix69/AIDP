import { after, NextResponse } from "next/server";
import { authorisedInternally } from "@/lib/access/internal-auth";
import { advanceChecking } from "@/lib/ingest/requests";
import { drain } from "@/lib/notifications/drain";

/**
 * Move a request past "checking" now that the run it was waiting on has landed.
 *
 *   POST /api/internal/advance-runs
 *   POST /api/internal/advance-runs  { "runId": "..." }
 *     → { reported, failed, waiting }
 *
 * ## The gap this closes
 *
 * The analyse worker finishes an assessment, writes `assessment_run.state`,
 * and tells nobody. It cannot do more than that by design — `advanceChecking`
 * explains why at length: the worker only ever SELECTs `architecture_request`,
 * and making it a writer of the governance tables would hand the engine the
 * ability to move a submission through the workflow it is supposed to be
 * assessed by.
 *
 * So until now the app learned a run had finished only when somebody opened a
 * page, because the screens sweep for themselves before they render. That is
 * fine for a stepper that catches up when you look at it, and useless for a
 * notification: "your report is ready" cannot be sent at the moment nobody is
 * looking, which is precisely the moment it is worth sending.
 *
 * This endpoint is the missing edge. The worker says *which run landed* and
 * nothing more; the app reads the run row it already trusts and decides what
 * that means for the request. The division of responsibility is unchanged —
 * only the latency is.
 *
 * It is the same arrangement /api/internal/advance-requests has with the embed
 * worker, and the same one for the same reason: see Workers/aidp/notify.py.
 *
 * ## Idempotent, and safe to call as often as you like
 *
 * It acts only on requests in "checking", and the first thing it does to one is
 * move it out of that state, with the state named in the filter so a second
 * caller writes nothing. A run that belongs to no request — a hand-started
 * project assessment, which is most of them — matches nothing and answers zero.
 *
 * Without a body it sweeps everything in "checking", which is what a timer
 * would do.
 *
 * ## Who may call it
 *
 * The analyse worker or a timer, proving itself with one of the two secrets in
 * src/lib/access/internal-auth.ts.
 */

export const runtime = "nodejs";
/** Reads and writes rows on every call; a cached response would be a lie. */
export const dynamic = "force-dynamic";

/** The run named in the body, when there is a body naming one.
 *
 *  A missing, empty or unparseable body is the timer calling, not a fault.
 *  Anything that is not a string is ignored rather than passed into a query. */
async function scope(request: Request): Promise<string | undefined> {
  if (request.method !== "POST") return undefined;
  try {
    const body = await request.json();
    const id = (body as { runId?: unknown })?.runId;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

async function handle(request: Request) {
  if (!authorisedInternally(request)) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  // Never throws — see advanceChecking. One request that cannot be advanced
  // must not stop the sweep, and a worker has nowhere to report an exception.
  const result = await advanceChecking({ runId: await scope(request) });

  // The transitions above enqueue "report ready" and "a report needs your
  // decision". Draining after the response keeps the worker's five-second
  // timeout clear of a mail provider — see Workers/aidp/notify.py, which
  // treats a slow reply as a failure and moves on.
  after(async () => {
    try {
      await drain();
    } catch {
      // Still in the outbox. The next pass takes it.
    }
  });

  return NextResponse.json(result);
}

export const POST = handle;
/** Vercel Cron issues a GET. The work is the same. */
export const GET = handle;
