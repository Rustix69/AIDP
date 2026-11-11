import Link from "next/link";
import { CircleCheck, FileClock, Gavel, Radar } from "lucide-react";
import { listDecisions } from "@/lib/ingest/decisions";
import { listPendingDrafts } from "@/lib/ingest/standards";
import { requireWorkspace } from "@/lib/access/gate";
import { canManageStandards } from "@/lib/access/roles";
import { DecisionRegister } from "./DecisionRegister";
import { PendingStandards, type PendingStandard } from "./PendingStandards";
import { PipelineWatcher } from "../documents/PipelineWatcher";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Decisions" };

export default async function DecisionsPage() {
  // `requireWorkspace` rather than a session lookup, and rather than the
  // throwing `requireAccess`: a page renders concurrently with its layout, so
  // two thrown refusals race each other. This one redirects instead, so the
  // outcome is the same every time.
  const { user, organisation, role } = await requireWorkspace();
  const [decisions, drafts] = await Promise.all([
    listDecisions(user.id, organisation.id),
    // A short tail of published ones too, so the section shows its own outcome
    // rather than silently emptying as things are dealt with.
    listPendingDrafts(user.id, organisation.id, { includePublished: 3 }),
  ]);

  const active = decisions.filter((d) => d.status === "active");
  const unindexed = active.filter((d) => !d.hasVector).length;

  /**
   * Dates and Prisma JSON do not cross into a client component, so the view is
   * flattened here — the same reasoning as `draftView` for the report.
   */
  const standards: PendingStandard[] = drafts.map((draft) => ({
    id: draft.id,
    state: draft.state,
    clauseRef: draft.clauseRef,
    clauseTitle: draft.clauseTitle,
    note: draft.note,
    error: draft.error,
    requirements: draft.requirements,
    existing: draft.existing,
    setAside: draft.setAside,
    decisionsInTheWay: draft.decisionsInTheWay,
    requestedByName: draft.requestedByName,
    approvedByName: draft.approvedByName,
    publishedByName: draft.publishedByName,
    sourceVerdict: draft.sourceVerdict,
    sourceDesignTitle: draft.sourceDesignTitle,
    publishMode: draft.publishMode,
    clauseStatement: draft.clauseStatement,
    entry: draft.entry,
    createdAt: draft.createdAt.toISOString(),
  }));

  /**
   * A proposal arrives here *while* the model is still writing it: the finding
   * queues the job and the row shows "drafting" from the moment it is created.
   * Nothing on this page then told it the job had landed, so the spinner sat
   * there over a draft that was already `ready` in the database until somebody
   * reloaded by hand — the report has watched for exactly this since drafting
   * moved off it, and this page, which is where the approver actually waits,
   * did not.
   */
  const drafting = standards.some((item) => item.state === "drafting");

  return (
    <>
      <PipelineWatcher active={drafting} />
      <PageHeader
        eyebrow={organisation.name}
        title="Decisions"
        lede="What this organisation has already settled. Every assessment from here on is judged with these in front of it, so a question answered once is not asked again."
      />

      {/* Counted off the two lists this page already loads, so the band and
          the register under it cannot disagree. "Not yet searchable" is the
          figure worth surfacing: an unindexed decision is recorded but will
          not reach the next assessment, which is the whole point of writing
          one down. */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Gavel size={15} strokeWidth={1.9} />}
          label="Standing decisions"
          value={String(active.length)}
          hint={
            active.length === 0
              ? "Nothing settled yet"
              : "Weighed by every assessment from here"
          }
        />
        <StatCard
          icon={<FileClock size={15} strokeWidth={1.9} />}
          label="Proposed standards"
          value={String(
            // Everything still in somebody's hands. `applied` is published and
            // `discarded` was turned down — neither is a job any more, and
            // counting them here would make the figure grow as work got done.
            standards.filter(
              (draft) => draft.state !== "applied" && draft.state !== "discarded",
            ).length,
          )}
          hint={standards.length === 0 ? "None proposed" : "Raised from a finding"}
        />
        <StatCard
          icon={<Radar size={15} strokeWidth={1.9} />}
          label="Not yet searchable"
          value={String(unindexed)}
          hint={
            unindexed === 0
              ? "Every decision is indexed"
              : "Recorded, but not reaching assessments yet"
          }
        />
        <StatCard
          icon={<CircleCheck size={15} strokeWidth={1.9} />}
          label="Superseded"
          value={String(decisions.length - active.length)}
          hint={
            decisions.length === active.length
              ? "Nothing withdrawn"
              : "Kept for the record"
          }
        />
      </div>

      {/* Above the register, because this is the part with somebody waiting on
          it. A standing decision is a record; a proposed standard is a job. */}
      <PendingStandards standards={standards} mayCurate={canManageStandards(role)} />

      {decisions.length === 0 && standards.length === 0 ? (
        <div className="mb-8 rounded-2xl border border-line bg-card shadow-card px-6 py-10 text-center">
          <span className="mx-auto mb-4 grid size-11 place-items-center rounded-xl border border-line bg-card text-ink/64">
            <Gavel size={19} strokeWidth={1.9} />
          </span>
          <p className="text-[14px] text-ink/78">No decisions recorded yet.</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink/64">
            Two ways in. Review a report and tick{" "}
            <span className="text-ink/72">Remember this for future assessments</span>{" "}
            when you approve or reject a finding — or, where the clause itself was
            the problem, press{" "}
            <span className="text-ink/72">Send to decision</span> on the finding and a
            proposed standard arrives here for approval. You can also write one below.
          </p>
          <Link
            href="/dashboard/documents"
            className="mt-5 inline-flex rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-ink/72 transition-colors hover:border-line-strong hover:text-ink"
          >
            Go to the standards library
          </Link>
        </div>
      ) : null}

      <DecisionRegister decisions={decisions} unindexed={unindexed} />
    </>
  );
}
