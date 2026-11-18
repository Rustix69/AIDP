import { prisma } from "@/lib/prisma";
import { type BriefSeverity, effectiveFinding } from "@/lib/ingest/verdicts";
import { type NextStep, nextStep } from "@/lib/ingest/next-step";

/**
 * What the brief's Step 5 says should happen to a request, answered from the
 * database rather than from a screen.
 *
 * `next-step.ts` states the rule and is deliberately pure — it can be checked
 * without a database and imported from a client component. This is the other
 * half: gathering the numbers the rule needs.
 *
 * ## Why this exists beside the report page's own copy
 *
 * The report page and its export both assemble these counts for themselves,
 * from `listFindings`, which scopes what it returns to the person asking. That
 * is right for a screen and wrong here: a notification is raised by a sweep
 * with no session — `advanceChecking` takes no `Access` and runs from a worker
 * ping — so there is nobody to scope to. Reading the findings directly is what
 * lets the question be asked at all.
 *
 * The resolution itself is shared, and must stay so: `effectiveFinding` is what
 * puts a reviewer's correction ahead of the engine's own answer, and a
 * notification that ignored corrections would tell an architect a severity the
 * report in front of them disagrees with.
 */

export type Routing = NextStep & {
  counts: Record<BriefSeverity, number>;
  /** Graded, but the engine could not settle the grade. A person has to look. */
  unsettled: number;
  /** Nobody has worked through these yet. Said, never blocking. */
  unreviewed: number;
  /** Everything that carries a grade worth acting on. */
  total: number;
};

/**
 * The route for one request, or null when there is nothing to route — no run,
 * or a run that has not landed.
 *
 * Never throws: every caller is a notification, and none of them is worth
 * failing a sweep over.
 */
export async function routingFor(requestId: string): Promise<Routing | null> {
  try {
    const request = await prisma.architectureRequest.findUnique({
      where: { id: requestId },
      select: { significance: true, runId: true },
    });
    if (!request?.runId) return null;

    const findings = await prisma.finding.findMany({
      where: { runId: request.runId },
      select: {
        verdict: true,
        obligation: true,
        rationale: true,
        reviewerState: true,
        reviewerVerdict: true,
        reviewerObligation: true,
        reviewerSeverity: true,
        reviewerRationale: true,
      },
    });

    const counts: Record<BriefSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    let unsettled = 0;
    let total = 0;

    for (const finding of findings) {
      const grade = effectiveFinding(finding).brief;
      if (!grade) continue;
      counts[grade.tier] += 1;
      total += 1;
      if (!grade.settled) unsettled += 1;
    }

    const unreviewed = findings.filter((finding) => finding.reviewerState === "pending").length;
    const step = nextStep({
      significance: request.significance,
      counts,
      unsettled,
      unreviewed,
    });

    return { ...step, counts, unsettled, unreviewed, total };
  } catch {
    // A dropped connection on the way to a courtesy message. The report itself
    // is written and the screen will say the same thing when it is opened.
    return null;
  }
}

/** "2 Critical, 5 High" — the triage line a reviewer reads first. */
export function describeCounts(counts: Record<BriefSeverity, number>): string {
  const said = (["critical", "high", "medium", "low"] as const)
    .filter((tier) => counts[tier] > 0)
    .map((tier) => `${counts[tier]} ${tier[0]!.toUpperCase()}${tier.slice(1)}`);
  return said.length > 0 ? said.join(", ") : "no findings that need acting on";
}
