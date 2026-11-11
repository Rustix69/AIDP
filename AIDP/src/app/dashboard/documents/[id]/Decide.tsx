"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Ban, Check, Gavel, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/Pill";
import {
  OUTCOMES,
  OUTCOME_META,
  type Outcome,
  type OutcomeSnapshot,
} from "@/lib/ingest/outcomes-vocabulary";
import { recordOutcome } from "../actions";

export type OutcomeView = {
  id: string;
  decision: Outcome;
  note: string;
  decidedByName: string;
  createdAt: string;
  snapshot: OutcomeSnapshot | null;
};

/** The recorded outcome, as a pill on the history entry. Named by meaning so
 *  a decision reads the same here as its state does anywhere else. */
const HISTORY_TONE = {
  good: "ok",
  bad: "critical",
  warn: "warn",
  escalate: "accent",
} as const;

const ICON = {
  approved: Check,
  rejected: Ban,
  revise: RefreshCw,
  escalated: ArrowUpRight,
} as const;

/**
 * The four outcomes as buttons rather than as chips.
 *
 * The client's prototype puts the decision at the bottom of the report as
 * three weighted controls — approve filled, the rest outlined — because that
 * is what the screen is *for*. As a row of equally quiet tinted chips the
 * decision read as a filter on the findings above it, and people went looking
 * for a submit button that was already there.
 *
 * Only approval is filled. Filling all four would make the loudest thing on
 * the page a choice between four loud things, and rejecting or escalating a
 * submission is not an action to invite by weight.
 */
const ACTION: Record<string, string> = {
  good: "border-ok bg-ok text-white hover:bg-ok/90",
  bad: "border-danger bg-card text-danger hover:bg-danger-tint",
  warn: "border-warn bg-card text-warn hover:bg-warn-tint",
  escalate: "border-royal bg-card text-royal hover:bg-royal-tint",
};

/**
 * What the reason box asks for, which is a different question each time.
 *
 * A map rather than the ternary chain this was: four outcomes made it three
 * deep, and the next one would have made it four.
 */
const PROMPT: Record<Outcome, string> = {
  approved: "Anything worth recording alongside the approval.",
  rejected: "Why is this design refused, and which findings carry the refusal?",
  revise: "What has to change before this is resubmitted?",
  escalated: "What is the board being asked to decide?",
};

/**
 * The end of the review.
 *
 * A report with no decision on it is an unfinished piece of work — there is no
 * record of who accepted a design or why, which is the first thing a governance
 * audit asks for. This is where that gets written down.
 *
 * The panel deliberately shows what is still outstanding without blocking on
 * it. Approving a report with contradictions open is a legitimate call an
 * architect is entitled to make; the system's job is to make sure the call was
 * an informed one and that it is on the record.
 */
