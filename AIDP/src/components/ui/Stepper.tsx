import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Where a request has got to, as the five steps the brief names.
 *
 * The client's prototype puts this band at the top of every screen a
 * submission passes through — intake, the two checks, the report, the
 * decision — and that repetition is the point: a person opening a report has
 * no other way to see that the criteria check already happened, or that a
 * decision is still owed. Each screen used to say only what it was itself.
 *
 * Steps 2 and 3 run at the same time, so `current` takes a list rather than a
 * number and `note` carries the sentence that says why two circles are lit.
 * Everything before the *earliest* current step is done — with two in flight,
 * "done" cannot be read off a single index.
 */
export const WORKFLOW_STEPS: readonly string[] = [
  "Intake",
  "Criteria check",
  "Standards review",
  "Review report",
  "Decision",
];

export function Stepper({
  steps = WORKFLOW_STEPS,
  current,
  note,
  className,
}: {
  steps?: readonly string[];
  /** 1-based. Several at once for steps that run in parallel. */
  current: number | number[];
  /** The line under the band — "steps 2 and 3 run together", say. */
  note?: React.ReactNode;
  className?: string;
}) {
  const live = Array.isArray(current) ? current : [current];
  const earliest = live.length > 0 ? Math.min(...live) : 1;

  return (
    <div className={cn("mb-6", className)}>
      <ol className="flex items-start">
        {steps.map((label, index) => {
          const step = index + 1;
          const isCurrent = live.includes(step);
          const isDone = !isCurrent && step < earliest;
          const isLast = step === steps.length;

          return (
            <li
              key={label}
              className="relative flex min-w-0 flex-1 flex-col items-center"
              aria-current={isCurrent ? "step" : undefined}
            >
              {/* The connector, drawn by the node on its left so the last one
                  has nothing trailing off the end of the band. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[calc(50%+18px)] right-[calc(-50%+18px)] top-[15px] h-px",
                    isDone ? "bg-royal" : "bg-line",
                  )}
                />
              )}

              <span
                className={cn(
                  "relative z-10 grid size-[30px] place-items-center rounded-full border-2 text-[12.5px] font-semibold tabular-nums transition-colors",
                  isDone && "border-royal bg-royal text-white",
                  isCurrent &&
                    "border-royal bg-card text-royal shadow-[0_0_0_4px_var(--color-royal-tint)]",
                  !isDone && !isCurrent && "border-line bg-card text-ink/50",
                )}
              >
                {isDone ? <Check size={14} strokeWidth={2.6} aria-hidden="true" /> : step}
              </span>

              <span
                className={cn(
                  "mt-2 max-w-[7.5rem] text-center text-[11.5px] leading-tight",
                  isDone || isCurrent ? "font-semibold text-ink" : "text-ink/55",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {note ? (
        <p className="mt-3 text-center text-[11.5px] italic text-royal-deep">{note}</p>
      ) : null}
    </div>
  );
}

/**
 * Which circles are lit for a request in a given state.
 *
 * Presentation, not policy: the states themselves are `@/lib/ingest/requests`'
 * business, and this only decides how far along the band they read. It lives
 * beside the component so the request screen and the report screen cannot draw
 * the same request at two different steps.
 *
 * "Submitted" lights two circles because the brief's steps 2 and 3 genuinely
 * run together — the criteria check against the intake answers, and the
 * standards review against the design — and neither waits on the other.
 */
export function requestStep(state: string): number[] {
  switch (state) {
    case "submitted":
      return [2, 3];
    case "ready":
    case "checking":
      return [3];
    case "reported":
      return [4];
    case "decided":
      return [5];
    // A draft is still being written, and a stopped request is back in the
    // requestor's hands to correct — both are step one.
    default:
      return [1];
  }
}
