import { cn } from "@/lib/cn";

/**
 * The table the prototype uses everywhere a list has columns.
 *
 * Quiet uppercase headers on a rule, generous row padding, a hairline between
 * rows and none under the last — and no vertical rules at all, because the
 * columns are already aligned and a grid of boxes reads as a spreadsheet
 * rather than as a register.
 *
 * Three screens here had their own `<table>` with their own header sizes. The
 * wrapper carries the horizontal scroll too: a table that overflows its card
 * on a narrow window is what pushed the page itself sideways.
 */
export function DataTable({
  head,
  minWidth = 560,
  className,
  children,
}: {
  /** The header cells. */
  head: React.ReactNode[];
  /** Below this the table scrolls inside its panel rather than squeezing. */
  minWidth?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-left" style={{ minWidth }}>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className="border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/58"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <tr className={cn("border-b border-line last:border-b-0", className)}>{children}</tr>
  );
}

export function Cell({
  className,
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-3 align-middle text-[13px] text-ink/82", className)} {...props}>
      {children}
    </td>
  );
}
