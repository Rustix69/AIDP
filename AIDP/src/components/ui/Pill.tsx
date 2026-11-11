import { cn } from "@/lib/cn";

/**
 * A status pill.
 *
 * The client's prototype uses one shape for every piece of state in the
 * product — severity, lifecycle, adoption, whether a standard is mandatory —
 * a rounded capsule led by a dot in its own colour. Until this existed each
 * screen wrote its own capsule, so the same word ("High", "Active") came out
 * at three different sizes depending on where you read it.
 *
 * The dot is what makes the shape legible at a glance in a dense table: the
 * eye picks up a coloured point faster than it reads tinted type, and it is
 * the one part of the pill that survives being skimmed. It is `currentColor`,
 * so a tone only has to name one colour.
 *
 * Tones are the app's own tokens, not the prototype's hexes — the prototype
 * was drawn in teal and this product is blue, and the palette is not what the
 * client was showing us. The mapping is by *meaning*: the prototype's teal
 * "processing/review" state is this app's accent, its brown "escalated/hold"
 * is warn, and its gold "medium" shares warn's tint because the palette here
 * carries one caution hue rather than two.
 */
export type PillTone =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "ok"
  | "info"
  | "warn"
  | "accent"
  | "neutral";

const TONES: Record<PillTone, string> = {
  critical: "border-danger-line bg-danger-tint text-danger",
  high: "border-warn-line bg-warn-tint text-warn",
  // Medium is a step quieter than high. Same hue — the palette has one
  // caution colour — separated by whether the tint is filled in.
  medium: "border-warn-line bg-transparent text-warn",
  low: "border-line bg-canvas-sunk text-ink/70",
  ok: "border-ok-line bg-ok-tint text-ok",
  info: "border-royal-mid/40 bg-royal-tint text-royal-deep",
  warn: "border-warn-line bg-warn-tint text-warn",
  accent: "border-royal-mid/40 bg-royal/10 text-royal",
  neutral: "border-line bg-canvas-sunk text-ink/62",
};

export function Pill({
  tone = "neutral",
  dot = true,
  icon,
  className,
  children,
}: {
  tone?: PillTone;
  /** The leading point. Off for a pill that already carries an icon. */
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5",
        "text-[11.5px] font-semibold leading-5",
        TONES[tone],
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="shrink-0">
          {icon}
        </span>
      ) : dot ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : null}
      {children}
    </span>
  );
}
