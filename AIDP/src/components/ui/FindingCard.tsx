import { cn } from "@/lib/cn";
import { Pill, type PillTone } from "@/components/ui/Pill";

/**
 * One finding, as the prototype's report draws it.
 *
 * A card ruled down its left edge in the severity's own colour, a pill and the
 * clause reference across the top, then what is wrong and what to do about it.
 * The rule is the part that matters in a list of them: severity has to be
 * readable while scrolling past, and a pill alone is too small to carry that
 * at arm's length.
 *
 * The recommendation sits in its own sunk block rather than as another
 * paragraph. In a board pack the two get read by different people — the
 * description is the case, the recommendation is the ask — and running them
 * together is what made reviewers quote the wrong one.
 */
const RULE: Record<PillTone, string> = {
  critical: "border-l-danger",
  high: "border-l-warn",
  medium: "border-l-warn/60",
  low: "border-l-line-strong",
  ok: "border-l-ok",
  info: "border-l-royal",
  warn: "border-l-warn",
  accent: "border-l-royal",
  neutral: "border-l-line-strong",
};

export function FindingCard({
  tone = "neutral",
  severity,
  reference,
  title,
  description,
  recommendation,
  recommendationLabel = "Recommendation",
  footer,
  className,
}: {
  tone?: PillTone;
  /** The word in the pill — "High", "Medium". Omitted draws no pill. */
  severity?: React.ReactNode;
  /** Top right: the clause this came from. */
  reference?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  recommendation?: React.ReactNode;
  recommendationLabel?: string;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "rounded-xl border border-l-4 border-line bg-card px-4 py-3.5 shadow-card",
        RULE[tone],
        className,
      )}
    >
      {(severity || reference) && (
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {severity ? <Pill tone={tone}>{severity}</Pill> : <span />}
          {reference ? (
            <span className="truncate font-mono text-[11.5px] text-ink/55">{reference}</span>
          ) : null}
        </header>
      )}

      <h3 className="text-[13.5px] font-semibold leading-snug text-ink">{title}</h3>

      {description ? (
        <p className="mt-1 text-[13px] leading-relaxed text-ink/78">{description}</p>
      ) : null}

      {recommendation ? (
        <p className="mt-2.5 rounded-lg bg-canvas-sunk px-3 py-2.5 text-[12.5px] leading-relaxed text-ink/75">
          <b className="font-semibold text-ink">{recommendationLabel}:</b> {recommendation}
        </p>
      ) : null}

      {footer ? <div className="mt-2.5">{footer}</div> : null}
    </article>
  );
}
