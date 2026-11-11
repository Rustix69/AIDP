import { cn } from "@/lib/cn";
import {
  Bone,
  HeroSkeleton,
  PanelListSkeleton,
  SkeletonScreen,
  StatSkeleton,
} from "@/components/ui/Skeleton";

const PROJECTS = ["w-56", "w-44", "w-64"];

/**
 * The workspace home while its projects load.
 *
 * The dashboard reads the session, which means a round trip to Neon on every
 * request — it can never be prefetched in full. This fallback is what makes the
 * post-sign-in redirect land immediately instead of hanging on the auth screen
 * while the session query runs.
 *
 * Shaped like the three bands the page actually opens on — greeting, figures,
 * what is outstanding — and then the project list. It used to draw a page
 * header and a centred button, which is the screen as it was two redesigns
 * ago: everything landed a band lower than the outline promised.
 *
 * The panels and the archive are conditional on the real page, so this draws
 * the populated case: a workspace with nothing in it resolves to something
 * shorter, which settles upward, rather than content appearing under a
 * skeleton that was never tall enough for it.
 */
export default function DashboardLoading() {
  return (
    <SkeletonScreen label="Loading your projects">
      <HeroSkeleton />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <StatSkeleton key={index} />
        ))}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <PanelListSkeleton rows={4} />
        <PanelListSkeleton rows={4} when />
      </div>

      {/* The list's own heading row, with "New project" sitting in it. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <Bone className="h-4 w-24" />
          <Bone className="h-3 w-16" />
        </div>
        <div className="h-9 w-32 rounded-full bg-royal/40" />
      </div>

      <div className="space-y-2.5">
        {PROJECTS.map((width, index) => (
          <div
            key={index}
            className="card-sheen rounded-2xl border border-line bg-card p-5 shadow-card"
          >
            <div className="flex flex-wrap items-start gap-4">
              <Bone square className="mt-0.5 size-9 shrink-0" />
              <div className="min-w-0 flex-1">
                <Bone className={cn("h-5", width)} />
                <Bone className="mt-2 h-3.5 w-80" />
                <div className="mt-4 flex gap-5">
                  <Bone className="h-3 w-20" />
                  <Bone className="h-3 w-28" />
                </div>
              </div>
              <div className="hidden shrink-0 flex-col items-end sm:flex">
                <Bone className="h-3 w-32" />
                <Bone className="mt-1.5 h-3 w-24" />
                <Bone square className="mt-2.5 size-3.5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* The two set-up links at the foot. */}
      <div className="mt-10 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="flex items-center gap-3.5 rounded-xl border border-line bg-card px-4 py-3.5"
          >
            <Bone square className="size-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <Bone className="h-3.5 w-36" />
              <Bone className="mt-2 h-3 w-56" />
            </div>
            <Bone square className="size-3.5 shrink-0" />
          </div>
        ))}
      </div>
    </SkeletonScreen>
  );
}
