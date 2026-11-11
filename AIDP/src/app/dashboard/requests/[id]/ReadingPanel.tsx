"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleAlert,
  Loader2,
  Quote,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { PipelineWatcher } from "@/app/dashboard/documents/PipelineWatcher";
import {
  READABLE,
  asFieldValue,
  type Proposal,
  type ReadableField,
  type ReadingState,
} from "@/lib/ingest/reading-vocabulary";
import { acceptAnswers, dismissReading, readDesigns } from "../actions";

/**
 * What the attached designs already answer, offered before the form asks.
 *
 * The brief's Group C is "auto-extracted from the diagram and shown for
 * confirmation". This is the confirmation half, and almost everything about it
 * is shaped by one worry: a person confirming eight answers at a glance will
 * wave through whatever is put in front of them. So:
 *
 * **Every proposal shows the design's own words.** Not a confidence score — a
 * quote, with the document and section it came from. A requestor reading
 * "Confidential" above "all customer records are classified Confidential
 * (§2 Data)" is checking a fact, not trusting a number. A proposal whose quote
 * could not be found in the design never reaches this component; it was dropped
 * by the worker.
 *
 * **Nothing is accepted by default.** The boxes start ticked because the common
 * case is agreement and eight clicks to agree is the data entry this removes —
 * but accepting is still a press, and the press names what it is filling in.
 * Nothing is written to the request until it happens.
 *
 * **An answer already given is never silently replaced.** A proposal for a
 * field the requestor has already typed into is shown with what they wrote, so
 * accepting it is visibly an overwrite rather than a surprise on the next step.
 *
 * The panel is otherwise a state machine with four states, and each says what
 * to do next rather than only where things stand: nothing read yet, reading,
 * read, and could not be read.
 */

export type ReadingView = {
  state: ReadingState;
  proposals: Proposal[];
  acceptedFields: ReadableField[];
  stale: boolean;
  error: string | null;
};

/** What the wizard currently has in the box a proposal would fill. Only the
 *  fields a reading can propose, and only as text, because all this is used for
 *  is showing the requestor what they would be overwriting. */
export type CurrentAnswers = Partial<Record<ReadableField, string>>;

