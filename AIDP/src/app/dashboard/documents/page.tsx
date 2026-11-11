import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  FileStack,
  FolderOpen,
  Lock,
  Scale,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { listDocuments, STATUS_LABEL, isTerminal } from "@/lib/ingest/documents";
import { requireWorkspace } from "@/lib/access/gate";
import { PipelineBadge } from "./PipelineStatus";
import { PipelineWatcher } from "./PipelineWatcher";
import { ReadyTick, UploadZone } from "./UploadZone";
import { RemoveStandard } from "./RemoveStandard";
import { StartingLibrary } from "./StartingLibrary";
import { libraryStanding } from "@/lib/ingest/standards-library";
import { REGISTERS } from "@/lib/standards-library";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";

export const dynamic = "force-dynamic";

type Doc = Awaited<ReturnType<typeof listDocuments>>[number];

export default async function DocumentsPage() {
  // `requireWorkspace` rather than a session lookup, and rather than the
  // throwing `requireAccess`: a page renders concurrently with its layout, so
  // two thrown refusals race each other. This one redirects instead, so the
  // outcome is the same every time.
  const { user, organisation, isOwner } = await requireWorkspace();
  const documents = await listDocuments(user.id, organisation.id);

  const references = documents.filter((d) => d.role !== "assessed");
  const assessed = documents.filter((d) => d.role === "assessed");
  const inFlight = documents.some((d) => !isTerminal(d.status));

  // Counted off the list the page already has, so the band and the shelf under
  // it cannot disagree about how much is in the library.
  const clauses = references.reduce((sum, d) => sum + d.clauses, 0);
  const ready = references.filter((d) => d.status === "ready").length;
  const toReview = references.reduce((sum, d) => sum + d.issues.high, 0);

  // Which of the product's own registers this organisation holds, so the panel
  // below can offer the rest. Only read for an administrator, because nobody
  // else may act on it and a member would be shown an offer that would be
  // refused.
  const standing = isOwner ? await libraryStanding(organisation.id) : [];
  const offers = standing.map((held) => ({
    key: held.key,
    title: held.title,
    standards: REGISTERS.find((r) => r.key === held.key)?.rows.length ?? 0,
    held: held.documentId !== null,
  }));

  return (
    <>
      <PipelineWatcher active={inFlight} />

      <PageHeader
        eyebrow={organisation.name}
        title="Reference Library"
        lede="The clauses every assessment measures against. Designs live in projects, and each one is checked against everything here."
      />

      {/* Above the figures rather than below them: when the library is empty
          the band is four zeros, and the thing to read first is how to stop it
          being empty. Once there is something on the shelf this collapses to a
          single line — by then the customer has chosen, and the only job left
          is a way back to a register they removed. */}
      {/* `references` also holds technology stacks, which state what is
          approved rather than what is required and are never assessed against.
          An organisation whose only document is a stack still has nothing to
          measure a design by, so the full panel is right for them. */}
      {isOwner && (
        <StartingLibrary
          offers={offers}
          compact={references.some((d) => d.role === "reference")}
        />
      )}

      {/* The library's own figures, in the band the client's prototype opens
          every administrative screen with. The clause count is the one that
          matters: a shelf of twelve documents that yielded no clauses measures
          nothing, and until this was on the page that only showed up when an
          assessment came back empty. */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<BookMarked size={15} strokeWidth={1.9} />}
          label="Standards"
          value={String(references.length)}
          hint={
            references.length === 0
              ? "Nothing to measure against yet"
              : `${ready} read and indexed`
          }
        />
        <StatCard
          icon={<Scale size={15} strokeWidth={1.9} />}
          label="Clauses"
          value={String(clauses)}
          hint={clauses === 0 ? "None extracted yet" : "Checked on every assessment"}
        />
        <StatCard
          icon={<FileStack size={15} strokeWidth={1.9} />}
          label="Designs assessed"
          value={String(assessed.length)}
          hint={assessed.length === 0 ? "None yet" : "Across your projects"}
        />
        <StatCard
          icon={<AlertTriangle size={15} strokeWidth={1.9} />}
          label="To review"
          value={String(toReview)}
          hint={toReview === 0 ? "Nothing outstanding" : "Standards needing a look"}
        />
      </div>

      <Group
        icon={<BookMarked size={15} strokeWidth={1.9} />}
        title="Reference standards"
        blurb="What every assessment measures against."
        documents={references}
        uploadLabel="Add reference standards"
        role="reference"
        empty="No standards yet. These define what good looks like."
        // Only an administrator curates the standards. The upload endpoint
        // refuses a member regardless — this just stops offering a control that
        // would be refused, which reads as a rule rather than a fault.
        canUpload={isOwner}
        lockedNote="Only an administrator can add standards. Ask yours if something is missing."
      />

      {/* Designs used to sit beside the standards here. They moved into
          projects, so this points at them rather than showing a second,
          ungrouped copy of the same list. */}
      <Link
        href="/dashboard"
        className="group card-sheen mt-4 flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-card p-5 shadow-card transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-card-hover"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-royal-mid/30 bg-royal/10 text-royal">
          <FolderOpen size={16} strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink/92">Designs live in projects</p>
          <p className="mt-0.5 text-[12.5px] text-ink/64">
            {assessed.length === 0
              ? "Open a project and submit the designs that belong to it."
              : `${assessed.length} design${assessed.length === 1 ? "" : "s"} across your projects.`}
          </p>
        </div>
        <ArrowRight
          size={15}
          className="text-ink/40 transition-transform duration-300 group-hover:translate-x-0.5"
        />
      </Link>

    </>
  );
}