export function Decide({
  runId,
  history,
  unreviewed,
  open,
  mayDecide,
}: {
  runId: string;
  history: OutcomeView[];
  /** Findings nobody has confirmed or overridden yet. */
  unreviewed: number;
  /** Findings that contradict the standard or leave it unaddressed. */
  open: number;
  /** Whether this person may resolve the submission at all — an architect or
   *  an administrator. `record` in outcomes.ts refuses regardless; this keeps
   *  the screen from offering a button that would be turned down, which reads
   *  as a fault rather than as a rule.
   *
   *  The history stays visible either way. What was decided about a piece of
   *  work is not a secret from the person who submitted it. */
  mayDecide: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chosen, setChosen] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const current = history[0] ?? null;
  const meta = chosen ? OUTCOME_META[chosen] : null;

  const submit = () =>
    chosen &&
    startTransition(async () => {
      const result = await recordOutcome(runId, chosen, note);
      setMessage(result.message);
      if (result.ok) {
        setChosen(null);
        setNote("");
      }
      router.refresh();
    });

  return (
    <section className="mb-10">
      <h2 className="mb-1 font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
        Decision
      </h2>
      <p className="mb-4 text-[12.5px] text-ink/64">
        {current
          ? "This submission has been decided. Recording another adds to the history."
          : "Every assessment ends in a recorded outcome."}
      </p>

      {history.length > 0 && (
        <ol className="mb-5 space-y-2">
          {history.map((entry, index) => {
            const entryMeta = OUTCOME_META[entry.decision];
            const Icon = ICON[entry.decision];
            return (
              <li
                key={entry.id}
                className={cn(
                  "rounded-xl border p-4",
                  index === 0 ? "border-line bg-card" : "border-line opacity-70",
                )}
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <Pill
                    tone={
                      HISTORY_TONE[entryMeta.tone as keyof typeof HISTORY_TONE] ?? "neutral"
                    }
                    icon={<Icon size={11} />}
                  >
                    {entryMeta.label}
                  </Pill>
                  <span className="text-[12.5px] text-ink/66">
                    {entry.decidedByName || "Unattributed"} ·{" "}
                    {new Date(entry.createdAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  {index === 0 && history.length > 1 && (
                    <span className="text-[11px] text-ink/62">current</span>
                  )}
                </div>

                {entry.note && (
                  <p className="mt-2.5 text-[13px] leading-relaxed text-ink/78">{entry.note}</p>
                )}

                {/* What the report said at the moment of the decision. Findings
                    stay editable afterwards, so without this the record drifts. */}
                {entry.snapshot && (
                  <p className="mt-2 text-[11.5px] text-ink/62">
                    At the time: {entry.snapshot.total} findings
                    {entry.snapshot.unreviewed > 0 &&
                      `, ${entry.snapshot.unreviewed} unreviewed`}
                    {Object.entries(entry.snapshot.verdicts)
                      // A clause-level "absent" is no longer reported; an older
                      // record's count of them would read as the new meaning.
                      .filter(([verdict, n]) => n > 0 && verdict !== "absent")
                      .map(([verdict, n]) => ` · ${n} ${verdict.replace(/_/g, " ")}`)
                      .join("")}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* The situation, then the call. The client's prototype states what is
          outstanding immediately above the buttons rather than leaving it
          somewhere up the page, and it is the one arrangement that makes an
          approval an informed one: the sentence a reviewer would have to go
          looking for is the sentence they read last. */}
      <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-ink">
              {open > 0
                ? `${open} finding${open === 1 ? "" : "s"} still contradict the standards`
                : unreviewed > 0
                  ? `${unreviewed} finding${unreviewed === 1 ? "" : "s"} not yet reviewed`
                  : "Nothing outstanding on this submission"}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink/70">
              {open > 0 || unreviewed > 0
                ? "Deciding anyway is a call you are entitled to make. It is recorded with what the report said at the time."
                : "Every finding raised has been ruled on. Record the outcome to close the review."}
            </p>
          </div>
          <Pill tone={open > 0 ? "high" : unreviewed > 0 ? "medium" : "ok"}>
            {open > 0 || unreviewed > 0 ? "Review required" : "Ready to decide"}
          </Pill>
        </div>

        <div className="px-5 py-4">
          {!mayDecide ? (
            <p className="text-[12.5px] text-ink/60">
              Only an architect, or an administrator, can decide what happens to a
              submission. Ask one of them to take it.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2.5">
                {OUTCOMES.map((outcome) => {
                  const outcomeMeta = OUTCOME_META[outcome];
                  const Icon = ICON[outcome];
                  return (
                    <button
                      key={outcome}
                      type="button"
                      disabled={pending}
                      aria-pressed={chosen === outcome}
                      onClick={() => setChosen(chosen === outcome ? null : outcome)}
                      title={outcomeMeta.blurb}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] font-semibold",
                        "transition-[background-color,border-color,box-shadow,color]",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-mid",
                        ACTION[outcomeMeta.tone] ?? ACTION.warn,
                        chosen === outcome && "ring-2 ring-line-strong",
                        pending && "opacity-50",
                      )}
                    >
                      <Icon size={14} />
                      {outcomeMeta.label}
                    </button>
                  );
                })}
              </div>

              {chosen && meta && (
                <div className="mt-4 rounded-xl border border-line bg-canvas-sunk p-4">
                  <p className="mb-3 text-[12.5px] text-ink/70">{meta.commitment}</p>

                  {/* Said before the attempt rather than after it. The refusal
                      itself lives in lib/ingest/outcomes.ts, where the report
                      is in reach. */}
                  {meta.requiresFinding && (
                    <p className="mb-3 text-[12px] leading-relaxed text-ink/62">
                      A rejection has to rest on a breach this report cited — a
                      contradiction, or a requirement met only in part, with evidence
                      behind it. Where the findings do not carry the refusal, the case for
                      it belongs to the board.
                    </p>
                  )}

                  <label className="block">
                    <span className="mb-1.5 block text-[11.5px] font-medium text-ink/64">
                      {meta.requiresNote ? "Reason (required)" : "Reason (optional)"}
                    </span>
                    <textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={3}
                      placeholder={PROMPT[chosen]}
                      className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-ink/88 placeholder:text-ink/58 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid"
                    />
                  </label>

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      disabled={pending || (meta.requiresNote && !note.trim())}
                      onClick={submit}
                      className="inline-flex items-center gap-1.5 rounded-full bg-royal px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-royal-mid disabled:opacity-40"
                    >
                      <Gavel size={13} />
                      Record {OUTCOME_META[chosen].label.toLowerCase()}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setChosen(null);
                        setNote("");
                      }}
                      className="text-[12.5px] text-ink/62 transition-colors hover:text-ink/78"
                    >
                      cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {message && (
        <p role="status" className="mt-3 text-[12.5px] text-ink/70">
          {message}
        </p>
      )}
    </section>
  );
}
