import { AlertTriangle, CircleHelp, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import { BRIEF_SEVERITY_LABEL, type BriefSeverity } from "@/lib/ingest/verdicts";
import { Panel } from "@/components/ui/Panel";
import { Pill, type PillTone } from "@/components/ui/Pill";
import type { RiskView } from "@/lib/ingest/risk";

/**
 * Risk, along the five dimensions the brief names.
 *
 * Read-only and server-rendered: it draws what `buildRisk` worked out and
 * decides nothing of its own. The one thing it has to get right is the
 * difference between a dimension that was looked at and found quiet, and one
 * nothing in the run could speak to — so an unassessed row is drawn as a
 * question rather than as a clean bill of health, and never carries a grade.
 */

/** The severity words are the product's own, so the pill tone is named after
 *  the tier rather than mapped through a second vocabulary. */
const TONE: Record<BriefSeverity, PillTone> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

export function RiskPanel({ risk }: { risk: RiskView }) {
  const assessed = risk.rows.filter((row) => row.assessed);

  return (
    <Panel
      title="Risk matrix"
      blurb={
        assessed.length === 0
          ? "Nothing in this run spoke to any of these. That is not the same as nothing being wrong."
          : `${assessed.length} of ${risk.rows.length} dimensions could be assessed from this submission.`
      }
      flush
    >
      <ul className="divide-y divide-line">
        {risk.rows.map((row) => (
          <li key={row.dimension} className="px-5 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[13px] font-semibold",
                    row.assessed ? "text-ink" : "text-ink/55",
                  )}
                >
                  {row.label}
                </p>
                <p className="mt-0.5 text-[12px] text-ink/55">{row.blurb}</p>
              </div>

              {/* The grade, or the absence of one. An unassessed dimension shows
                  a question, not a dash that reads as "clear". */}
              {row.assessed && row.severity ? (
                <Pill tone={TONE[row.severity]} className="shrink-0">
                  {BRIEF_SEVERITY_LABEL[row.severity]}
                </Pill>
              ) : row.assessed ? (
                <Pill tone="ok" icon={<Minus size={11} aria-hidden="true" />} className="shrink-0">
                  Nothing raised
                </Pill>
              ) : (
                <Pill
                  tone="neutral"
                  icon={<CircleHelp size={11} aria-hidden="true" />}
                  className="shrink-0"
                >
                  Not assessed
                </Pill>
              )}
            </div>

            {row.clauses.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {row.clauses.slice(0, 6).map((clause) => (
                  <li key={clause.ref}>
                    <Pill tone={TONE[clause.severity]} dot={false} className="font-mono">
                      {clause.ref}
                      {/* An unsettled grade is the engine saying a person has
                          to look. It travels with the number, because "Low" on
                          its own reads as "small". */}
                      {!clause.settled && <span className="opacity-70"> · unsettled</span>}
                    </Pill>
                  </li>
                ))}
                {row.clauses.length > 6 && (
                  <li className="px-1 py-0.5 text-[11.5px] text-ink/50">
                    +{row.clauses.length - 6} more
                  </li>
                )}
              </ul>
            )}

            {row.notes.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {row.notes.map((note) => (
                  <li key={note} className="flex gap-1.5 text-[12px] text-ink/70">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
                    {note}
                  </li>
                ))}
              </ul>
            )}

            {!row.assessed && (
              <p className="mt-1.5 text-[12px] text-ink/50">
                {row.dimension === "lock_in"
                  ? "This run predates the vendor lock-in check, or the design said nothing a reviewer could weigh. Support dates are not evidence about it."
                  : "Nothing in this submission spoke to it."}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
