import { cn } from "@/lib/cn";

/**
 * The block a workspace opens on.
 *
 * The client's prototype starts its home screen with a deep panel carrying a
 * greeting, one sentence of what is waiting, and the single action most people
 * came to take. It is the only dark surface on the page, and that is what it is
 * for: on a tinted ground a page of white cards has nothing to push against,
 * so the eye has nowhere to land first.
 *
 * Painted in `deep` — the app's own anchor surface, the same one the auth
 * aside and the landing hero use — so it answers the theme switch along with
 * everything else rather than being a navy rectangle held against a dark page.
 *
 * `deep-surface` is load-bearing: it swaps the focus ring for the accent's
 * inverted rung, which is the only one visible against this ground.
 */
export function HeroCard({
  title,
  blurb,
  action,
  className,
}: {
  title: React.ReactNode;
  blurb?: React.ReactNode;
  /** The screen's primary action, pulled out to the right. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "deep-surface relative mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4",
        "overflow-hidden rounded-2xl bg-deep px-7 py-6 shadow-card",
        className,
      )}
    >
      {/* The accent falling across the panel from the far corner, so the
          ground reads as lit rather than as flat fill. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_140%_at_100%_0%,rgba(194,232,255,0.18),transparent_62%)]"
      />

      <div className="relative min-w-0">
        <h2 className="font-display text-[21px] font-semibold tracking-[-0.02em] text-white">
          {title}
        </h2>
        {blurb ? (
          <p className="mt-1.5 max-w-[34rem] text-[13.5px] leading-relaxed text-royal-light/85">
            {blurb}
          </p>
        ) : null}
      </div>

      {action ? <div className="relative shrink-0">{action}</div> : null}
    </section>
  );
}
