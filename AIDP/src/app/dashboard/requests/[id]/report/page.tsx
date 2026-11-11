import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleCheck,
  Download,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/access/gate";
import { getRequestDraft } from "@/lib/ingest/requests";
import { resultsFor } from "@/lib/significance/record";
import { listFindings } from "@/lib/ingest/assessment";
import { CATEGORY_LABEL, readAdvice } from "@/lib/ingest/advice";
import { readLifecycle } from "@/lib/ingest/lifecycle";
import { buildRisk } from "@/lib/ingest/risk";
import { nextStep } from "@/lib/ingest/next-step";
import {
  BRIEF_SEVERITY_LABEL,
  effectiveFinding,
  type BriefSeverity,
} from "@/lib/ingest/verdicts";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Panel } from "@/components/ui/Panel";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { FindingCard } from "@/components/ui/FindingCard";
import { StackBar } from "@/components/ui/charts";
import { Stepper, requestStep } from "@/components/ui/Stepper";
import { Cell, DataTable, Row } from "@/components/ui/DataTable";
import { RiskPanel } from "./RiskPanel";

export const dynamic = "force-dynamic";

/**
 * One report: how big this change is, what it breaks, and what happens next.
 *
 * The brief's Step 4 — "assembles the significance classification, compliance
 * scorecard, severity-ranked issues, risk matrix, and recommendations into one
 * report". Until this existed the first two lived on different screens and a
 * reviewer did the joining in their head.
 *
 * Nothing here is new analysis. Every number was worked out during the run or
 * by the criteria check and is read back; the only thing this page computes is
 * the sentence saying which of the brief's routes the submission takes, and it
 * states that rule rather than acting on it. Recording an outcome is still a
 * person pressing a button.
 */
/** The four tiers, as pills. The severity words are the product's own, so the
 *  pill tone is named after the tier rather than mapped through a second
 *  vocabulary. */
const TONE: Record<BriefSeverity, PillTone> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

/** The same four, as the fills of the severity bar. A tint would vanish at
 *  22px tall, so these are the solid rungs. */
const BAND: Record<BriefSeverity, string> = {
  critical: "bg-danger",
  high: "bg-warn",
  medium: "bg-warn/55",
  low: "bg-line-strong",
};

