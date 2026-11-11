"use client";

import { useEffect } from "react";
import { RotateCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * What a broken screen looks like inside the workspace.
 *
 * There was no boundary here at all, which is worse than it sounds. Without
 * one, a page that fails takes the whole route down to Next's own fallback —
 * a bare "a server error occurred" on a blank document, with the navigation
 * gone and nothing to do but guess. And a page that *hangs* rather than fails
 * never gets even that: the route's loading.tsx stays on screen for as long as
 * the person is willing to look at it.
 *
 * So this sits inside the shell. The rail and the account block stay where
 * they are, one pane of the screen says what happened, and `reset` re-renders
 * the segment without a full page load — which is the right first move,
 * because the common failure behind this is a database that was briefly
 * unreachable and is fine a second later.
 *
 * No stack, no digest on display: this is a customer's screen. The error is
 * logged to the console, where the server has already written the real one.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  // `DatabaseUnreachable` is thrown by withDbTimeout and is the one failure
  // worth naming, because it is the one the person can act on: it is almost
  // always transient, and trying again is the whole remedy.
  const unreachable = error.message.includes("did not respond");

  return (
    <div className="grid min-h-[60svh] place-items-center">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-card">
        <span className="mx-auto mb-5 grid size-12 place-items-center rounded-xl border border-warn-line bg-warn-tint text-warn">
          <Unplug size={22} strokeWidth={1.8} />
        </span>

        <h1 className="font-display text-[20px] font-semibold tracking-tight text-ink">
          {unreachable ? "This is taking too long" : "This page didn’t load"}
        </h1>

        <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink/68">
          {unreachable
            ? "The database didn’t answer in time. Nothing has been lost — this is usually a moment’s interruption."
            : "Something went wrong putting this page together. Your work is unaffected."}
        </p>

        <div className="mt-6 flex items-center justify-center">
          <Button type="button" onClick={reset} className="group">
            <RotateCw
              size={16}
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:rotate-45"
            />
            Try again
          </Button>
        </div>

        {error.digest ? (
          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink/40">
            Reference {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