export function ReadingPanel({
  requestId,
  reading,
  designs,
  current,
  canEdit,
  onAccept,
}: {
  requestId: string;
  reading: ReadingView | null;
  /** How many designs are attached and readable. Zero means there is nothing
   *  to offer, and the panel says so instead of showing a button that refuses. */
  designs: number;
  current: CurrentAnswers;
  canEdit: boolean;
  /** Merges accepted answers into the wizard's own state, so the boxes below
   *  fill in without waiting for the server round trip to come back. */
  onAccept: (values: Partial<Record<string, string | string[] | boolean>>) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const proposals = reading?.proposals ?? [];
  const outstanding = proposals.filter(
    (proposal) => !(reading?.acceptedFields ?? []).includes(proposal.field),
  );
  const [chosen, setChosen] = useState<Set<ReadableField> | null>(null);
  const picked = chosen ?? new Set(outstanding.map((proposal) => proposal.field));

  function toggle(field: ReadableField) {
    const next = new Set(picked);
    if (next.has(field)) next.delete(field);
    else next.add(field);
    setChosen(next);
  }

  function read() {
    startTransition(async () => {
      const result = await readDesigns(requestId);
      setMessage(result.ok ? null : result.message);
      setChosen(null);
      router.refresh();
    });
  }

  function accept() {
    const fields = outstanding
      .map((proposal) => proposal.field)
      .filter((field) => picked.has(field));
    if (fields.length === 0) return;

    startTransition(async () => {
      const result = await acceptAnswers(requestId, fields);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      // The same values the server just stored, put straight into the wizard's
      // state. Without this the boxes stay as they were until the refresh lands
      // — and a requestor who clicks on to the next step in that gap saves the
      // old answers back over the new ones.
      const values: Partial<Record<string, string | string[] | boolean>> = {};
      for (const proposal of outstanding) {
        if (!fields.includes(proposal.field)) continue;
        const spec = READABLE[proposal.field];
        if (spec.shape === "list") {
          values[proposal.field] = Array.isArray(proposal.value) ? proposal.value : [];
        } else if (spec.shape === "text") {
          values[proposal.field] = String(proposal.value);
        } else {
          values[proposal.field] = true;
          if (spec.detail && proposal.value) values[spec.detail] = String(proposal.value);
        }
      }
      onAccept(values);
      setMessage(null);
      setChosen(null);
      router.refresh();
    });
  }

  function discard() {
    startTransition(async () => {
      await dismissReading(requestId);
      setChosen(null);
      setMessage(null);
      router.refresh();
    });
  }

  if (!canEdit) return null;

  const busy = reading?.state === "reading";

  return (
    <div className="sm:col-span-2 rounded-xl border border-line bg-canvas-sunk/40 px-3.5 py-3">
      {/* Polls only while a reading is on the queue, and stops when the tab is
          hidden. See PipelineWatcher, which already owns both rules. */}
      <PipelineWatcher active={busy} />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <Sparkles size={13} aria-hidden="true" className="text-royal" />
            Fill these in from your designs
          </p>
          <p className="mt-0.5 text-[12.5px] text-ink/64">
            {designs === 0
              ? "Attach a design or a diagram above and this can answer most of the questions below for you."
              : "Your designs already say most of this. Read them, check what comes back, and keep what is right."}
          </p>
        </div>

        {designs > 0 && !busy && (
          <button
            type="button"
            disabled={pending}
            onClick={read}
            className={cn(
              "shrink-0 cursor-pointer rounded-full border border-royal-mid px-3 py-1 text-[12.5px] font-medium text-royal transition-colors hover:bg-royal/5",
              pending && "opacity-50",
            )}
          >
            {reading ? (
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw size={12} aria-hidden="true" />
                Read them again
              </span>
            ) : (
              "Read my designs"
            )}
          </button>
        )}
      </div>

      {busy && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] text-ink/70">
          <Loader2 size={13} aria-hidden="true" className="animate-spin" />
          Reading your designs. This takes a few moments — the page fills in by itself.
        </p>
      )}

      {reading?.state === "failed" && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] text-ink/70">
          <CircleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
          {reading.error ?? "The designs could not be read. Answer the questions below instead."}
        </p>
      )}

      {/* A reading describes the designs it read. Attach another and it is
          about a submission that no longer exists, which is worth saying rather
          than quietly showing yesterday's answers beside today's documents. */}
      {reading?.stale && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] text-ink/70">
          <CircleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
          The designs have changed since this was read. Read them again for answers that
          cover all of them.
        </p>
      )}

      {message && <p className="mt-2.5 text-[12.5px] text-warn">{message}</p>}

      {reading?.state === "ready" && proposals.length === 0 && (
        <p className="mt-2.5 text-[12.5px] text-ink/64">
          Nothing in the designs answered these questions outright, so they are yours to
          answer below. Nothing was guessed at.
        </p>
      )}

      {outstanding.length > 0 && (
        <>
          <ul className="mt-3 space-y-2">
            {outstanding.map((proposal) => {
              const spec = READABLE[proposal.field];
              const existing = current[proposal.field]?.trim();
              const on = picked.has(proposal.field);
              return (
                <li
                  key={proposal.field}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 transition-colors",
                    on ? "border-royal-mid/60 bg-card" : "border-line bg-card/50",
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(proposal.field)}
                      className="mt-0.5 size-3.5 shrink-0 accent-[var(--royal)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-ink/58">{spec.label}</span>
                      <span className="mt-0.5 block text-[13px] font-medium text-ink">
                        {spec.shape === "yes"
                          ? `Yes${proposal.value ? ` — ${asFieldValue(proposal)}` : ""}`
                          : asFieldValue(proposal)}
                      </span>

                      {existing && (
                        <span className="mt-1 block text-[11.5px] text-warn">
                          Replaces what you have written: “{existing.slice(0, 120)}
                          {existing.length > 120 ? "…" : ""}”
                        </span>
                      )}

                      <span className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-ink/60">
                        <Quote size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
                        <span className="min-w-0">
                          “{proposal.quote}”
                          <span className="block text-ink/45">
                            {proposal.documentTitle}
                            {proposal.section ? ` · ${proposal.section}` : ""}
                            {proposal.page ? ` · page ${proposal.page}` : ""}
                          </span>
                        </span>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || picked.size === 0}
              onClick={accept}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-royal px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-opacity",
                (pending || picked.size === 0) && "opacity-50",
              )}
            >
              <Check size={13} aria-hidden="true" />
              {picked.size === outstanding.length
                ? `Use all ${outstanding.length}`
                : `Use ${picked.size} of ${outstanding.length}`}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={discard}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1.5 text-[12.5px] text-ink/60 hover:text-ink"
            >
              <X size={12} aria-hidden="true" />
              Discard these
            </button>
          </div>
        </>
      )}

      {reading?.state === "ready" &&
        outstanding.length === 0 &&
        reading.acceptedFields.length > 0 && (
          <p className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] text-ink/64">
            <Check size={13} aria-hidden="true" className="text-ok" />
            {reading.acceptedFields.length === 1
              ? "One answer filled in from your designs."
              : `${reading.acceptedFields.length} answers filled in from your designs.`}{" "}
            Check them below before you submit.
          </p>
        )}
    </div>
  );
}
