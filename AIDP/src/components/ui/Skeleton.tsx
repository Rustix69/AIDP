import { cn } from "@/lib/cn";

/**
 * Loading placeholders, shaped like the screens they stand in for.
 *
 * Each route's loading.tsx composes these into the outline of its own page —
 * the same panels, widths and rhythm — so the real content resolves into place
 * instead of replacing something that looked nothing like it.
 *
 * Bones are ink at low alpha rather than a fixed grey, so one shape reads on a
 * white card and on the dark app shell alike. `cn` does not merge conflicting
 * classes, so variations are props here rather than overriding classNames.
 */

const CELL = ["w-36", "w-28", "w-44", "w-32", "w-40"];

/** One placeholder bar, or a block with `square`. Size comes from `className`. */
export function Bone({ className, square = false }: { className?: string; square?: boolean }) {
  return (
    <div className={cn("max-w-full bg-ink/8", square ? "rounded-lg" : "rounded-full", className)} />
  );
}

/**
 * The frame every loading screen shares. The shapes pulse together — or hold
 * still for anyone who has asked for less motion — and are hidden from
 * assistive tech, which hears one status line instead.
 */
export function SkeletonScreen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        {children}
      </div>
      <p role="status" className="sr-only">
        {label}
      </p>
    </>
  );
}

/**
 * PageHeader's block: an eyebrow where the page has one, the title, and one
 * lede bar per width given — down to the rule the real header draws.
 */
export function PageHeaderSkeleton({
  eyebrow = true,
  lede = ["w-[34rem]"],
}: {
  eyebrow?: boolean;
  lede?: string[];
}) {
  return (
    <div className="mb-6 border-b border-line pb-5">
      {eyebrow ? <Bone className="h-2.5 w-28" /> : null}
      <Bone className={cn("h-7 w-72", eyebrow ? "mt-3.5" : "mt-1")} />
      {lede.map((width, index) => (
        <Bone key={index} className={cn("h-3.5", index === 0 ? "mt-4" : "mt-2.5", width)} />
      ))}
    </div>
  );
}

/**
 * HeroCard's block: the greeting, the one line under it, and the action.
 *
 * Its own bones rather than `Bone`: the hero is the page's only deep surface,
 * and ink at 8% is invisible on it. White at the same weight reads there the
 * way `Bone` reads on a card.
 */
export function HeroSkeleton() {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-2xl bg-deep px-7 py-6 shadow-card">
      <div className="min-w-0">
        <div className="h-7 w-56 max-w-full rounded-full bg-white/15" />
        <div className="mt-4 h-4 w-[26rem] max-w-full rounded-full bg-white/10" />
      </div>
      <div className="h-11 w-44 shrink-0 rounded-full border border-white/25 bg-white/10" />
    </div>
  );
}

/** A figure tile: icon and label, the number, and a hint beneath. */
export function StatSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-center gap-2">
        <Bone square className="size-4" />
        <Bone className="h-3 w-24" />
      </div>
      <Bone square className="mt-4 h-8 w-14" />
      <Bone className="mt-2.5 h-3 w-32" />
    </div>
  );
}

/**
 * A `Panel` with a divided list in it — head, rule, then one `PanelRow` each.
 *
 * `when` draws the second, quieter line under the pill, which is what makes a
 * recent-activity row taller than a plain one; panels without it pass it over.
 */
export function PanelListSkeleton({
  rows = 4,
  when = false,
}: {
  rows?: number;
  when?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <div className="border-b border-line px-5 pt-4 pb-3.5">
        <Bone className="h-4 w-40" />
        <Bone className="mt-2.5 h-3 w-64" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center justify-between gap-3.5 px-5 py-3">
            <div className="min-w-0">
              <Bone className={cn("h-3.5", CELL[index % CELL.length])} />
              <Bone className="mt-1.5 h-3 w-40" />
            </div>
            <div className="shrink-0">
              <div className="ml-auto h-[26px] w-24 rounded-full border border-line" />
              {when ? <Bone className="ml-auto mt-1 h-3 w-14" /> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** A bordered table: a header band, then rows led by a name-and-detail cell. */
export function TableSkeleton({
  columns,
  rows = 5,
  rounded = "2xl",
}: {
  columns: number;
  rows?: number;
  rounded?: "xl" | "2xl";
}) {
  const rest = Array.from({ length: columns - 1 }, (_, index) => index);

  return (
    <div
      className={cn(
        "overflow-hidden border border-line",
        rounded === "xl" ? "rounded-xl" : "rounded-2xl",
      )}
    >
      <div className="flex items-center gap-6 border-b border-line bg-card px-4 py-3">
        <div className="min-w-0 flex-[2]">
          <Bone className="h-2.5 w-16" />
        </div>
        {rest.map((index) => (
          <div key={index} className="flex min-w-0 flex-1 justify-end">
            <Bone className="h-2.5 w-14" />
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="flex items-center gap-6 border-b border-line-soft px-4 py-3 last:border-0"
        >
          <div className="min-w-0 flex-[2]">
            <Bone className={cn("h-3.5", CELL[row % CELL.length])} />
            <Bone className="mt-2 h-3 w-48" />
          </div>
          {rest.map((index) => (
            <div key={index} className="flex min-w-0 flex-1 justify-end">
              <Bone className="h-3 w-12" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const PILL = ["w-24", "w-20", "w-28", "w-[4.5rem]", "w-24"];

/** A row of outlined filter pills. `className` is for spacing around the row. */
export function PillsSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={cn("h-7 rounded-full border border-line", PILL[index % PILL.length])}
        />
      ))}
    </div>
  );
}

/** UploadZone's drop target, at rest: centred, with the button it leads with. */
export function DropZoneSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3.5 rounded-2xl border border-line bg-canvas-sunk px-4 py-10">
      <Bone square className="h-12 w-16" />
      <div className="flex flex-col items-center gap-2.5">
        <div className="h-10 w-52 rounded-full bg-royal/40" />
        <Bone className="h-3 w-56" />
      </div>
    </div>
  );
}
