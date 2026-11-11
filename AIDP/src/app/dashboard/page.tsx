import Link from "next/link";
import {
  Archive,
  ArrowRight,
  BookMarked,
  ClipboardList,
  FolderOpen,
  Gauge,
  ScanSearch,
  SlidersHorizontal,
} from "lucide-react";
import { prisma, withDbTimeout } from "@/lib/prisma";
import { requireWorkspace } from "@/lib/access/gate";
import { listProjects } from "@/lib/ingest/projects";
import { NewProject } from "./projects/NewProject";
import { ProjectRow } from "./projects/ProjectRow";
import { HeroCard } from "@/components/ui/HeroCard";
import { StatCard } from "@/components/ui/StatCard";
import { Panel, PanelRow } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { ButtonLink } from "@/components/ui/Button";

/**
 * Where somebody lands: open a piece of work, or pick one back up.
 *
 * This page used to be a directory — a band of counts and a tile per section —
 * which told people what the product contains rather than letting them do
 * anything. Everything here now is a project, because a project is the only
 * thing anyone starts from: standards are set up once by an administrator, and
 * decisions are recorded from inside a report rather than sought out.
 *
 * The client's prototype opens its workspace on three bands and this follows
 * it: a deep greeting panel carrying the one sentence that says what is
 * outstanding, a row of figures, then the work itself. The order is the point
 * — somebody arriving wants to know whether anything is waiting on *them*
 * before they read a list of everything.
 *
 * Nothing in the bands is new analysis. Every figure is counted off the same
 * project list the page already loads, so the band and the list below it
 * cannot disagree.
 *
 * Every project lives here, active first and the archive folded in below.
 * There is no second projects page: one existed, listed the same things, and
 * having two routes answer the same question only raises the question of which
 * one is missing something.
 *
 * The row is shared with the project detail route rather than reimplemented,
 * so a project reads the same wherever it appears.
 */
