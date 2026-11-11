"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  BRIEF_SEVERITY_LABEL,
  EDIT_FIELD_LABEL,
  OBLIGATIONS,
  OBLIGATION_META,
  SEVERITIES,
  SEVERITY_META,
  VERDICTS,
  VERDICT_META,
  effectiveFinding,
  readVerdict,
  type EditableField,
  type Obligation,
  type Severity,
  type Verdict,
} from "@/lib/ingest/verdicts";
import type { EditEvent } from "@/lib/ingest/finding-edit-plan";
import { editFinding } from "../actions";
import { SeverityTag } from "./SeverityTag";
import { TONE, type FindingView } from "./Assessment";

/**
 * Correcting a finding, and the record of every correction.
 *
 * A reviewer used to have two moves: agree with the engine, or swap its verdict
 * and leave a note. Everything else the finding said was the engine's and
 * stayed the engine's — and that covered the two things a reader of the report
 * actually acts on.
 *
 * The *rationale*, because that paragraph is what lands in the board packet and
 * the exported sheet. Asking somebody to sign off wording they can see is wrong
 * and cannot touch is asking them to put their name to the engine's mistake.
 *
 * The *obligation*, because severity is a function of it and nothing else.
 * `severityOf` will not invent an obligation the standard did not state, which
 * is right — but most enterprise standards are written in declarative prose
 * ("All external APIs are exposed through Apigee"), so they parse as `unstated`
 * and a real breach of a real rule comes out as "Check — a person has to look".
 * This is where the person who looked says what they found.
 *
 * ## Three things this panel is careful about
 *
 * **It shows the consequence while the reviewer is still deciding.** Severity
 * is recomputed on every chip press, so changing an obligation from unstated to
 * mandatory visibly moves the finding from Check to Critical before anything is
 * saved. A control whose effect only appears after a page refresh is one people
 * use once.
 *
 * **The engine's answer stays on screen and stays in the row.** Each field
 * marks which option the engine chose and offers one press to go back to it.
 * Nothing here overwrites the engine's column — corrections are stored beside
 * them — because the disagreement between the two is the only evaluation data
 * this product will ever have.
 *
 * **Every save is appended to a history nobody can edit.** "Who changed this
 * verdict, when, and what did they say about it" is the question a governance
 * audit puts to a compliance tool, and a note column that has been overwritten
 * four times cannot answer it.
 */

/** A reviewer's current, unsaved answers. Seeded from what the finding says now. */
type Draft = {
  verdict: Verdict;
  obligation: Obligation;
  /** Null means "work it out from the verdict and the obligation", which is the
   *  default and what every finding did before severity was editable. */
  severity: Severity | null;
  rationale: string;
  note: string;
  reason: string;
};

function seed(finding: FindingView): Draft {
  const effective = effectiveFinding(finding);
  return {
    // The form offers the known vocabulary, so a finding carrying a verdict
    // this build does not recognise seeds as `needs_review` rather than as a
    // chip that cannot be drawn. Saving then corrects it to something nameable,
    // which is the right outcome for a row nobody can read.
    verdict: readVerdict(effective.verdict),
    obligation: effective.obligation,
    // Seeded from the stored override, not from the resolved value: opening the
    // editor on a finding nobody has graded must not turn its derived severity
    // into an explicit one the moment somebody saves an unrelated change.
    severity: effective.corrected.severity ? effective.severity : null,
    rationale: effective.rationale,
    note: finding.reviewerNote ?? "",
    reason: "",
  };
}

