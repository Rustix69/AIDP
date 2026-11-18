import { after } from "next/server";
import { prisma } from "../prisma";
import { canDecideSubmissions } from "../access/roles";
import { describeCounts, routingFor } from "../ingest/routing";
import { drain } from "./drain";
import { enqueue, type Recipient } from "./enqueue";
import { reportUrl, requestUrl } from "./links";

/**
 * The news the platform announces, one function per event.
 *
 * This is the layer between "something happened" and "these people are owed a
 * message about it". The domain code calls an event by name; working out who
 * that reaches, and what they need to be told, belongs here — so a change to
 * the recipients of a notification is a change in this file and nowhere else.
 *
 * ## Nothing here may throw
 *
 * Every one of these is called from a path that was doing something more
 * important, and three of them are called from sweeps that run with no session
 * and no error channel — `advanceSubmitted` and `advanceChecking` are reached
 * from a worker ping and from page renders, and neither has anywhere to report
 * an exception to. `checkCriteria` in src/lib/ingest/requests.ts takes the same
 * stance and states the reason: losing the work because a side errand failed is
 * the worse trade by a distance.
 *
 * ## Recipients, today
 *
 * The requestor, resolved from `requestedById`, and — for a report that needs a
 * decision — everybody in the organisation who is allowed to take one. The
 * brief names an *assigned* architect, which this schema cannot yet produce:
 * `ReviewAssignment` is migrated and no code writes it. Until something does,
 * asking everyone who could decide is the honest approximation, and it is the
 * one place that changes when assignment arrives.
 */

/** What every message about a request needs to know. */
type Subject = {
  id: string;
  organisationId: string;
  reference: string;
  title: string;
  requestedById: string | null;
  requestedByName: string;
  /** The run in force. Null before the first assessment; afterwards it is what
   *  tells one cycle from the next — see `dedupeKeyFor`. */
  runId: string | null;
  requestor: Recipient;
};

async function subject(requestId: string): Promise<Subject | null> {
  const request = await prisma.architectureRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      organisationId: true,
      reference: true,
      title: true,
      requestedById: true,
      requestedByName: true,
      runId: true,
      requestedBy: { select: { email: true, name: true } },
    },
  });
  if (!request) return null;

  return {
    id: request.id,
    organisationId: request.organisationId,
    reference: request.reference,
    title: request.title,
    requestedById: request.requestedById,
    requestedByName: request.requestedByName,
    runId: request.runId,
    requestor: {
      // Null when the account has since been deleted. enqueue() records that
      // as `skipped` rather than dropping it.
      email: request.requestedBy?.email ?? null,
      userId: request.requestedById,
      name: request.requestedBy?.name || request.requestedByName,
    },
  };
}

/**
 * Everybody in this organisation who may record a decision, minus whoever
 * filed the request.
 *
 * The exclusion matters in a small customer, where the owner is often also the
 * person submitting: they have already had the report-ready message, and a
 * second mail asking them to review their own submission reads as a bug. It is
 * also what FR-12 says in miniature — a requestor cannot approve their own
 * submission, so there is no reason to ask them to.
 */
async function deciders(organisationId: string, exclude: string | null): Promise<Recipient[]> {
  const members = await prisma.membership.findMany({
    where: { organisationId },
    select: { role: true, userId: true, user: { select: { email: true, name: true } } },
  });

  return members
    .filter((member) => canDecideSubmissions(member.role))
    .filter((member) => member.userId !== exclude)
    .map((member) => ({
      email: member.user?.email ?? null,
      userId: member.userId,
      name: member.user?.name ?? "",
    }));
}

/**
 * Empty the outbox once this response is on its way.
 *
 * `after` only exists inside a request, and these events are also reached from
 * scripts and tests where it is not. Throwing there would turn a verification
 * run into a failure over a courtesy, so the absence is caught and ignored —
 * a message left behind goes out on the next pass, which is the guarantee the
 * outbox is built on anyway. See /api/internal/send-notifications.
 */
function scheduleDrain(): void {
  try {
    after(async () => {
      try {
        await drain();
      } catch {
        // Still in the outbox, still owed, still picked up next time.
      }
    });
  } catch {
    // Not in a request scope.
  }
}

/**
 * A submission has been accepted and has its document.
 *
 * Safe to call more than once for the same request, and it is: `submitRequest`
 * reaches this through two different paths, and a resubmission reaches it
 * again. The dedupe key absorbs all of that — see enqueue.ts.
 */