function Group({
  icon,
  title,
  blurb,
  documents,
  uploadLabel,
  role,
  empty,
  canUpload,
  lockedNote,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  documents: Doc[];
  uploadLabel: string;
  role: "reference" | "assessed";
  empty: string;
  canUpload: boolean;
  lockedNote?: string;
}) {
  const chunks = documents.reduce((n, d) => n + d._count.chunks, 0);
  const review = documents.reduce((n, d) => n + d.issues.high, 0);

  // Same light logic as the drop target below: the yardstick is lit from
  // above, the thing being measured from below. Held to a fraction of the
  // aperture's intensity — the panel is the room, not the event in it.
  const wash =
    role === "reference"
      ? "radial-gradient(90% 60% at 50% 0%, rgba(0,92,146,0.10), transparent 70%)"
      : "radial-gradient(90% 60% at 50% 100%, rgba(0,92,146,0.09), transparent 70%)";

  return (
    <section className="ring-gradient relative overflow-hidden rounded-2xl bg-card p-4 sm:p-5">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: wash }}
      />
      <header className="relative mb-3.5 flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-card text-ink/68">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15.5px] font-semibold tracking-[-0.01em] text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink/64">{blurb}</p>
        </div>
        {documents.length > 0 && (
          <span className="shrink-0 text-right text-[11.5px] leading-tight text-ink/62">
            <span className="text-ink/78">{documents.length}</span> doc
            {documents.length === 1 ? "" : "s"}
            <br />
            {chunks} chunks
          </span>
        )}
      </header>

      {documents.length === 0 ? (
        <p className="relative mb-3 rounded-lg border border-line bg-card px-3.5 py-5 text-center text-[12.5px] text-ink/62">
          {empty}
        </p>
      ) : (
        <ul className="relative mb-3 space-y-1.5">
          {documents.map((doc) => (
            <li key={doc.id}>
              <Row doc={doc} removable={role === "reference" && canUpload} />
            </li>
          ))}
        </ul>
      )}

      {review > 0 && (
        <p className="relative mb-3 inline-flex items-center gap-1.5 text-[12px] text-warn">
          <AlertTriangle size={12} />
          {review} document{review === 1 ? "" : "s"} to review
        </p>
      )}

      <div className="relative">
        {canUpload ? (
          <UploadZone role={role} label={uploadLabel} />
        ) : (
          <p className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3.5 py-4 text-center text-[12px] text-ink/62">
            <Lock size={12} aria-hidden="true" />
            {lockedNote}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * One document in the library.
 *
 * A div wrapping a link rather than one link, when the row carries a remove
 * control: a button cannot sit inside an anchor, and the whole row being
 * clickable is worth less than being able to take a stale standard out from
 * here. The link still covers everything a reader would aim at.
 */
function Row({ doc, removable = false }: { doc: Doc; removable?: boolean }) {
  const meta = [
    doc.pageCount != null ? `${doc.pageCount}pp` : null,
    doc._count.chunks > 0 ? `${doc._count.chunks} chunks` : null,
    // What this standard contributes to every assessment. Shown beside the
    // remove control, because it is what removing it takes away.
    doc.clauses > 0 ? `${doc.clauses} clause${doc.clauses === 1 ? "" : "s"}` : null,
    doc.sensitivity,
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-line bg-card pr-2",
        "transition-[border-color,background-color] duration-200",
        "focus-within:border-line-strong",
      )}
    >
      <Link
        href={`/dashboard/documents/${doc.id}`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-royal-mid",
        )}
      >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink/92">
          {doc.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11.5px] text-ink/62">
          {meta.map((m) => (
            <span key={m as string}>{m}</span>
          ))}
          {doc.issues.high > 0 && (
            <span className="inline-flex items-center gap-1 text-warn">
              <AlertTriangle size={10} />
              {doc.issues.high}
            </span>
          )}
        </span>
      </span>

      <Status doc={doc} />

      <ArrowRight
        size={14}
        className="shrink-0 text-ink/38 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-ink/68"
      />
      </Link>

      {removable && (
        <RemoveStandard documentId={doc.id} title={doc.title} clauses={doc.clauses} />
      )}
    </div>
  );
}

/**
 * Progress while there is progress, and nothing once there isn't.
 *
 * The rail used to render for every document regardless of state, so a shelf of
 * finished documents each carried a bar that would never move again — pure
 * noise, and it read as though something were still happening. The detail of
 * what is happening is one click away, on the document's own page.
 */
function Status({ doc }: { doc: Doc }) {
  if (doc.status === "failed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-warn-line bg-warn-tint px-2 py-0.5 text-[11px] text-warn">
        <AlertTriangle size={10} />
        Failed
      </span>
    );
  }

  if (doc.status === "ready") return <ReadyTick />;

  if (!doc.pipeline) {
    return (
      <span className="shrink-0 text-[11.5px] whitespace-nowrap text-ink/68">
        {STATUS_LABEL[doc.status] ?? doc.status}
      </span>
    );
  }

  return (
    <span className="flex max-w-[55%] min-w-0 justify-end">
      <PipelineBadge view={doc.pipeline} />
    </span>
  );
}
