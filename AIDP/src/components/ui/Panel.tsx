import { cn } from "@/lib/cn";

/**
 * A titled panel — the unit the client's prototype builds every screen out of.
 *
 * Every board in that file is a white card with a serif heading at the top and
 * one kind of thing inside it: a list of rows, a table, a chart. This is that
 * card, so the heading sits at the same size and the same distance from the
 * content on all of them, instead of each page choosing again.
 *
 * `flush` is for the panels whose content runs edge to edge — a table, or a
 * list with its own row dividers. Padding those twice is what made the tables
 * on the existing screens look inset by a different amount on every page.
 */
export function Panel({
  title,
  blurb,
  action,
  flush,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  /** The quiet line under the heading. */
  blurb?: React.ReactNode;
  /** Right of the heading — a filter, a count, a link onward. */
  action?: React.ReactNode;
  /** Content runs to the panel's edge: tables, divided lists. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const hasHead = Boolean(title || blurb || action);

  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-line bg-card shadow-card",
        className,
      )}
    >
      {hasHead && (
        <header
          className={cn(
            "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4",
            flush ? "border-b border-line pb-3.5" : "pb-3",
          )}
        >
          <div className="min-w-0">
            {title ? (
              <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">
                {title}
              </h2>
            ) : null}
            {blurb ? (
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink/62">{blurb}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      )}

      <div className={cn(flush ? null : "px-5 pb-5", !hasHead && !flush && "pt-5", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/**
 * A row in a panel's list — the prototype's `.activity-row`.
 *
 * Something on the left with a second line under it, something on the right
 * with its own second line. Shared because four panels in that file are this
 * row and nothing else, and the right-hand column drifts the moment each one
 * writes its own.
 *
 * It draws no rule of its own: the container does, with `divide-y
 * divide-line`. A `border-b ... last:border-b-0` here looked right and was
 * not — these rows are almost always wrapped one-per-link, so every row is
 * its wrapper's last child and `last:` switched every rule off.
 */
export function PanelRow({
  title,
  meta,
  aside,
  when,
  className,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** Top right — a pill, usually. */
  aside?: React.ReactNode;
  /** Under the aside, quieter — when it happened. */
  when?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3.5 px-5 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-ink">{title}</div>
        {meta ? <div className="mt-0.5 truncate text-[12px] text-ink/58">{meta}</div> : null}
      </div>
      {(aside || when) && (
        <div className="shrink-0 text-right">
          {aside}
          {when ? (
            <div className="mt-0.5 whitespace-nowrap text-[12px] text-ink/58">{when}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