export async function notifySubmissionReceived(requestId: string): Promise<void> {
  try {
    const it = await subject(requestId);
    if (!it) return;

    await enqueue({
      organisationId: it.organisationId,
      requestId: it.id,
      kind: "submission_received",
      recipients: [it.requestor],
      payload: {
        reference: it.reference,
        title: it.title,
        url: requestUrl(it.id),
        recipientName: it.requestor.name ?? "",
      },
    });
    scheduleDrain();
  } catch {
    // Deliberately swallowed; see above.
  }
}

/**
 * The documents are indexed and the request is waiting for somebody to press
 * "Start assessing".
 *
 * Called from `advanceSubmitted`, which is reached from the embed worker's
 * ping and from two page renders — so this runs with no session, repeatedly,
 * and leans entirely on the dedupe key for not sending the message twice.
 */
export async function notifyReadyToAssess(requestId: string): Promise<void> {
  try {
    const it = await subject(requestId);
    if (!it) return;

    await enqueue({
      organisationId: it.organisationId,
      requestId: it.id,
      kind: "ready_to_assess",
      // A request that failed can be edited and sent again, and becomes ready
      // a second time. By then `runId` holds the run that failed, which is
      // what tells the second arrival from the first.
      dedupeSalt: it.runId ?? "first",
      recipients: [it.requestor],
      payload: {
        reference: it.reference,
        title: it.title,
        url: requestUrl(it.id),
        recipientName: it.requestor.name ?? "",
      },
    });
    scheduleDrain();
  } catch {
    // Deliberately swallowed; see above.
  }
}

/**
 * The report has landed.
 *
 * Two messages, not one: the requestor is told their report is ready, and
 * everybody who can decide is told one is waiting for them. They are separate
 * kinds because they say different things — the requestor gets no routing
 * recommendation, since what happens next is the architect's call and not the
 * platform's to announce first.
 *
 * The counts come from `routingFor`, which reads the findings directly because
 * there is no session here to scope them to. If that cannot be worked out the
 * messages are skipped rather than sent empty: a report-ready mail that could
 * not say what was found is worth less than the screen the reader would open
 * anyway, and it would be the version kept in the audit trail.
 */
export async function notifyReportReady(requestId: string): Promise<void> {
  try {
    const it = await subject(requestId);
    if (!it) return;

    const routing = await routingFor(requestId);
    if (!routing) return;

    const summary = describeCounts(routing.counts);

    await enqueue({
      organisationId: it.organisationId,
      requestId: it.id,
      kind: "report_ready",
      // One message per run. Reassessing produces a new report, and the
      // requestor is owed it.
      dedupeSalt: it.runId,
      recipients: [it.requestor],
      payload: {
        reference: it.reference,
        title: it.title,
        summary,
        unsettled: routing.unsettled,
        url: reportUrl(it.id),
        recipientName: it.requestor.name ?? "",
      },
    });

    const reviewers = await deciders(it.organisationId, it.requestedById);
    if (reviewers.length > 0) {
      await enqueue({
        organisationId: it.organisationId,
        requestId: it.id,
        kind: "review_requested",
        dedupeSalt: it.runId,
        recipients: reviewers,
        payload: {
          reference: it.reference,
          title: it.title,
          requestedByName: it.requestedByName,
          summary,
          headline: routing.headline,
          because: routing.because,
          url: reportUrl(it.id),
        },
      });
    }

    scheduleDrain();
  } catch {
    // Deliberately swallowed; see above.
  }
}

/**
 * The request stopped instead of finishing.
 *
 * Called from `stop()`, which is the single chokepoint every failure path in
 * requests.ts goes through — a missing document, a parse that failed, a run
 * that died, a run that is no longer on record. One hook therefore covers all
 * four, and the reason each one recorded is what the message carries.
 */
export async function notifyAssessmentFailed(requestId: string, reason: string): Promise<void> {
  try {
    const it = await subject(requestId);
    if (!it) return;

    await enqueue({
      organisationId: it.organisationId,
      requestId: it.id,
      kind: "assessment_failed",
      // Failures before an assessment has opened have no run to key on; those
      // are the two `advanceSubmitted` raises, and they end the same cycle.
      dedupeSalt: it.runId ?? "pre-assessment",
      recipients: [it.requestor],
      payload: {
        reference: it.reference,
        title: it.title,
        reason,
        url: requestUrl(it.id),
        recipientName: it.requestor.name ?? "",
      },
    });
    scheduleDrain();
  } catch {
    // Deliberately swallowed; see above.
  }
}