const ROUTE_TONE = {
  auto_approve: "border-ok-line bg-ok-tint",
  architect: "border-warn-line bg-warn-tint",
  board: "border-danger-line bg-danger-tint",
} as const;

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user, organisation } = await requireWorkspace();

  const request = await getRequestDraft(organisation.id, id);
  if (!request) notFound();

  // No run yet means no report. Said plainly rather than drawn as an empty one.
  if (!request.runId) {
    return (
      <>
        <Back id={id} />
        <PageHeader eyebrow={request.reference} title="Review report" />
        <Stepper current={requestStep(request.state)} />
        <p className="rounded-xl border border-line bg-card px-4 py-4 text-[13px] text-ink/75">
          {request.state === "draft"
            ? "This request has not been submitted yet."
            : "The review has not started yet. The report appears as soon as the submission has been read."}
        </p>
      </>
    );
  }

  // `listFindings` takes the *user*, not the organisation: it checks membership
  // itself before it reads a finding. Nothing is caught around it — a failure
  // here means the caller is not entitled to these findings, and the page
  // should fail rather than quietly draw a report with none, which reads as a
  // clean submission.
  const [run, findings, criteria] = await Promise.all([
    prisma.assessmentRun.findFirst({
      where: { id: request.runId, organisationId: organisation.id },
    }),
    listFindings(user.id, request.runId),
    request.significance ? resultsFor(request.id) : Promise.resolve([]),
  ]);
  if (!run) notFound();

  // Graded once, here, and read from this everywhere below — so the scorecard,
  // the risk view and the route cannot disagree about what a finding is worth.
  // Graded on what each finding says *now* — the engine's verdict where nobody
  // has touched it, the reviewer's where they have. A report that kept quoting
  // an overturned breach would be telling its own reviewer their judgement did
  // not reach the page they are about to take to a board.
  const graded = findings.map((finding) => {
    const effective = effectiveFinding(finding);
    return { finding, effective, grade: effective.brief };
  });

  const counts: Record<BriefSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let unsettled = 0;
  for (const { grade } of graded) {
    if (!grade) continue;
    counts[grade.tier] += 1;
    if (!grade.settled) unsettled += 1;
  }
  const settledCovered = findings.length - graded.filter(({ grade }) => grade).length;
  const unreviewed = findings.filter((f) => f.reviewerState === "pending").length;

  const advice = readAdvice(run.advice);

  // The handful an experienced reviewer would raise first. The full set lives
  // on the findings screen, where each one sits beside the passage it quotes;
  // what the report needs is the shape of them, so somebody reading it in a
  // board pack knows what they are being asked to weigh.
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
  const recommendations = [...(advice?.suggestions ?? [])]
    .sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3),
    )
    .slice(0, 5);

  const risk = buildRisk(
    findings.map((f) => ({
      clauseRef: f.clauseRef,
      verdict: f.verdict,
      obligation: f.obligation,
      reviewerVerdict: f.reviewerVerdict,
      reviewerObligation: f.reviewerObligation,
      reviewerSeverity: f.reviewerSeverity,
    })),
    advice,
    readLifecycle(run.lifecycle),
  );

  const step = nextStep({
    significance: request.significance,
    counts,
    unsettled,
    unreviewed,
  });

  const triggered = criteria.filter((result) => result.triggered);
  const worst = graded
    .filter(({ grade }) => grade?.tier === "critical" || grade?.tier === "high")
    .slice(0, 1)[0];

  const RouteIcon =
    step.route === "auto_approve" ? CircleCheck : step.route === "board" ? ArrowUpRight : UserCheck;

  return (
    <>
      <Back id={id} />
      <PageHeader
        eyebrow={`${request.reference} · Review report`}
        title={request.title || "Untitled request"}
        lede="The significance check and the standards review, together, and what the brief says happens next."
        meta={`Generated from the assessment run · ${findings.length} finding${
          findings.length === 1 ? "" : "s"
        } raised`}
      />

      <Stepper current={requestStep(request.state)} />

      {/* The report's three headline answers, in the order a reviewer asks
          them: how big is this, what did it break, and how bad is the worst of
          it. The prototype puts the same three across the top of its report,
          and the reason holds — every panel below is one of these three
          expanded, so somebody who only reads the band has still read the
          report. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={
            request.significance === "significant" ? (
              <ShieldAlert size={15} strokeWidth={1.9} />
            ) : (
              <ShieldCheck size={15} strokeWidth={1.9} />
            )
          }
          label="Significance"
          value={
            <span
              className={cn(
                "text-[17px]",
                request.significance === "significant"
                  ? "text-warn"
                  : request.significance
                    ? "text-ok"
                    : "text-ink/55",
              )}
            >
              {request.significance === "significant"
                ? "Significant"
                : request.significance
                  ? "Not significant"
                  : "Not determined"}
            </span>
          }
          hint={
            request.significance
              ? `${triggered.length} of ${criteria.length} categories triggered`
              : "Not filed as an architecture request"
          }
        />
        <StatCard
          label="Findings raised"
          value={String(findings.length)}
          hint={
            settledCovered > 0
              ? `${settledCovered} clause${settledCovered === 1 ? "" : "s"} covered`
              : findings.length === 0
                ? "Nothing raised against your standards"
                : "Against your standards"
          }
        />
        <StatCard
          label="Highest severity"
          value={
            <span
              className={cn(
                "text-[17px]",
                counts.critical > 0
                  ? "text-danger"
                  : counts.high > 0 || counts.medium > 0
                    ? "text-warn"
                    : counts.low > 0
                      ? "text-ink/70"
                      : "text-ok",
              )}
            >
              {counts.critical > 0
                ? "Critical"
                : counts.high > 0
                  ? "High"
                  : counts.medium > 0
                    ? "Medium"
                    : counts.low > 0
                      ? "Low"
                      : "None"}
            </span>
          }
          hint={
            unsettled > 0
              ? `${unsettled} could not be graded from the document`
              : worst?.grade
                ? `${worst.finding.clauseRef} — ${worst.finding.clauseTitle}`
                : "Nothing outstanding"
          }
        />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Compliance scorecard"
          blurb="Every breach this run raised, by the severity it was graded at."
        >
          <StackBar
            className="mt-1"
            emptyNote="No breaches were raised against the standards in this run."
            bands={(["critical", "high", "medium", "low"] as const).map((tier) => ({
              label: BRIEF_SEVERITY_LABEL[tier],
              value: counts[tier],
              className: BAND[tier],
            }))}
          />
          {settledCovered > 0 && (
            <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink/62">
              A further {settledCovered} clause{settledCovered === 1 ? " was" : "s were"}{" "}
              covered by the design and raised nothing.
            </p>
          )}
        </Panel>

        <Panel
          title="Significance criteria"
          blurb={
            request.significance
              ? "The categories the intake answers triggered. Any one of them makes a request significant."
              : "This was not filed as an architecture request, so there are no intake answers to check."
          }
          flush={triggered.length > 0}
        >
          {triggered.length > 0 ? (
            <DataTable head={["Category", "Why"]} minWidth={420}>
              {triggered.map((result) => {
                // The working, as the check recorded it. "Cost Impact
                // triggered because 7,500,000 is at least 5,000,000" is a
                // line a review board can act on; "Cost Impact: triggered"
                // is one they have to come back and ask about.
                const why = (result.triggeredBy as { text?: string; actual?: string }[]) ?? [];
                return (
                  <Row key={result.id}>
                    <Cell className="whitespace-nowrap font-medium text-ink">
                      {result.categoryLabel}
                    </Cell>
                    <Cell className="text-[12.5px] text-ink/65">
                      {why.length > 0
                        ? why
                            .map((entry) =>
                              entry.actual
                                ? `${entry.text} The request says ${entry.actual}.`
                                : entry.text,
                            )
                            .join(" ")
                        : "Triggered."}
                    </Cell>
                  </Row>
                );
              })}
            </DataTable>
          ) : (
            <p className="text-[13px] text-ink/62">
              {request.significance
                ? `None of the ${criteria.length} categories checked were triggered. It can proceed on its findings alone.`
                : "Nothing to check."}
            </p>
          )}
        </Panel>
      </div>

      {/* What the brief says happens now. Stated, not done — recording an
          outcome is still somebody's decision. */}
      <section className={`mb-5 rounded-xl border px-4 py-3.5 ${ROUTE_TONE[step.route]}`}>
        <div className="flex gap-2.5">
          <RouteIcon size={16} className="mt-0.5 shrink-0 text-ink/70" aria-hidden="true" />
          <div>
            <p className="text-[13.5px] font-semibold text-ink">{step.headline}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/75">{step.because}</p>
          </div>
        </div>
      </section>

      <div className="mb-5">
        <RiskPanel risk={risk} />
      </div>

      {recommendations.length > 0 && (
        <section className="mb-5">
          <div className="mb-3">
            <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
              Recommendations
            </h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink/62">
              What a reviewer would still ask of the design, beyond the standards. Advice,
              never a verdict
              {(advice?.suggestions.length ?? 0) > recommendations.length &&
                ` — ${recommendations.length} of ${advice?.suggestions.length} shown`}
              .
            </p>
          </div>

          {/* Ruled cards rather than list rows: in a board pack each of these
              is read on its own and argued with on its own, and a divided list
              makes five separate asks look like one paragraph. */}
          <div className="grid gap-2.5">
            {recommendations.map((suggestion, index) => (
              <FindingCard
                key={index}
                tone={suggestion.priority === "high" ? "high" : "neutral"}
                severity={CATEGORY_LABEL[suggestion.category]}
                reference={suggestion.component || undefined}
                title={suggestion.title}
              />
            ))}
          </div>
        </section>
      )}

      {/* The severity vocabulary, spelled out once, so a pill in a board pack
          does not need the reader to have been on the findings screen. */}
      {findings.length > 0 && (
        <ul className="mb-5 flex flex-wrap gap-1.5">
          {(["critical", "high", "medium", "low"] as const).map((tier) =>
            counts[tier] > 0 ? (
              <li key={tier}>
                <Pill tone={TONE[tier]}>
                  {counts[tier]} {BRIEF_SEVERITY_LABEL[tier]}
                </Pill>
              </li>
            ) : null,
          )}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <Link
          href={`/dashboard/projects/${request.projectId}/assessment`}
          className="inline-flex items-center gap-1.5 rounded-full bg-royal px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-royal-mid"
        >
          Work the findings
        </Link>
        <a
          href={`/dashboard/requests/${request.id}/report/export`}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-4 py-2 text-[13px] text-ink/80 transition-colors hover:border-line-strong hover:text-ink"
        >
          <Download size={14} aria-hidden="true" />
          Download the report
        </a>
        {request.documentId && (
          <Link
            href={`/dashboard/documents/${request.documentId}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-4 py-2 text-[13px] text-ink/80 transition-colors hover:border-line-strong hover:text-ink"
          >
            What was submitted
          </Link>
        )}
      </div>
    </>
  );
}

function Back({ id }: { id: string }) {
  return (
    <Link
      href={`/dashboard/requests/${id}`}
      className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink/60 hover:text-ink"
    >
      <ArrowLeft size={14} aria-hidden="true" />
      Back to the request
    </Link>
  );
}
