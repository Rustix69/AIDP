import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { getDocument, STATUS_LABEL } from "@/lib/ingest/documents";
import { NotAMember } from "@/lib/ingest/org";
import { ParsedContent } from "../ParsedContent";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Parsed content",
  description: "What the pipeline read out of a document: its structure, tables, figures and notes.",
};

/**
 * What the pipeline made of a submitted design, on a page of its own.
 *
 * All of this used to sit under the report, where it pushed the findings down a
 * screen and answered a question nobody had asked yet. It is the evidence
 * *behind* the report rather than part of it: which sections were found, where
 * they were cut, what came out as a table or a figure, and what the parse itself
 * flagged. A reviewer wants it when a finding looks wrong, and never otherwise —
 * so the report links to it, in its own tab, and stays about the assessment.
 *
 * A reference standard is the other way round: there is no report to keep this
 * out of, the parse is the standard, and so it is shown on the standard's own
 * page. This address is kept working for anyone who bookmarked it, and sends
 * them there.
 *
 * The same access check as the report. A document in someone else's
 * organisation is indistinguishable from one that does not exist.
 */
export default async function ParsedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const { id } = await params;

  let document;
  try {
    document = await getDocument(session.user.id, id);
  } catch (error) {
    if (error instanceof NotAMember) notFound();
    throw error;
  }
  if (!document) notFound();

  // A standard carries its parse on its own page now. Called outside the
  // try/catch above on purpose: `redirect` works by throwing.
  if (document.role !== "assessed") redirect(`/dashboard/documents/${document.id}`);

  return (
    <>
      <Link
        href={`/dashboard/documents/${document.id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink/66 transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} />
        {document.title}
      </Link>

      <PageHeader
        title="Parsed content"
        meta={
          <span className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <span className="text-ink/72">{document.title}</span>
            <span>{STATUS_LABEL[document.status] ?? document.status}</span>
            {document.pageCount != null && <span>{document.pageCount} pages</span>}
            {document.profile && <span>{document.profile}</span>}
          </span>
        }
      />

      {/* A design, so nothing is set aside: set-aside ranges are a standard's
          rules that were judged not to be rules, and a standard never reaches
          this page. */}
      <ParsedContent document={document} setAsideView={null} mayChange />
    </>
  );
}
