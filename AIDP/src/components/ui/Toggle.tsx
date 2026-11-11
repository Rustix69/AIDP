import { cn } from "@/lib/cn";

/**
 * On or off, as a switch.
 *
 * The client's prototype turns a significance category on and off with a
 * switch rather than a labelled button, and it is the right control for it:
 * what an administrator is setting is a state with two sides, and a button
 * reading "Checked" leaves them working out whether that is the current state
 * or what pressing it would do. A switch says both at once.
 *
 * `role="switch"` rather than a checkbox, so assistive tech announces "on" and
 * "off" instead of "checked" — the same distinction, said in the words the
 * screen uses. The label belongs to the row this sits in, so it is passed in
 * rather than drawn: every one of these is beside the thing it governs.
 */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What this switches, for screen readers. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors duration-150",
        checked ? "border-ok bg-ok" : "border-line-strong bg-canvas-sunk",
        disabled && "opacity-50",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[2px] size-4 rounded-full bg-white shadow-sm transition-[left] duration-150",
          checked ? "left-[18px]" : "left-[2px]",
        )}
      />
    </button>
  );
}
