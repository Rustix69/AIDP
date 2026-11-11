"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, ListChecks, Loader2, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  CLAUSE_STATUS_META,
  type ClauseStatus,
} from "@/lib/ingest/standards-vocabulary";
import { setClauseStatusAction } from "../actions";

/**
 * A reference standard as the list of rules it is, with the one control that
 * decides whether each of them is still required.
 *
 * ## Why this is not part of the parse view
 *
 * `ParsedContent` answers "did the pipeline read this document correctly": it
 * shows sections, the source lines behind them, the tables and figures, and
 * what it set aside, with the clauses nested inside expandable rows as the
 * evidence for a section. That is the right shape for checking a parse and the
 * wrong shape for triaging a library — a hundred and seventy rules hidden one
 * section at a time cannot be read as a list, and the question here is not
 * about any one section.
 *
 * ## Why the control is direct, and not a proposal
 *
 * It used to raise a proposal in the decision register, which an administrator
 * then approved and published. That was wrong about direction: the decision
 * register is how a new standard is promoted **into** the library, and a
 * standard already in the library must never travel back the other way. One
 * way in, and this screen is the far end of it.
 *
 * So the change happens here and at once — and because it changes what every
 * future assessment measures, it is an administrator's to make, it asks for a
 * reason, and `ClauseStatusChange` keeps every move. The record is what
 * replaces the gate, not nothing.
 *
 * A member sees the status and the reason it was last changed, and no control.
 * That is a narrowing from what came before, where anybody could raise a
 * proposal — the knowledge that a payments clause does not apply still belongs
 * to whoever is reading it, and they now have to tell an administrator rather
 * than record it here. Worth knowing as a cost of the rule above.
 */

export type LibraryClause = {
  id: string;
  ref: string;
  title: string;
  statement: string;
  category: string;
  status: ClauseStatus;
  lastChange: { at: string | Date; by: string; reason: string } | null;
};

type Filter = "all" | "active" | "suspended";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
];

