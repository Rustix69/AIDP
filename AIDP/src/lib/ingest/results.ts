/**
 * A finished assessment, shaped for reading rather than reviewing.
 *
 * The project page shows each design's latest finished result beneath it: the
 * report's content without its controls. Same counts, same worst-first order,
 * the same "Absent" — the parts of the design no standard covers, not clauses
 * the design is silent on — and nothing that changes a finding. Reviewing stays
 * on the document's own page.
 *
 * Pure, so the shaping can be checked without a database; projects.ts supplies
 * the rows.
 */
import { readCoverage, type CoverageView } from "./coverage";
import { effectiveFinding, readEvidence, type EvidenceItem } from "./verdicts";

/** The clause verdicts a result lists, worst first. "absent" is not one of them. */
export const LISTED = ["contradicts", "partial", "needs_review", "covered"] as const;
export type Listed = (typeof LISTED)[number];

export type ResultFinding = {
  id: string;
  clauseRef: string;
  clauseTitle: string;
  clauseStatement: string;
  verdict: Listed;
  confidence: number;
  rationale: string;
  evidence: EvidenceItem[];
  reviewerState: string;
  reviewerVerdict: string | null;
};

export type DesignResult = {
  runId: string;
  frameworkName: string;
  frameworkVersion: number;
  /** "document" when the whole design was read, "retrieval" when searched. */
  mode: string;
  model: string | null;
  note: string | null;
  completedAt: Date | null;
  counts: Record<Listed, number>;
  findings: ResultFinding[];
  coverage: CoverageView | null;
  /** A newer assessment is queued or running; this is the last one that finished. */
  superseding: boolean;
};

/** A completed run as projects.ts selects it. */
export type CompletedRun = {
  id: string;
  mode: string;
  model: string | null;
  note: string | null;
  completedAt: Date | null;
  coverage: unknown;
  framework: { name: string; version: number };
  findings: {
    id: string;
    clauseRef: string;
    clauseTitle: string;
    clauseStatement: string;
    verdict: string;
    obligation: string;
    confidence: number;
    rationale: string;
    evidence: unknown;
    reviewerState: string;
    reviewerVerdict: string | null;
    reviewerObligation: string | null;
    reviewerSeverity: string | null;
    reviewerRationale: string | null;
  }[];
};

function isListed(verdict: string): verdict is Listed {
  return (LISTED as readonly string[]).includes(verdict);
}

export function designResult(run: CompletedRun, superseding = false): DesignResult {
  const findings = run.findings
    .flatMap((finding): ResultFinding[] => {
      // What the finding says now, not what the engine first said. This panel
      // is the read-only twin of the report on the design's own page, and the
      // two showing different verdicts for one clause would be worse than
      // either — a reviewer who corrected something on one screen would find it
      // uncorrected on the other and not know which to believe.
      const effective = effectiveFinding(finding);
      const verdict = effective.verdict as string;
      // A clause the design is silent on is not reported; see coverage.ts.
      if (!isListed(verdict)) return [];
      return [
        {
          ...finding,
          verdict,
          rationale: effective.rationale,
          evidence: readEvidence(finding.evidence),
        },
      ];
    })
    .sort(
      (a, b) =>
        LISTED.indexOf(a.verdict) - LISTED.indexOf(b.verdict) || b.confidence - a.confidence,
    );

  const counts = Object.fromEntries(LISTED.map((verdict) => [verdict, 0])) as Record<
    Listed,
    number
  >;
  for (const finding of findings) counts[finding.verdict] += 1;

  return {
    runId: run.id,
    frameworkName: run.framework.name,
    frameworkVersion: run.framework.version,
    mode: run.mode,
    model: run.model,
    note: run.note,
    completedAt: run.completedAt,
    counts,
    findings,
    coverage: readCoverage(run.coverage),
    superseding,
  };
}
