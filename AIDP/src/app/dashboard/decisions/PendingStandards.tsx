"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Scale, Send, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DRAFT_STATE_META,
  PUBLISH_MODES,
  PUBLISH_MODE_META,
  mayPublishSeparately,
  type DraftState,
  type PublishMode,
  // The register row a proposal would become. From the vocabulary, never from
  // standards.ts: that module reaches Prisma, which reaches `node:module`, and
  // importing it from a client component fails the build with a chunking error
  // that names this file rather than the import that caused it.
  hasEntry,
  type DraftEntry,
} from "@/lib/ingest/standards-vocabulary";
import {
  applyStandard,
  approveStandard,
  discardStandard,
  unapproveStandard,
} from "../documents/actions";

/**
 * Standards proposed out of findings, and the two gates they pass through.
 *
 * Where this comes from: a reviewer working an assessment meets a clause the
 * design broke — or could not be judged against — because the clause itself is
 * too vague to enforce. "Ensure resilience" against a design that drops failed
 * messages is a breach *and* a rule that never said what resilience required,
 * so the next submission argues it again. They press "Send to decision" on the
 * finding, a model drafts the requirement lines, and the proposal arrives here.
 *
 * It arrives *here* rather than staying on the report for a reason worth
 * stating: the person who proposes a standard and the person who may change the
 * library are usually not the same person, and the second one is not reading
 * that report. They are looking at a list of what is waiting on them.
 *
 * ## Two gates, and why they are two
 *
 * **Approve** says the wording is right. **Publish** puts it into the standard,
 * supersedes the live clause, and changes what every assessment from now on is
 * measured against. One button doing both means the irreversible half happens
 * as a side effect of agreeing with a sentence — and it leaves no way for one
 * person to sign off the words while another decides the library is ready to
 * carry them.
 *
 * So Publish is disabled until somebody has approved, and each step records its
 * own name and time on the row.
 *
 * ## What is editable, and by whom
 *
 * The lines, here, by the approver. What a person publishes is what binds, and
 * a model's wording that is nearly right is faster to fix than to refuse and
 * ask for again. The reviewer who proposed it does not get that edit — they
 * supplied the case, not the rule.
 */

export type PendingStandard = {
  id: string;
  state: DraftState;
  clauseRef: string;
  clauseTitle: string;
  /** The model's one line on what the earlier wording left unsaid. */
  note: string;
  error: string | null;
  requirements: string[];
  /** What the clause requires today, to read the proposal against. */
  existing: string[];
  setAside: { text: string; reason: string }[];
  decisionsInTheWay: { id: string; title: string; effect: string }[];
  requestedByName: string;
  approvedByName: string;
  publishedByName: string;
  /** The verdict and design this was written from — the case, carried with it. */
  sourceVerdict: string;
  sourceDesignTitle: string | null;
  /** How it was published, once it has been. Empty until then. */
  publishMode: string;
  /** The clause's current statement, which a separate rule starts from. */
  clauseStatement: string;
  /**
   * The register row this proposal would become, drafted and checked by the
   * worker: reference, category, owner, status, title, statement, rationale.
   *
   * Six of this organisation's standards are spreadsheets, and a proposal shown
   * as three loose sentences could not be read against the rows it would sit
   * beside. Every field may be empty — a clause from a prose standard has no
   * register row, and a column the checks refused is dropped rather than shown.
   */
  entry: DraftEntry;
  createdAt: string;
};

const TONE: Record<"pending" | "good" | "bad" | "neutral", string> = {
  pending: "border-warn-line bg-warn-tint text-warn",
  good: "border-ok-line bg-ok-tint text-ok",
  bad: "border-danger-line bg-danger-tint text-danger",
  neutral: "border-line bg-canvas-sunk text-ink/68",
};

const VERDICT_WORD: Record<string, string> = {
  partial: "a partial",
  contradicts: "a contradiction",
};

