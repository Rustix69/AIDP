import { cn } from "@/lib/cn";

/**
 * The two figures a report has to show at a glance.
 *
 * Both are status encodings, not categorical ones: the four severity tiers and
 * "how much of the standard passed" are states the product already has colours
 * for, so neither invents a palette. That is also why neither is a chart
 * library — a four-segment bar and a single filled track are geometry, and a
 * dependency to draw them would be a dependency to keep in step with the
 * tokens.
 *
 * Rules worth not re-deriving next time:
 *   - Segments are separated by a 2px gap in the surface colour, not by a
 *     border. A border on a tinted segment reads as a fifth colour.
 *   - Identity is never colour alone. Every segment is named in the legend
 *     with its count, and carries a `title` for the pointer — a reader who
 *     cannot tell warn from danger still gets the whole figure.
 *   - Numbers wear ink, not the severity's colour. The swatch beside them
 *     carries the identity; colouring the digits too is what makes a legend
 *     read as decoration.
 */
export type Band = {
  label: string;
  value: number;
  /** A background utility from the token set — `bg-danger`, `bg-warn`. */
  className: string;
};

export function StackBar({
  bands,
  className,
  emptyNote = "Nothing to show yet.",
}: {
  bands: Band[];
  className?: string;
  emptyNote?: string;
}) {
  const shown = bands.filter((band) => band.value > 0);
  const total = shown.reduce((sum, band) => sum + band.value, 0);

  if (total === 0) {
    return <p className={cn("text-[12.5px] text-ink/58", className)}>{emptyNote}</p>;
  }

  return (
    <div className={className}>
      <div
        className="flex h-[22px] w-full gap-[2px] overflow-hidden rounded-md"
        role="img"
        aria-label={shown.map((band) => `${band.value} ${band.label}`).join(", ")}
      >
        {shown.map((band, index) => (
          <span
            key={band.label}
            title={`${band.value} ${band.label}`}
            style={{ width: `${(band.value / total) * 100}%` }}
            className={cn(
              "h-full",
              band.className,
              // Only the outer ends are rounded, so the bar reads as one
              // measure cut into parts rather than as a row of pills.
              index === 0 && "rounded-l-md",
              index === shown.length - 1 && "rounded-r-md",
            )}
          />
        ))}
      </div>

      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
        {shown.map((band) => (
          <li key={band.label} className="flex items-center gap-1.5 text-[12px] text-ink/70">
            <span
              aria-hidden="true"
              className={cn("size-2 shrink-0 rounded-[2px]", band.className)}
            />
            <b className="font-semibold tabular-nums text-ink">{band.value}</b>
            {band.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One proportion, as a track with a label above it — the prototype's progress
 * rail, and the honest form for "40 of 42". A donut of two slices says the
 * same thing in more ink and is harder to compare between two reports.
 */
export function Meter({
  value,
  total,
  label,
  caption,
  tone = "bg-royal",
  className,
}: {
  value: number;
  total: number;
  label?: React.ReactNode;
  /** Under the track — what the figure means. */
  caption?: React.ReactNode;
  className?: string;
  tone?: string;
}) {
  const share = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;

  return (
    <div className={className}>
      {label ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[12.5px] text-ink/68">{label}</span>
          <span className="font-display text-[15px] font-semibold tabular-nums text-ink">
            {value}
            <span className="text-ink/50">/{total}</span>
          </span>
        </div>
      ) : null}

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-canvas-sunk"
        role="img"
        aria-label={`${value} of ${total}`}
      >
        <span
          className={cn("block h-full rounded-full", tone)}
          style={{ width: `${share * 100}%` }}
        />
      </div>

      {caption ? <p className="mt-1.5 text-[12px] text-ink/58">{caption}</p> : null}
    </div>
  );
}