export default async function DashboardPage() {
  // `requireWorkspace` rather than a session lookup, and rather than the
  // throwing `requireAccess`: a page renders concurrently with its layout, so
  // two thrown refusals race each other. This one redirects instead, so the
  // outcome is the same every time.
  const { user, organisation, isOwner } = await requireWorkspace();

  // Bounded: a stalled Neon socket otherwise leaves this page suspended for
  // good, and what the person sees is loading.tsx, for ever, with no way to
  // tell a slow workspace from a broken one. See withDbTimeout.
  const [projects, standards] = await withDbTimeout(
    Promise.all([
      listProjects(organisation.id),
      prisma.document.count({
        where: { organisationId: organisation.id, role: "reference" },
      }),
    ]),
    "loading your projects",
  );

  const active = projects.filter((project) => project.status === "active");
  const archived = projects.filter((project) => project.status !== "active");
  const firstName = (user.name || "").split(" ")[0];

  const designs = projects.reduce((sum, project) => sum + project.designs, 0);
  const runs = projects.reduce((sum, project) => sum + project.runs, 0);
  const unreviewed = projects.reduce((sum, project) => sum + project.unreviewed, 0);

  // What is actually waiting on a person, worst first. A project with nothing
  // outstanding is not in this panel at all — a "waiting on you" list that
  // includes things that are not is one people stop reading.
  const waiting = [...projects]
    .filter((project) => project.unreviewed > 0)
    .sort((a, b) => b.unreviewed - a.unreviewed)
    .slice(0, 5);

  // Recency across everything, archive included: picking a piece of work back
  // up is the other reason to be on this screen, and something filed last week
  // is no less findable for having been archived since.
  const recent = [...projects]
    .filter((project) => project.lastActivityAt)
    .sort(
      (a, b) =>
        (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0),
    )
    .slice(0, 5);

  // The one piece of state a project cannot route around. With no standards
  // there is nothing to measure a design against, and a member cannot fix it
  // themselves — so they are told who can, rather than finding out when an
  // assessment comes back empty.
  const lede =
    standards === 0
      ? isOwner
        ? "Before a design can be assessed, add the standards it should be measured against in the Reference Library."
        : "No standards have been added yet. An administrator needs to add them before anything can be assessed."
      : unreviewed > 0
        ? `${unreviewed} finding${unreviewed === 1 ? "" : "s"} across ${
            waiting.length === 1 ? "one project" : `${waiting.length} projects`
          } ${unreviewed === 1 ? "is" : "are"} waiting on a reviewer.`
        : "Open a project for a piece of work, then submit its designs for assessment.";

  return (
    <>
      <HeroCard
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        blurb={lede}
        action={
          <ButtonLink href="/dashboard/requests" variant="glass" size="md">
            <ClipboardList size={15} aria-hidden="true" />
            Raise a request
          </ButtonLink>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<FolderOpen size={15} strokeWidth={1.9} />}
          label="Active projects"
          value={String(active.length)}
          hint={
            archived.length > 0
              ? `${archived.length} archived`
              : active.length === 0
                ? "Nothing open yet"
                : "Across this workspace"
          }
        />
        <StatCard
          icon={<ClipboardList size={15} strokeWidth={1.9} />}
          label="Designs submitted"
          value={String(designs)}
          hint={designs === 0 ? "None yet" : "In projects you can open"}
        />
        <StatCard
          icon={<ScanSearch size={15} strokeWidth={1.9} />}
          label="Assessments run"
          value={String(runs)}
          hint={runs === 0 ? "None yet" : "Against your standards"}
        />
        <StatCard
          icon={<Gauge size={15} strokeWidth={1.9} />}
          label="Findings to review"
          value={String(unreviewed)}
          hint={unreviewed === 0 ? "Nothing outstanding" : "Waiting on a person"}
        />
      </div>

      {(waiting.length > 0 || recent.length > 0) && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Panel
            title="Waiting on you"
            blurb="Findings the engine has raised and nobody has ruled on yet."
            flush
          >
            {waiting.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-ink/58">
                Nothing outstanding. Every finding raised so far has been reviewed.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {waiting.map((project) => (
                  <Link
                    key={project.id}
                    href={`/dashboard/projects/${project.id}/assessment`}
                    className="block transition-colors hover:bg-canvas-sunk/60"
                  >
                    <PanelRow
                      title={project.name}
                      meta={`${project.designs} design${
                        project.designs === 1 ? "" : "s"
                      } · ${project.runs} assessment${project.runs === 1 ? "" : "s"}`}
                      aside={
                        <Pill tone={project.unreviewed > 5 ? "high" : "medium"}>
                          {project.unreviewed} to review
                        </Pill>
                      }
                    />
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Recent activity"
            blurb="The last thing to happen in each piece of work."
            flush
            action={
              <Link
                href="/dashboard/decisions"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-royal hover:text-royal-mid"
              >
                Decisions
                <ArrowRight size={13} aria-hidden="true" />
              </Link>
            }
          >
            {recent.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-ink/58">
                Nothing has been submitted yet.
              </p>
            ) : (
              <div className="divide-y divide-line">
                {recent.map((project) => (
                  <Link
                    key={project.id}
                    href={`/dashboard/projects/${project.id}`}
                    className="block transition-colors hover:bg-canvas-sunk/60"
                  >
                    <PanelRow
                      title={project.name}
                      meta={`Opened by ${project.createdByName || "someone since departed"}`}
                      aside={
                        project.status === "active" ? (
                          <Pill tone="ok">Active</Pill>
                        ) : (
                          <Pill tone="neutral">Archived</Pill>
                        )
                      }
                      when={project.lastActivityAt?.toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                      })}
                    />
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">
          Projects
          <span className="ml-2 text-[13px] font-normal text-ink/58">
            {active.length === 1 ? "1 active" : `${active.length} active`}
          </span>
        </h2>
        <NewProject />
      </div>

      {active.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-card px-4 py-10 text-center text-[13.5px] text-ink/58">
          {archived.length > 0
            ? "Nothing active right now. Open a project, or reopen an archived one below."
            : "No projects yet. Open one, then submit the designs that belong to it."}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {active.map((project) => (
            <li key={project.id}>
              <ProjectRow project={project} />
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-3 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.13em] text-ink/58">
            <Archive size={12} />
            Archived
          </h2>
          <ul className="space-y-2.5">
            {archived.map((project) => (
              <li key={project.id}>
                <ProjectRow project={project} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The prototype's quick links, which are the two screens that set up
          what every assessment is measured by. They sit at the foot rather
          than the head: an administrator comes here for them occasionally,
          everybody else never. */}
      <nav className="mt-10 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
        <QuickLink
          href="/dashboard/documents"
          icon={<BookMarked size={15} strokeWidth={1.9} />}
          title="Reference Library"
          blurb={
            standards === 0
              ? "No standards yet — nothing can be assessed until there are."
              : `${standards} standard${standards === 1 ? "" : "s"} every assessment measures against.`
          }
        />
        <QuickLink
          href="/dashboard/criteria"
          icon={<SlidersHorizontal size={15} strokeWidth={1.9} />}
          title="Significance criteria"
          blurb="What makes a request significant enough to need a person."
        />
      </nav>
    </>
  );
}

function QuickLink({
  href,
  icon,
  title,
  blurb,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  blurb: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3.5 rounded-xl border border-line bg-card px-4 py-3.5 transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-card"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-royal-mid/30 bg-royal/10 text-royal">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-ink/62">{blurb}</span>
      </span>
      <ArrowRight
        size={15}
        aria-hidden="true"
        className="shrink-0 text-ink/40 transition-transform duration-300 group-hover:translate-x-0.5"
      />
    </Link>
  );
}