export function FindingEditor({ finding }: { finding: FindingView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // Keyed to the finding id so stepping to the next one in the dialog never
  // carries a half-typed correction onto a different clause — the same
  // reasoning as `evidenceOpenFor` in FindingModal.
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => seed(finding));
  const [problem, setProblem] = useState<string | null>(null);

  const live = draftFor === finding.id ? draft : seed(finding);
  const current = effectiveFinding(finding);

  // What the finding would say if this were saved. The whole reason the panel
  // is worth opening: the reviewer sees the severity move as they press.
  const preview = effectiveFinding({
    verdict: current.engine.verdict,
    obligation: current.engine.obligation,
    rationale: current.engine.rationale,
    reviewerVerdict: live.verdict,
    reviewerObligation: live.obligation,
    reviewerSeverity: live.severity,
    reviewerRationale: live.rationale,
  });

  /**
   * What the verdict and obligation come to on their own, as this save would
   * leave them. The chip marked with it is the one that stores no override.
   */
  const derivedSeverity = effectiveFinding({
    verdict: current.engine.verdict,
    obligation: current.engine.obligation,
    rationale: current.engine.rationale,
    reviewerVerdict: live.verdict,
    reviewerObligation: live.obligation,
  }).severity;

  const set = (patch: Partial<Draft>) => {
    setDraftFor(finding.id);
    setDraft({ ...live, ...patch });
  };

  const dirty =
    live.verdict !== current.verdict ||
    live.obligation !== current.obligation ||
    live.severity !== (current.corrected.severity ? current.severity : null) ||
    live.rationale.trim() !== current.rationale.trim() ||
    live.note.trim() !== (finding.reviewerNote ?? "").trim();

  const start = () => {
    setDraftFor(finding.id);
    setDraft(seed(finding));
    setProblem(null);
    setOpen(true);
  };

  const cancel = () => {
    setOpen(false);
    setDraftFor(null);
    setProblem(null);
  };

  const save = () =>
    startTransition(async () => {
      // Only the fields this save actually moved. `undefined` means "leave it
      // alone" and the verdict is the one that matters: addressing it is what
      // records a finding as reviewed, so sending it unchanged would mark a
      // pending finding confirmed because somebody tidied its wording.
      const result = await editFinding(finding.id, {
        verdict: live.verdict === current.verdict ? undefined : live.verdict,
        obligation: live.obligation === current.obligation ? undefined : live.obligation,
        // Null is a real value here — "stop overriding it, derive it again" —
        // so the untouched case has to be `undefined` rather than null.
        severity:
          live.severity === (current.corrected.severity ? current.severity : null)
            ? undefined
            : live.severity,
        rationale:
          live.rationale.trim() === current.rationale.trim() ? undefined : live.rationale,
        note:
          live.note.trim() === (finding.reviewerNote ?? "").trim() ? undefined : live.note,
        reason: live.reason,
      });
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      // Stays open on success rather than closing: unlike confirming a finding,
      // editing one is not the end of working it — a reviewer who has just
      // sharpened the obligation often writes the rationale next, and a panel
      // that shut each time would make that three round trips.
      setProblem(null);
      setDraftFor(null);
      router.refresh();
    });

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={start}
          className="rounded-full border border-line px-3 py-1.5 text-[11.5px] text-ink/68 transition-colors hover:border-royal-mid/50 hover:text-royal"
        >
          Edit finding
        </button>
        {finding.history.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink/58">
            <History size={11} aria-hidden="true" />
            {finding.history.length === 1
              ? "1 change"
              : `${finding.history.length} changes`}
            {finding.editedByName && <>, last by {finding.editedByName}</>}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-canvas-sunk p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[13px] font-semibold text-ink/88">
            Edit this finding
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink/64">
            What the engine said is kept beside whatever you put here, and every
            change is recorded against your name.
          </p>
        </div>
        <button
          type="button"
          onClick={cancel}
          aria-label="Close the editor"
          className="shrink-0 rounded-lg p-1 text-ink/58 transition-colors hover:bg-card hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      {/* --- verdict ------------------------------------------------------ */}
      <Field
        label="Verdict"
        corrected={live.verdict !== current.engine.verdict}
        onRestore={() => set({ verdict: readVerdict(current.engine.verdict) })}
        restoreLabel={
          VERDICT_META[current.engine.verdict as Verdict]?.label ??
          current.engine.verdict
        }
      >
        {/* Not "Absent", for the reason the override buttons have always left
            it out: a clause the design is silent on is not reported here at all
            — the reverse question, the parts of the design no clause governs,
            is the coverage section — so a finding corrected to it would simply
            vanish from the report with no way back to it. */}
        <div className="flex flex-wrap gap-1.5">
          {VERDICTS.filter((verdict) => verdict !== "absent").map((verdict) => (
            <Chip
              key={verdict}
              pressed={live.verdict === verdict}
              engine={verdict === current.engine.verdict}
              disabled={pending}
              tone={TONE[VERDICT_META[verdict].tone]}
              title={VERDICT_META[verdict].blurb}
              onClick={() => set({ verdict })}
            >
              {VERDICT_META[verdict].label}
            </Chip>
          ))}
        </div>
      </Field>

      {/* --- obligation --------------------------------------------------- */}
      <Field
        label="How strongly the clause binds"
        corrected={live.obligation !== current.engine.obligation}
        onRestore={() => set({ obligation: current.engine.obligation })}
        restoreLabel={OBLIGATION_META[current.engine.obligation].label || "Unstated"}
        hint={
          finding.obligationSource === "parsed"
            ? "The standard's own recorded structure established this."
            : finding.obligationSource === "unstated"
              ? "The standard never said. Severity cannot rise above Check until somebody does."
              : `Established by ${finding.obligationSource === "read" ? "a modal verb in the clause's wording" : "the model's reading of the clause"} — the weaker kind of answer.`
        }
      >
        <div className="flex flex-wrap gap-1.5">
          {OBLIGATIONS.map((obligation) => (
            <Chip
              key={obligation}
              pressed={live.obligation === obligation}
              engine={obligation === current.engine.obligation}
              disabled={pending}
              tone="border-line bg-card text-ink/72"
              title={OBLIGATION_META[obligation].blurb}
              onClick={() => set({ obligation })}
            >
              {OBLIGATION_META[obligation].label || "Unstated"}
            </Chip>
          ))}
        </div>
      </Field>

      {/* --- severity ----------------------------------------------------- */}
      {/*
          Its own control, rather than something a reviewer reaches by arguing
          the obligation. The obligation is a claim about what the *standard*
          says; severity is how much this particular breach matters, and making
          one carry the other meant somebody raising a priority had to misstate
          the standard to do it.

          What it cannot do is change the verdict, and the line below says so
          because a reviewer needs to know it before they press. A contradiction
          graded Moderate is still a contradiction everywhere it is counted.
      */}
      {preview.engine.severity === null && preview.severity === null ? (
        <div className="mb-3 rounded-lg border border-line bg-card px-3 py-2 text-[11.5px] text-ink/64">
          <span className="text-ink/82">
            {VERDICT_META[live.verdict].label} carries no severity.
          </span>{" "}
          There is nothing to act on, so there is nothing to grade — and a row
          reading “{VERDICT_META[live.verdict].label} · Critical” would read as a
          problem when it is the opposite.
        </div>
      ) : (
        <Field
          label="Severity"
          corrected={live.severity !== null}
          onRestore={() => set({ severity: null })}
          restoreLabel="the derived grade"
          hint="Priority only. It does not change the verdict — a contradiction graded Moderate is still a contradiction in the register, the counts and the export."
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {SEVERITIES.map((severity) => (
              <Chip
                key={severity}
                pressed={preview.severity === severity}
                // The grade the verdict and obligation come to on their own, so
                // a reviewer can always see what they are departing from.
                engine={severity === derivedSeverity}
                disabled={pending}
                tone="border-line bg-card text-ink/72"
                title={SEVERITY_META[severity].blurb}
                onClick={() => set({ severity })}
              >
                {SEVERITY_META[severity].label}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      {/* The payoff, and the reason the controls above sit together: a reviewer
          changing any of them watches the consequence rather than discovering
          it on the register afterwards. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-card px-3 py-2 text-[11.5px] text-ink/64">
        <span>Reports as</span>
        {preview.severity ? (
          <SeverityTag severity={preview.severity} />
        ) : (
          <span className="text-ink/58">None — nothing to act on</span>
        )}
        {preview.brief && (
          <span className="text-ink/58">
            · {BRIEF_SEVERITY_LABEL[preview.brief.tier]} on the four-tier scale
            {!preview.brief.settled && " (unsettled)"}
          </span>
        )}
        {current.severity !== preview.severity && (
          <span className="rounded bg-warn-tint px-1.5 py-0.5 text-warn">
            was {current.severity ?? "none"}
          </span>
        )}
        {/* The verdict is stated beside the grade precisely because this panel
            can change both, and only one of them is what the register files the
            finding under. */}
        <span className="text-ink/58">
          · still filed as {VERDICT_META[live.verdict].label}
        </span>
      </div>

      {/* --- rationale ---------------------------------------------------- */}
      <Field
        label="Rationale"
        corrected={live.rationale.trim() !== current.engine.rationale.trim()}
        onRestore={() => set({ rationale: current.engine.rationale })}
        restoreLabel="the engine's wording"
        hint="This is the paragraph that reaches the report and the export."
      >
        <textarea
          value={live.rationale}
          onChange={(event) => set({ rationale: event.target.value })}
          rows={5}
          disabled={pending}
          className="w-full resize-y rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] leading-relaxed text-ink/88 placeholder:text-ink/58 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid disabled:opacity-60"
        />
      </Field>

      {/* --- note --------------------------------------------------------- */}
      <Field label="Reviewer note" hint="Shown on the finding, beside the verdict.">
        <textarea
          value={live.note}
          onChange={(event) => set({ note: event.target.value })}
          rows={2}
          disabled={pending}
          placeholder="e.g. KMS-managed keys in eu-west-1 satisfy this clause."
          className="w-full resize-y rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] text-ink/88 placeholder:text-ink/58 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid disabled:opacity-60"
        />
      </Field>

      {/* --- why ---------------------------------------------------------- */}
      {/* Recorded against every field this save moves. Not required: an
          unexplained correction is still a fact an audit wants, and refusing to
          store it would only mean the change happened with no record at all. */}
      <Field label="Why this change?" hint="Optional. Recorded in the history below.">
        <input
          value={live.reason}
          onChange={(event) => set({ reason: event.target.value })}
          disabled={pending}
          placeholder="e.g. §4.2 is explicit that this is mandatory; the engine read it as prose."
          className="w-full rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] text-ink/88 placeholder:text-ink/58 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid disabled:opacity-60"
        />
      </Field>

      {problem && (
        <p className="mb-2.5 rounded-lg border border-danger-line bg-danger-tint px-2.5 py-2 text-[11.5px] text-danger">
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-full bg-royal px-3.5 py-1.5 text-[11.5px] font-medium text-white transition-colors hover:bg-royal-mid disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={cancel}
          className="text-[11.5px] text-ink/62 hover:text-ink/78"
        >
          cancel
        </button>
        {/* Changing the verdict is what moves a finding out of "pending", and a
            reviewer should know that before they press rather than find the
            register re-sorted afterwards. */}
        {live.verdict !== current.verdict && (
          <span className="text-[11.5px] text-ink/58">
            {live.verdict === current.engine.verdict
              ? "This records the finding as confirmed."
              : "This records the finding as overridden."}
          </span>
        )}
      </div>

      {finding.history.length > 0 && <History_ events={finding.history} />}
    </div>
  );
}

/** One labelled control, with the engine's answer one press away. */
function Field({
  label,
  hint,
  corrected = false,
  onRestore,
  restoreLabel,
  children,
}: {
  label: string;
  hint?: string;
  corrected?: boolean;
  onRestore?: () => void;
  restoreLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-[11.5px] text-ink/64">{label}</span>
        {corrected && onRestore && (
          <button
            type="button"
            onClick={onRestore}
            className="inline-flex items-center gap-1 text-[11.5px] text-ink/58 underline decoration-ink/25 underline-offset-2 transition-colors hover:text-ink/82"
          >
            <RotateCcw size={10} aria-hidden="true" />
            back to {restoreLabel}
          </button>
        )}
      </div>
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-relaxed text-ink/58">{hint}</p>}
    </div>
  );
}

function Chip({
  pressed,
  engine,
  disabled,
  tone,
  title,
  onClick,
  children,
}: {
  pressed: boolean;
  /** The engine's own answer, marked so a reviewer can always see what they
   *  are departing from. */
  engine: boolean;
  disabled: boolean;
  tone: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11.5px] transition-[opacity,box-shadow] hover:opacity-80 disabled:opacity-50",
        tone,
        pressed && "ring-2 ring-line-strong",
      )}
    >
      {children}
      {engine && (
        <span className="ml-1.5 opacity-60" title="What the engine said">
          ·
        </span>
      )}
    </button>
  );
}

/**
 * What has been done to this finding, newest first.
 *
 * Underscored because `History` is the lucide icon imported above, and the two
 * live in the same file.
 */
function History_({ events }: { events: EditEvent[] }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11.5px] text-ink/64">
        <History size={11} aria-hidden="true" />
        History
      </p>
      <ol className="space-y-2.5">
        {events.map((event) => (
          <li key={event.batch} className="text-[11.5px] leading-relaxed">
            <p className="text-ink/62">
              <span className="text-ink/82">{event.byName}</span>
              {" · "}
              {new Date(event.at).toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            <ul className="mt-0.5 space-y-0.5">
              {event.changes.map((change, index) => (
                <li key={`${change.field}-${index}`} className="text-ink/72">
                  <span className="text-ink/58">
                    {EDIT_FIELD_LABEL[change.field] ?? change.field}:
                  </span>{" "}
                  <Value field={change.field} value={change.before} />
                  {" → "}
                  <Value field={change.field} value={change.after} />
                </li>
              ))}
            </ul>
            {event.reason && <p className="mt-0.5 text-ink/68">“{event.reason}”</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * One side of a change, in the words the rest of the product uses.
 *
 * Stored values are the machine vocabulary — "not_assessable", "should" — and a
 * history that printed those would be a different language from the screen the
 * reviewer just read. A paragraph of rationale is clamped rather than printed
 * whole: the history is a record that it changed and who said so, not a diff
 * viewer.
 */
function Value({
  field,
  value,
}: {
  field: EditableField | "state";
  value: string | null;
}) {
  if (!value) return <span className="text-ink/48">nothing</span>;

  if (field === "verdict") {
    const meta = VERDICT_META[value as Verdict];
    return <span className="text-ink/88">{meta?.label ?? value}</span>;
  }
  if (field === "obligation") {
    const meta = OBLIGATION_META[value as Obligation];
    return <span className="text-ink/88">{meta?.label || "Unstated"}</span>;
  }
  if (field === "severity") {
    const meta = SEVERITY_META[value as Severity];
    return <span className="text-ink/88">{meta?.label ?? value}</span>;
  }
  if (field === "state") return <span className="text-ink/88">{value}</span>;

  return (
    <span className="text-ink/88" title={value}>
      “{value.length > 60 ? `${value.slice(0, 60)}…` : value}”
    </span>
  );
}
