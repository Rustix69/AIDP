import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, ScrollText } from "lucide-react";
import { auth } from "@/lib/auth";
import { getDocument, isTerminal, STATUS_LABEL } from "@/lib/ingest/documents";
import { formatDuration } from "@/lib/ingest/pipeline";
import { readCoverage } from "@/lib/ingest/coverage";
import { readRootCauses } from "@/lib/ingest/root-causes";
import { readAdvice } from "@/lib/ingest/advice";
import { readLifecycle } from "@/lib/ingest/lifecycle";
import { latestRun, listFindings, verdictCounts } from "@/lib/ingest/assessment";
import { historiesForRun } from "@/lib/ingest/finding-edits";
import { effectiveFinding } from "@/lib/ingest/verdicts";
import {
  emptyCounts,
  readEvidence,
  readObligation,
  withoutExtractIds,
  type VerdictCounts,
} from "@/lib/ingest/verdicts";
import {
  orderEvidence,
  tablesForEvidence,
  tablesForStatements,
  tablesForGaps,
  withTables,
} from "@/lib/ingest/evidence-tables";
import { readAppliedDecisions } from "@/lib/ingest/decision-effects";
import { countActive, promotedFrom } from "@/lib/ingest/decisions";
import {
  draftView,
  draftsForRun,
  libraryForDocument,
  requirementsForClauses,
} from "@/lib/ingest/standards";
import { setAside } from "@/lib/ingest/rules";
import { historyForRun } from "@/lib/ingest/outcomes";
import { NotAMember, requireMembership } from "@/lib/ingest/org";
import { canDecideSubmissions, canManageStandards } from "@/lib/access/roles";
import { currentUser } from "@/lib/access/gate";
import { Assessment, type FindingView, type RunView } from "./Assessment";
import { Comparison } from "./Comparison";
import { compareModes } from "@/lib/ingest/comparison";
import { ClauseYield } from "./ClauseYield";
import { Understanding } from "./Understanding";
import { ParsedContent } from "./ParsedContent";
import { ClauseLibrary } from "./ClauseLibrary";
import { Decide, type OutcomeView } from "./Decide";
import { DocumentActions } from "../DocumentActions";
import { PipelineStatus } from "../PipelineStatus";
import { PipelineWatcher } from "../PipelineWatcher";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { id } = await params;

  let document;
  try {
    document = await getDocument(session.user.id, id);
  } catch (error) {
    // A document in someone else's organisation is indistinguishable from one
    // that does not exist. Saying "forbidden" would confirm it is real.
    if (error instanceof NotAMember) notFound();
    throw error;
  }
  if (!document) notFound();

  // Reference standards are the administrator's to curate, so the controls that
  // change one are only offered to them. `guardStandards` in ../actions.ts
  // refuses regardless — this keeps the page from showing a button that would
  // be turned down, which reads as a rule rather than as a fault. The role is
  // read against the *document's* organisation, since a consultant can
  // administer one customer and merely belong to another.
  const membership = await requireMembership(session.user.id, document.organisationId);
  const mayChange =
    document.role === "assessed" || canManageStandards(membership.role);

  // What the parse made of the document — its sections, tables, figures and the
  // notes the pipeline raised. For a standard that is the substance of this
  // page, so it is rendered below; for a design it is the evidence behind the
  // report and stays on ./parsed, with the count of things needing a look
  // carried here, because a reader with no reason to open that page still has
  // to know there is one.
  const toReview = document.issues.filter((i) => i.severity === "high").length;

  /**
   * A reference standard that extracted no rules, or implausibly few for its
   * size, as the parse recorded it (Workers/aidp/stages/parse.py).
   *
   * Surfaced here rather than only on the parsed-content page, because the
   * repair is on this screen: a reviewer who never opens that page was being
   * told the clause count on every report and never told it was wrong.
   */
  const clauseYield = document.issues.find(
    (issue) => issue.kind === "no_clauses" || issue.kind === "few_clauses",
  );

  // Only a submitted design gets assessed; a reference standard is what it is
  // assessed against.
  const assessed = document.role === "assessed";
  // Where "back", and a delete, take you: designs are reached from the home
  // screen's projects, standards from the library.
  const home = assessed ? "/dashboard" : "/dashboard/documents";
  // Everything the model decided was not a rule. A standard only; a design has
  // no rules to set aside.
  const setAsideView = assessed ? null : await setAside(session.user.id, document.id);
  // Only for a standard: a design has no clauses, and the query would return an
  // empty list at the cost of two round trips on every report page.
  const library = assessed ? [] : await libraryForDocument(session.user.id, document.id);
  const run = assessed ? await latestRun(session.user.id, document.id) : null;
  // A clause the design says nothing about is no longer reported. The report's
  // "Absent" section is the reverse question — the parts of the design no clause
  // governs (run.coverage) — so these stay on record and out of the report.
  const findings = run
    ? (await listFindings(session.user.id, run.id)).filter((f) => f.verdict !== "absent")
    : [];
  const counts: VerdictCounts = run ? await verdictCounts(run.id) : emptyCounts();
  // Every correction made to this run's findings, in one query, carried onto
  // the rows. The dialog shows a finding's history the moment it opens rather
  // than fetching it then — see `historiesForRun`.
  const histories = run ? await historiesForRun(run.id) : {};

  // A coverage gap quotes the design to prove the gap is real. Where the design
  // put that proof in a table, the quote is assembled from the section's lines
  // and arrives as one run-on paragraph. Recognised rather than followed: a gap
  // carries its heading path, not the table's id — see `quoteIsTable`.
  const coverageTables = await tablesForGaps(
    [document.id],
    readCoverage(run?.coverage ?? null)?.gaps ?? [],
  );

  const runView: RunView = run
    ? {
        id: run.id,
        state: run.state,
        totalClauses: run.totalClauses,
        completedClauses: run.completedClauses,
        frameworkName: run.framework.name,
        designCount: 1,
        frameworkVersion: run.framework.version,
        model: run.model,
        failureReason: run.failureReason,
        mode: run.mode,
        note: run.note,
        orphaned: run.orphaned,
        job: run.job,
        rootCauses: readRootCauses(run.rootCauses),
        coverage: readCoverage(run.coverage),
        coverageTables,
        advice: readAdvice(run.advice),
        lifecycle: readLifecycle(run.lifecycle),
      }
    : null;

  // Search and whole-document verdicts side by side. A design is assessed one
  // way now — searched, with anything that looks absent re-read against the whole
  // document — so this is a diagnostic for whoever tunes the system, kept for the
  // runs that were made both ways, and shown to the operator alone.
  const operator = await currentUser();
  const comparison =
    assessed && operator?.isPlatformAdmin
      ? await compareModes(session.user.id, document.id)
      : null;

  // Which of these reviews were already kept as decisions, so the report can
  // say so rather than inviting the same ruling to be recorded twice.
  // What *this* report would be judged with: the organisation's rulings plus
  // the ones granted to this design's project, and none granted to another's.
  const decisionsInForce = await countActive(document.organisationId, document.projectId);

  // A decision can only be taken on a finished run, so the history is only
  // fetched for one.
  const outcomes: OutcomeView[] =
    run && run.state === "complete"
      ? (await historyForRun(run.id)).map((o) => ({
          id: o.id,
          decision: o.decision,
          note: o.note,
          decidedByName: o.decidedByName,
          createdAt: o.createdAt.toISOString(),
          snapshot: o.snapshot,
        }))
      : [];
  const unreviewed = findings.filter((f) => f.reviewerState === "pending").length;
  // Counted on what each finding says now — a breach a reviewer has overturned
  // is not an open one, and the header saying otherwise would contradict the
  // register directly beneath it.
  const openFindings = findings.filter(
    (f) => effectiveFinding(f).verdict === "contradicts",
  ).length;
  const promoted = await promotedFrom(
    document.organisationId,
    findings.map((f) => f.id),
  );
  // Proposals to sharpen a clause, by the finding each came from. Empty until
  // somebody asks for one, so this costs a keyed lookup on most reports.
  const drafts = run ? await draftsForRun(run.id) : new Map();

  // A fifth of the evidence text in these reports is table cells printed as a
  // run-on line. The link back to the table is exact — a table chunk carries its
  // TableBlock id — so this reads it once for the whole page and the findings
  // show the table instead. Nothing is re-run: reports written months ago get
  // their tables back on the next load.
  const evidenceTables = await tablesForEvidence(
    findings.flatMap((f) => readEvidence(f.evidence).map((e) => e.chunkId)),
  );

  // The requirements behind each judged clause, which the finding itself does
  // not carry. One keyed query for the page. See requirementsForClauses.
  const clauseRequirements = await requirementsForClauses(findings.map((f) => f.clauseId));

  // And the grid a clause was written as, where it was written as one.
  const clauseTables = await tablesForStatements(
    findings.map((f) => ({ id: f.clauseId, statement: f.clauseStatement, ref: f.clauseRef })),
  );

  const findingViews: FindingView[] = findings.map((f) => {
    // Cleaned once: the reader sees this text, and so does the evidence
    // ordering that works out which designs it names.
    const rationale = withoutExtractIds(f.rationale);
    return {
      id: f.id,
      documentTitle: null,
      clauseRef: f.clauseRef,
      clauseTitle: f.clauseTitle,
      clauseStatement: f.clauseStatement,
      clauseRequirements: clauseRequirements.get(f.clauseId) ?? [],
      clauseTable: clauseTables.get(f.clauseId) ?? null,
      verdict: f.verdict,
      confidence: f.confidence,
      rationale,
      obligation: readObligation(f.obligation),
      obligationSource: f.obligationSource,
      // How the readings of this clause voted. See `agreementOf`.
      readings: f.readings,
      agreed: f.agreed,
      dissent: f.dissent,
      evidence: orderEvidence(
        withTables(readEvidence(f.evidence), evidenceTables),
        rationale,
      ),
      reviewerState: f.reviewerState,
      reviewerVerdict: f.reviewerVerdict,
      reviewerNote: f.reviewerNote,
      reviewerObligation: f.reviewerObligation,
      reviewerSeverity: f.reviewerSeverity,
      reviewerRationale: f.reviewerRationale,
      editedByName: f.editedByName,
      history: histories[f.id] ?? [],
      appliedDecisions: readAppliedDecisions(f.appliedDecisions),
      promotedDecisionId: promoted.get(f.id)?.id ?? null,
      promotedScope: promoted.get(f.id)?.scope ?? null,
      draft: draftView(drafts.get(f.id)),
    };
  });

  return (
    <>
      {/* A live assessment is not in here any more: its banner polls the run
          itself (see useLiveProgress) and refreshes the page once, when there is
          a report to show. Re-rendering the whole page every four seconds to
          move one number was what held the clause count still — the render took
          longer than the interval, so the refreshes were coalesced. */}
      <PipelineWatcher
        active={
          !isTerminal(document.status) ||
          // A ready document can be working again: a corrected figure re-embeds.
          (document.pipeline.state !== "ready" && document.pipeline.state !== "failed") ||
          // A new set of suggestions asked for on a finished report.
          runView?.advice?.refreshing === true
        }
      />

      {/* Back to where this kind of document lives: a design is reached from
          the projects on the home screen, a standard from the library. Sending
          a design back to the library dropped people in a list it is not in. */}
      <Link
        href={home}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink/66 transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} />
        {assessed ? "Home" : "Standards library"}
      </Link>

      <PageHeader
        title={document.title}
        meta={
          <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <span className="text-ink/72">{STATUS_LABEL[document.status] ?? document.status}</span>
            {document.pipeline.state === "ready" && document.pipeline.tookMs !== null && (
              <span>Processed in {formatDuration(document.pipeline.tookMs)}</span>
            )}
            {document.docCode && <span>{document.docCode}</span>}
            {document.version && <span>{document.version}</span>}
            {document.pageCount != null && <span>{document.pageCount} pages</span>}
            {document.profile && <span>{document.profile}</span>}
            {document.sensitivity && (
              <span className="rounded border border-line px-1.5 py-0.5 text-ink/70">
                {document.sensitivity}
              </span>
            )}
          </span>
        }
        action={
          <>
            {/* Only for a design, whose page is its report: the parse is the
                evidence behind a finding, looked at beside it, so it opens in a
                new tab and coming back does not mean loading the report again.
                A standard carries its parse on this page — there is no report
                for it to crowd, and it is what the reader came for. */}
            {assessed && (
              <Link
                href={`/dashboard/documents/${document.id}/parsed`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-ink/78 transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-mid"
              >
                <ScrollText size={13} aria-hidden="true" />
                Parsed content
                {toReview > 0 && (
                  <span className="rounded-full border border-warn-line bg-warn-tint px-1.5 text-[11px] text-warn">
                    {toReview}
                  </span>
                )}
                <ExternalLink size={11} aria-hidden="true" className="text-ink/50" />
              </Link>
            )}

            {mayChange && (
              <DocumentActions
                documentId={document.id}
                title={document.title}
                redirectAfterDelete
                redirectTo={home}
              />
            )}
          </>
        }
      />

      {/* Until the document is in, where it has got to is the whole story. */}
      {document.pipeline.state !== "ready" && (
        <PipelineStatus view={document.pipeline} canRerun={mayChange} />
      )}

      {document.failureReason && document.pipeline.state !== "failed" && (
        <p className="mb-6 rounded-xl border border-warn-line bg-warn-tint px-4 py-3 text-[13px] text-warn">
          {document.failureReason}
        </p>
      )}

      {/* A standard that measures less than it should, and the one click that
          re-reads it. Above Understanding because it changes what every report
          using this standard is worth. */}
      {clauseYield && (
        <ClauseYield
          documentId={document.id}
          kind={clauseYield.kind as "no_clauses" | "few_clauses"}
          detail={clauseYield.detail}
          canRerun={mayChange}
        />
      )}

      {/* Before everything, because it is the premise the rest rests on: a
          reader who has not seen what the system took this document to be
          cannot tell whether its findings are answering the right question. */}
      <Understanding
        documentId={document.id}
        summary={document.summary}
        editable={mayChange}
        assessed={assessed}
      />

      {/* The rules first, then the parse behind them. A reader opening a
          standard wants to know what it requires and which of it applies to
          them; how the pipeline cut the document is the evidence for that
          list, and it belongs after it rather than in front of it. */}
      {!assessed && <ClauseLibrary clauses={library} canEdit={mayChange} />}

      {/* A standard is its clauses, so they are on its page rather than behind
          a link to a second one. */}
      {!assessed && (
        <ParsedContent
          document={document}
          setAsideView={setAsideView}
          mayChange={mayChange}
        />
      )}

      {assessed && (
        <Assessment
          scope={{ kind: "document", documentId: document.id }}
          project={document.project}
          run={runView}
          counts={counts}
          findings={findingViews}
          decisionsInForce={decisionsInForce}
        />
      )}

      {comparison && <Comparison view={comparison} />}

      {/* The decision comes after the findings: it is the conclusion drawn from
          them, and offering it above the evidence invites a decision taken
          without reading any. */}
      {assessed && run && run.state === "complete" && (
        <Decide
          runId={run.id}
          history={outcomes}
          unreviewed={unreviewed}
          open={openFindings}
          mayDecide={canDecideSubmissions(membership.role)}
        />
      )}
    </>
  );
}
