import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import type { getDocument } from "@/lib/ingest/documents";
import { isTerminal } from "@/lib/ingest/documents";
import type { SetAsideView } from "@/lib/ingest/rules";
import { Figures, type FigureView } from "./Figures";
import { SetAside } from "./SetAside";
import { SectionRow } from "./SectionRow";

type DocumentView = NonNullable<Awaited<ReturnType<typeof getDocument>>>;

/**
 * What the pipeline made of a document: its notes, its figures, its outline.
 *
 * This was a page of its own, reached by a link from the document. For a
 * reference standard that was one click too many — the parse *is* the standard
 * as far as this system is concerned, so a reader opening a standard was being
 * shown a summary and a button, and the thing they came for was behind the
 * button. A standard's page now carries this directly; the separate page
 * remains for a submitted design, where the parse is evidence behind a report
 * rather than the point of the screen.
 */
export function ParsedContent({
  document,
  setAsideView,
  mayChange,
}: {
  document: DocumentView;
  setAsideView: SetAsideView | null;
  mayChange: boolean;
}) {
  const clauses = document.sections.reduce((n, s) => n + s.clauses.length, 0);
  const tables = document.sections.reduce((n, s) => n + s.tables.length, 0);
  const figureViews: FigureView[] = document.sections
    .flatMap((s) =>
      s.figures.map((f) => ({
        id: f.id,
        page: f.page,
        caption: f.caption,
        description: f.description,
        correctedDescription: f.correctedDescription,
        reviewState: f.reviewState,
        complexity: f.complexity,
        headingPath: s.headingPath,
      })),
    )
    // In the document's own order, page by page, as a reader turning through it
    // would meet them. Within a page the order they were read in holds: the sort
    // is stable, and sections and their figures arrive in reading order.
    .sort((a, b) => a.page - b.page);
  const high = document.issues.filter((i) => i.severity === "high");
  const other = document.issues.filter((i) => i.severity !== "high");

  return (
    <>
      {!isTerminal(document.status) && (
        <p className="mb-6 rounded-xl border border-line bg-card px-4 py-3 text-[13px] text-ink/70">
          This document is still being read, so what follows is as far as the pipeline has got.
        </p>
      )}

      <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sections" value={document.sections.length} />
        <Stat label="Clauses" value={clauses} />
        <Stat label="Tables" value={tables} />
        <Stat label="Chunks" value={document._count.chunks} />
      </dl>

      {/*
        Issues come before content on purpose. An empty section or a table that
        extracted at low confidence is the single most useful thing this page
        can tell a reviewer, and burying it under an outline is how a document
        with a hole in it gets treated as complete.
      */}
      {document.issues.length > 0 && (
        <section className="mb-9">
          <h2 className="mb-3 font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
            Review
          </h2>
          <ul className="space-y-2">
            {[...high, ...other].map((issue) => (
              <li
                key={issue.id}
                className={cn(
                  "flex gap-3 rounded-xl border px-4 py-3",
                  issue.severity === "high"
                    ? "border-warn-line bg-warn-tint"
                    : "border-line bg-card",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 shrink-0",
                    issue.severity === "high" ? "text-warn" : "text-ink/62",
                  )}
                >
                  {issue.severity === "high" ? <AlertTriangle size={15} /> : <Info size={15} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] leading-relaxed text-ink/84">
                    {issue.detail}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-ink/62">
                    {issue.kind.replace(/_/g, " ")}
                    {issue.page != null && ` · page ${issue.page}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* After the review notes, which point into it, and before the outline:
          a rule wrongly set aside is invisible everywhere else. */}
      {setAsideView && <SetAside view={setAsideView} editable={mayChange} />}

      <Figures figures={figureViews} />

      <section>
        <h2 className="mb-1 font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
          Structure
        </h2>
        {/* The counts were the whole of this list, and a count cannot tell a
            good parse from a bad one. Say that a row opens: a drop target is
            discoverable by people who already know, and by nobody else. */}
        <p className="mb-3 text-[12.5px] text-ink/64">
          Open a section to see exactly what was taken out of it — the lines as they were
          read off the page, the clauses, and the tables.
        </p>

        {document.sections.length === 0 ? (
          <p className="rounded-xl border border-line bg-card px-5 py-8 text-center text-[13.5px] text-ink/64">
            {isTerminal(document.status)
              ? "No sections were detected in this document."
              : "Still reading the document…"}
          </p>
        ) : (
          /*
            A tree, not a stack of cards. Thirty sections rendered as identical
            full-width bars gives no sense of depth and no way to skim — the
            hierarchy is the most useful thing this outline carries, so it is
            drawn: parents sit at the margin with weight, children hang off a
            rule, and only the counts that exist are shown.
          */
          <ol className="border-t border-line">
            {document.sections.map((section) => (
              <SectionRow
                key={section.id}
                documentId={document.id}
                section={{
                  id: section.id,
                  depth: section.depth,
                  numberText: section.numberText,
                  title: section.title,
                  pageStart: section.pageStart,
                  isEmpty: section.isEmpty,
                  clauses: section.clauses.length,
                  tables: section.tables.length,
                  figures: section.figures.length,
                }}
              />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <dt className="text-[11.5px] uppercase tracking-[0.1em] text-ink/62">{label}</dt>
      <dd className="mt-1 font-display text-[22px] font-semibold tracking-[-0.02em] text-ink">
        {value}
      </dd>
    </div>
  );
}