export function ClauseLibrary({
  clauses,
  canEdit,
}: {
  clauses: LibraryClause[];
  /** Whether this reader may change a clause's status. The server action is
   *  the real control; this only withholds one that would be refused. */
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    let active = 0;
    let suspended = 0;
    for (const clause of clauses) {
      if (clause.status === "suspended") suspended += 1;
      else active += 1;
    }
    return { active, suspended };
  }, [clauses]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clauses.filter((clause) => {
      if (filter === "active" && clause.status !== "active") return false;
      if (filter === "suspended" && clause.status !== "suspended") return false;
      if (!needle) return true;
      return (
        clause.ref.toLowerCase().includes(needle) ||
        clause.title.toLowerCase().includes(needle) ||
        clause.category.toLowerCase().includes(needle) ||
        clause.statement.toLowerCase().includes(needle)
      );
    });
  }, [clauses, filter, query]);

  // Grouped by the register's own category, in the order the clauses already
  // sit in. A flat list of a hundred and seventy rows is a wall; the category
  // is how the spreadsheet they came from is organised, so it is how the
  // person who wrote them expects to find them.
  const groups = useMemo(() => {
    const out = new Map<string, LibraryClause[]>();
    for (const clause of shown) {
      const key = clause.category || "Uncategorised";
      const list = out.get(key);
      if (list) list.push(clause);
      else out.set(key, [clause]);
    }
    return [...out];
  }, [shown]);

  if (clauses.length === 0) return null;

  return (
    <section className="mb-9">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-[-0.01em] text-ink/88">
          <ListChecks size={15} className="text-royal" />
          The rules in this standard
          <span className="text-[12px] font-normal text-ink/62">{clauses.length}</span>
        </h2>
        <p className="text-[12px] text-ink/62">
          {counts.suspended > 0
            ? `${counts.active} assessed against, ${counts.suspended} suspended`
            : "Every rule here is assessed against."}
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
                filter === option.key
                  ? "border-royal bg-royal text-white"
                  : "border-line bg-card text-ink/68 hover:text-ink/88",
              )}
            >
              {option.label}
              {option.key === "suspended" && counts.suspended > 0
                ? ` (${counts.suspended})`
                : ""}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a rule"
          className="ml-auto w-full max-w-56 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink/88 placeholder:text-ink/58 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid"
        />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-line bg-canvas-sunk px-4 py-3 text-[12.5px] text-ink/62">
          No rule here matches that.
        </p>
      ) : (
        <div className="space-y-5">
          {groups.map(([category, rows]) => (
            <div key={category}>
              <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink/54">
                {category}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-ink/45">
                  {rows.length}
                </span>
              </p>
              <ul className="space-y-1.5">
                {rows.map((clause) => (
                  <ClauseRow key={clause.id} clause={clause} canEdit={canEdit} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ClauseRow({ clause, canEdit }: { clause: LibraryClause; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");

  const suspended = clause.status === "suspended";
  const next: ClauseStatus = suspended ? "active" : "suspended";

  const change = () =>
    startTransition(async () => {
      const result = await setClauseStatusAction(clause.id, next, reason);
      setMessage(result.message);
      if (result.ok) {
        setAsking(false);
        setReason("");
        router.refresh();
      }
    });

  return (
    <li
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5",
        suspended ? "border-line opacity-70" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-[11.5px] text-royal">{clause.ref}</span>
            <span
              className={cn(
                "font-display text-[13px] font-semibold",
                suspended ? "text-ink/58 line-through decoration-ink/30" : "text-ink/88",
              )}
            >
              {clause.title || "Untitled rule"}
            </span>
          </p>
          {clause.statement && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink/68">{clause.statement}</p>
          )}
          {/* Who set it aside and why. A suspended rule with no reason beside
              it is the thing somebody re-litigates in six months because
              nobody can remember the argument. */}
          {suspended && clause.lastChange && (
            <p className="mt-1.5 text-[11px] text-ink/58">
              Suspended by {clause.lastChange.by || "an administrator"}
              {clause.lastChange.reason ? ` — ${clause.lastChange.reason}` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px]",
              suspended
                ? "border-line bg-canvas-sunk text-ink/62"
                : "border-ok-line bg-ok-tint text-ok",
            )}
            title={CLAUSE_STATUS_META[clause.status].blurb}
          >
            {CLAUSE_STATUS_META[clause.status].label}
          </span>

          {canEdit && !asking && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking(true)}
              title={
                suspended
                  ? "Require this rule again"
                  : "Stop requiring this rule"
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-ink/68 transition-colors hover:text-ink/88 disabled:opacity-50"
            >
              {suspended ? <Undo2 size={11} /> : <Ban size={11} />}
              {suspended ? "Make active" : "Suspend"}
            </button>
          )}
        </div>
      </div>

      {/* The reason is asked for before the change, not after it. The server
          requires one — an unexplained withdrawal of a rule the whole
          organisation is judged against is the one thing an auditor asks
          about — so collecting it here is what keeps the refusal from being
          the way somebody finds out. */}
      {canEdit && asking && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas-sunk px-2.5 py-2">
          <label className="sr-only" htmlFor={`reason-${clause.id}`}>
            Why {suspended ? "this rule is required again" : "this rule is no longer required"}
          </label>
          <input
            id={`reason-${clause.id}`}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              suspended
                ? "Why is it required again?"
                : "Why is it no longer required?"
            }
            className="min-w-48 flex-1 rounded-md border border-line bg-card px-2 py-1 text-[12px] text-ink/88 placeholder:text-ink/52 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-royal-mid"
          />
          <button
            type="button"
            disabled={pending || !reason.trim()}
            onClick={change}
            className="inline-flex items-center gap-1.5 rounded-md bg-royal px-2.5 py-1 text-[11.5px] font-medium text-white transition-colors hover:bg-royal-mid disabled:opacity-50"
          >
            {pending && <Loader2 size={11} className="animate-spin" />}
            {suspended ? "Make active" : "Suspend"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setAsking(false);
              setReason("");
            }}
            className="text-[11.5px] text-ink/62 hover:text-ink/82 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}

      {message && <p className="mt-1.5 text-[11px] text-ink/72">{message}</p>}
    </li>
  );
}
