"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";

/**
 * The last boundary before Next's own.
 *
 * A segment's error.tsx does not catch its *own* layout — that error belongs
 * to the segment above — so the dashboard's boundary cannot help when the
 * failure is in the dashboard shell itself, which is where the access gate
 * runs and therefore where a database that has stopped answering shows up
 * first. This one is above the shell and catches exactly that case.
 *
 * It draws its own surface rather than borrowing any, because by definition
 * whatever layout should have been around it is the thing that failed.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app]", error);
  }, [error]);

  const unreachable = error.message.includes("did not respond");

  return (
    <div className="grid min-h-svh place-items-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-card">
        <span className="mx-auto mb-5 grid size-12 place-items-center rounded-xl border border-warn-line bg-warn-tint text-warn">
          <TriangleAlert size={22} strokeWidth={1.8} />
        </span>

        <h1 className="font-display text-[20px] font-semibold tracking-tight text-ink">
          {unreachable ? "This is taking too long" : "Something went wrong"}
        </h1>

        <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink/68">
          {unreachable
            ? "The database didn’t answer in time. Nothing has been lost — this is usually a moment’s interruption."
            : "We couldn’t load this screen. Trying again is usually enough."}
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Button type="button" onClick={reset} className="group">
            <RotateCw
              size={16}
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:rotate-45"
            />
            Try again
          </Button>
          <ButtonLink href="/dashboard" variant="secondary">
            Go to workspace
          </ButtonLink>
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