export function PendingStandards({
  standards,
  mayCurate,
}: {
  standards: PendingStandard[];
  /** Whether this person may change the standards. See canManageStandards. */
  mayCurate: boolean;
}) {
  if (standards.length === 0) return null;

  const waiting = standards.filter(
    (item) => item.state === "ready" || item.state === "approved",
  ).length;

  return (
    <section className="mb-9">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-[-0.01em] text-ink/88">
          <Scale size={15} className="text-royal" />
          Proposed standards
          {waiting > 0 && (
            <span className="rounded-full border border-warn-line bg-warn-tint px-2 py-0.5 text-[11.5px] font-normal text-warn">
              {waiting} waiting
            </span>
          )}
        </h2>
        <p className="text-[12px] text-ink/62">
          Raised from findings and from the library. Approved first, published second.
        </p>
      </div>

      <ul className="space-y-3">
        {standards.map((item) => (
          <Row key={item.id} item={item} mayCurate={mayCurate} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The proposal as the row it would become in the register.
 *
 * Why this is worth the space: the standards this organisation runs on are
 * spreadsheets, and every rule in them is a row — a reference, a category, an
 * owner, a status, a title, a statement, a rationale, then whatever it requires.
 * A proposal shown as a note and two bullet points cannot be read against them.
 * The approver's question is not "is this sentence true" but "does this belong
 * in that book", and that question needs the row.
 *
 * `mode` changes what is shown, because the two publish routes produce
 * genuinely different rows. Sharpening keeps the reference, the title and the
 * statement of the rule it came from and only the requirements grow; a separate
 * rule carries a reference derived beside it and words of its own. Showing one
 * layout for both would mean the preview lies about one of them.
 */
function EntryPreview({
  item,
  mode,
  lines,
  title,
  statement,
  rationale,
}: {
  item: PendingStandard;
  mode: PublishMode;
  lines: string[];
  title: string;
  statement: string;
  rationale: string;
}) {
  const separate = mode === "separate";
  const { entry } = item;

  // Nothing was drafted and nothing was carried over — an older proposal, from
  // before the row existed. Showing a frame of empty columns would read as a
  // rule that states nothing rather than as a proposal that predates this.
  if (!hasEntry(entry)) return null;

  const reference = separate
    ? entry.identifier || "to be assigned"
    : item.clauseRef || "unnumbered";
  const shownTitle = separate ? title : item.clauseTitle;
  const shownStatement = separate ? statement : item.clauseStatement;
  const shownRationale = separate ? rationale : "";
  const kept = lines.filter((line) => line.trim().length > 0);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-line bg-canvas-sunk">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-2">
        <span className="font-mono text-[11.5px] font-medium text-royal">{reference}</span>
        {entry.category && (
          <span className="text-[11px] text-ink/62">{entry.category}</span>
        )}
        <span className="ml-auto rounded border border-warn-line bg-warn-tint px-1.5 py-px text-[10.5px] text-warn">
          {separate ? entry.status || "proposed" : "new version"}
        </span>
      </div>

      <dl className="divide-y divide-line">
        {shownTitle && <Field label="Title">{shownTitle}</Field>}
        {shownStatement && <Field label="Statement">{shownStatement}</Field>}
        {shownRationale && <Field label="Rationale">{shownRationale}</Field>}
        {entry.owner && <Field label="Owner">{entry.owner}</Field>}
        <Field label={`Requirements (${kept.length})`}>
          {kept.length === 0 ? (
            <span className="text-ink/58">none</span>
          ) : (
            <ul className="space-y-1">
              {kept.map((line, index) => (
                <li key={index} className="flex gap-1.5">
                  <span className="text-ok">+</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </dl>

      {/* Said on the preview rather than only beside the buttons: this is the
          row a reader is about to agree to, and "it keeps DAT-004's reference"
          is a fact about the row, not about the act of pressing publish. */}
      <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink/58">
        {separate
          ? `Filed beside ${entry.parentIdentifier || item.clauseRef}, which stays exactly as it is.`
          : `Replaces ${item.clauseRef || "the clause"}, keeping its reference. The earlier wording stays on the record.`}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-x-3 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-ink/55">{label}</dt>
      <dd className="text-[12.5px] leading-relaxed text-ink/85">{children}</dd>
    </div>
  );
}

/**
 * One proposal: new wording for a clause, and the two gates it passes.
 *
 * There was briefly a second shape here — a proposal that a clause be accepted
 * into the library or rejected from it — and a dispatcher above choosing
 * between them. It is gone: a standard already in the library never comes back
 * to this register, and whether a clause is still required is set on the
 * standard's own page. This register is only ever about wording now.
 */
function Row({ item, mayCurate }: { item: PendingStandard; mayCurate: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<string[]>(item.requirements);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Which of the two outcomes publishing will produce.
   *
   * Only a contradiction gets the choice. A partial means the clause could not
   * be judged as written, so there is one sensible answer — the clause gets
   * sharper — and offering a second vague clause beside it would make the
   * library worse, not better.
   *
   * Defaults to sharpening, which is what every proposal did before the choice
   * existed. A default that quietly added rules to the library would be the
   * wrong way round.
   */
  const choosable = mayPublishSeparately(item.sourceVerdict);
  const [mode, setMode] = useState<PublishMode>("sharpen");
  /**
   * A new rule needs its own words; it is not a version of the old one.
   *
   * Seeded from the drafted register row, and only from the clause where the
   * worker wrote nothing. Seeding from the clause alone was the thing that made
   * this feel unfinished: the statement arrived as a verbatim copy of the rule
   * it was meant to stand beside, which is the one sentence it must not be —
   * two live rows saying the same thing is a register nobody can read, and it
   * is what makes a later assessment judge one subject twice and disagree with
   * itself.
   */
  const [title, setTitle] = useState(item.entry.title || item.clauseTitle);
  const [statement, setStatement] = useState(item.entry.statement || item.clauseStatement);
  const [rationale, setRationale] = useState(item.entry.rationale);

  const separate = choosable && mode === "separate";
  const blocked = separate && !statement.trim();

  const keep = lines.filter((line) => line.trim().length > 0);
  const meta = DRAFT_STATE_META[item.state];
  const open = item.state === "ready" || item.state === "approved";

  const publish = () =>
    run(() =>
      applyStandard(
        item.id,
        keep,
        separate ? { mode: "separate", title, statement, rationale } : { mode: "sharpen" },
      ),
    );

  const run = (action: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.message);
      if (result.ok) router.refresh();
    });

  return (
    <li className="rounded-xl border border-line bg-card px-4 py-3.5 shadow-card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-[11.5px] text-ink/62">
            {item.clauseRef || "unnumbered clause"}
          </span>
          <span className="font-display text-[13.5px] font-semibold text-ink/88">
            {item.clauseTitle}
          </span>
        </p>
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-[11.5px]",
            TONE[meta.tone],
          )}
          title={meta.blurb}
        >
          {meta.label}
        </span>
      </div>

      {/* The case, carried with the proposal. An approver reading this screen
          has not seen the report it came from, and three sentences with nothing
          behind them are three sentences nobody can judge. */}
      <p className="mb-2.5 text-[11.5px] text-ink/62">
        Drafted from {VERDICT_WORD[item.sourceVerdict] ?? "a finding"}
        {item.sourceDesignTitle ? ` on ${item.sourceDesignTitle}` : ""}
        {item.requestedByName ? `, sent by ${item.requestedByName}` : ""}
        {" · "}
        {/* Pinned, not the viewer's locale — see formatDate in
            DecisionRegister for why a client component cannot use `undefined`
            here. */}
        {new Date(item.createdAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>

      {item.state === "drafting" && (
        <p className="flex items-center gap-2 text-[12.5px] text-ink/68">
          <Loader2 size={12} className="animate-spin text-ink/45" />
          A model is writing the requirement lines. This takes a few seconds.
        </p>
      )}

      {item.state === "failed" && (
        <p className="rounded-lg border border-warn-line bg-warn-tint px-2.5 py-2 text-[12.5px] text-warn">
          The requirement lines could not be worked out. {item.error}
        </p>
      )}

      {open && (
        <>
          {item.note && (
            <p className="mb-2.5 text-[12.5px] leading-relaxed text-ink/78">{item.note}</p>
          )}

          {/* Read the proposal against what the clause already says: the
              commonest reason to refuse a line is that something above already
              requires it. */}
          {item.existing.length > 0 && (
            <div className="mb-2.5">
              <p className="mb-1 text-[11.5px] text-ink/62">It already requires:</p>
              <ul className="space-y-0.5">
                {item.existing.map((line, index) => (
                  <li key={index} className="text-[12px] leading-relaxed text-ink/62">
                    · {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lines.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[11.5px] text-ink/62">
                {mayCurate
                  ? `Would add${lines.length === 1 ? " this" : " these"}, editing the wording if you want to:`
                  : `Would add${lines.length === 1 ? " this" : " these"}:`}
              </p>
              {lines.map((line, index) =>
                mayCurate ? (
                  <textarea
                    key={index}
                    value={line}
                    disabled={pending}
                    onChange={(event) =>
                      setLines((current) =>
                        current.map((old, at) => (at === index ? event.target.value : old)),
                      )
                    }
                    rows={2}
                    className="w-full resize-y rounded-lg border border-line bg-canvas-sunk px-2.5 py-2 text-[12.5px] leading-relaxed text-ink/88 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid disabled:opacity-60"
                  />
                ) : (
                  <p
                    key={index}
                    className="rounded-lg border border-line bg-canvas-sunk px-2.5 py-2 text-[12.5px] leading-relaxed text-ink/88"
                  >
                    {line}
                  </p>
                ),
              )}
            </div>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-ink/72">
              Nothing to add — this clause is already specific enough to judge against. The
              verdict was about the design, not the wording.
            </p>
          )}

          {/* The row itself, under the lines that go into it. Below rather
              than above: the approver reads what is being added first, then
              what it adds up to. */}
          <EntryPreview
            item={item}
            mode={separate ? "separate" : "sharpen"}
            lines={lines}
            title={title}
            statement={statement}
            rationale={rationale}
          />

          {/* The worker matches standing decisions on the clause reference, so
              a ruling made against the vaguer wording carries straight over and
              could excuse the very line being added. */}
          {item.decisionsInTheWay.length > 0 && (
            <p className="mt-2.5 rounded-lg border border-warn-line bg-warn-tint px-2.5 py-2 text-[12px] leading-relaxed text-warn">
              {item.decisionsInTheWay.length === 1
                ? "One standing decision on this clause accepts an arrangement that satisfies it"
                : `${item.decisionsInTheWay.length} standing decisions on this clause accept arrangements that satisfy it`}
              , and they carry over to the sharper wording — so they may excuse the line
              you are about to add:{" "}
              {item.decisionsInTheWay.map((decision) => decision.title).join("; ")}.
            </p>
          )}

          {item.setAside.length > 0 && (
            <details className="mt-2.5">
              <summary className="cursor-pointer text-[11.5px] text-ink/58 hover:text-ink/72">
                {item.setAside.length} line{item.setAside.length === 1 ? "" : "s"} refused by
                the checks
              </summary>
              <ul className="mt-1.5 space-y-1.5">
                {item.setAside.map((line, index) => (
                  <li key={index} className="text-[12px] leading-relaxed text-ink/62">
                    “{line.text}” — {line.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {item.state === "applied" && (
        <p className="text-[12.5px] leading-relaxed text-ink/72">
          {item.publishMode === "separate"
            ? "Published as a rule of its own"
            : "Added to the standard"}
          {item.publishedByName ? ` by ${item.publishedByName}` : ""}.{" "}
          {item.publishMode === "separate"
            ? "The rule it was drafted from was left as it is."
            : "The earlier wording stays on the record as a superseded version."}
        </p>
      )}

      {item.approvedByName && item.state !== "applied" && (
        <p className="mt-2 text-[11.5px] text-ink/62">
          Approved by {item.approvedByName}.
        </p>
      )}

      {/* The choice, and only where it is a real one. Shown once the wording is
          agreed, because it is a question about what to do with the words
          rather than about whether they are right. */}
      {mayCurate && choosable && item.state === "approved" && (
        <div className="mt-3 rounded-lg border border-line bg-canvas-sunk p-3">
          <p className="mb-2 text-[11.5px] text-ink/64">
            This came from a contradiction, so it can go in either way:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PUBLISH_MODES.map((option) => (
              <button
                key={option}
                type="button"
                disabled={pending}
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors disabled:opacity-50",
                  mode === option
                    ? "border-royal-mid/50 bg-royal/10 text-royal"
                    : "border-line bg-card text-ink/68 hover:border-line-strong hover:text-ink",
                )}
              >
                {PUBLISH_MODE_META[option].label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink/64">
            {PUBLISH_MODE_META[mode].after}
          </p>

          {/* A new rule has to say what it requires.
              These arrive drafted — the worker writes the row's prose along
              with the requirement lines, so the approver edits rather than
              starts cold — but they stay editable and what is published is
              what is in these boxes. The model is still not allowed near the
              *existing* clause's statement: these words belong to a new row
              standing beside it, never to the one it came from. Two live rows
              sharing one sentence is a register nobody can read, and it is the
              shape that makes a later assessment judge one subject twice and
              disagree with itself. */}
          {separate && (
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] text-ink/64">
                  Title for the new rule
                </span>
                <input
                  value={title}
                  disabled={pending}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink/88 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] text-ink/64">
                  What it states — required, in the words the standard would use
                </span>
                <textarea
                  value={statement}
                  disabled={pending}
                  onChange={(event) => setStatement(event.target.value)}
                  rows={3}
                  placeholder="e.g. Applications must not connect directly to another application's database."
                  className="w-full resize-y rounded-lg border border-line bg-card px-2.5 py-2 text-[12.5px] leading-relaxed text-ink/88 placeholder:text-ink/58 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] text-ink/64">
                  Why it exists — the consequence it prevents
                </span>
                <textarea
                  value={rationale}
                  disabled={pending}
                  onChange={(event) => setRationale(event.target.value)}
                  rows={2}
                  placeholder="e.g. A consumer reading the raw layer is coupled to a schema nobody agreed to keep stable."
                  className="w-full resize-y rounded-lg border border-line bg-card px-2.5 py-2 text-[12.5px] leading-relaxed text-ink/88 placeholder:text-ink/58 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid disabled:opacity-60"
                />
              </label>
              {blocked && (
                <p className="text-[11.5px] text-warn">
                  A separate rule needs a statement. Without one the library gains a clause
                  that says nothing and every design comes back unjudgeable against it.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {mayCurate && (open || item.state === "failed") && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.state === "ready" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => approveStandard(item.id))}
              className="inline-flex items-center gap-1.5 rounded-full border border-ok-line bg-ok-tint px-3 py-1.5 text-[11.5px] text-ok transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              <Check size={12} />
              Approve
            </button>
          )}

          {/* Disabled rather than hidden while it is pending: a reader has to
              see that publishing is the next step and what unlocks it. */}
          <button
            type="button"
            disabled={pending || item.state !== "approved" || keep.length === 0 || blocked}
            onClick={publish}
            title={
              item.state === "approved"
                ? "Add this to the organisation's reference standard"
                : "Approve it first — publishing changes what every assessment is measured against"
            }
            className="inline-flex items-center gap-1.5 rounded-full bg-royal px-3.5 py-1.5 text-[11.5px] font-medium text-white transition-colors hover:bg-royal-mid disabled:opacity-40"
          >
            <Upload size={12} />
            Publish to standards
          </button>

          {item.state === "approved" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => unapproveStandard(item.id))}
              className="inline-flex items-center gap-1.5 text-[11.5px] text-ink/62 underline decoration-ink/25 underline-offset-2 hover:text-ink/82 disabled:opacity-50"
            >
              <Send size={11} />
              send back for review
            </button>
          )}

          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => discardStandard(item.id))}
            className="text-[11.5px] text-ink/62 hover:text-ink/82 disabled:opacity-50"
          >
            discard
          </button>

          {/* Said before the press, not after: a reader deciding whether to
              publish needs to know what happens to the clause they already
              have. */}
          {item.state === "approved" && (
            <span className="text-[11px] text-ink/54">
              {separate
                ? "The original rule is left exactly as it is."
                : "Published as a new version. The earlier wording stays on the record."}
            </span>
          )}
        </div>
      )}

      {!mayCurate && open && (
        <p className="mt-3 text-[11.5px] text-ink/58">
          An administrator approves and publishes proposed standards.
        </p>
      )}

      {message && <p className="mt-2 text-[11.5px] text-ink/72">{message}</p>}
    </li>
  );
}
