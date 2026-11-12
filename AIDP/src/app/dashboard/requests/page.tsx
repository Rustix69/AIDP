import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { requireWorkspace } from "@/lib/access/gate";
import { advanceChecking, advanceSubmitted, listRequests } from "@/lib/ingest/requests";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { Cell, DataTable, Row } from "@/components/ui/DataTable";
import { NewRequest } from "./new/NewRequest";

export const dynamic = "force-dynamic";

/** Where each state sits on the one scale the whole product uses: nothing
 *  happening, something in flight, something settled, something stopped. */
const TONE: Record<string, PillTone> = {
  draft: "neutral",
  submitted: "info",
  checking: "info",
  reported: "ok",
  decided: "ok",
  failed: "warn",
};

const LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  checking: "Under review",
  reported: "Reported",
  decided: "Decided",
  failed: "Stopped",
};

/**
 * Architecture requests, newest first.
 *
 * Everyone in the workspace sees every one, for the same reason everyone sees
 * every project: an architect asked to review a submission should not have to
 * be invited to it first.
 *
 * Drafts sit in the same list rather than behind a filter. A half-filled
 * request is the most likely thing somebody is coming back to finish, and
 * hiding it would mean the list is busiest exactly when it is least useful.
 *
 * ## Why this page advances requests before it draws them
 *
 * A submitted request is carried into assessment by the embed worker, which
 * calls the app the moment a document finishes indexing (Workers/aidp/notify.py).
 * That is the fast path and it is nearly always the only one that runs.
 *
 * Nearly. A ping sent while the app is redeploying, or dropped by a network
 * that blinked, is not retried — the worker swallows it deliberately, because a
 * document that is embedded is embedded and the alternative is an embed stage
 * that dead-letters work it has already done. Without a second route in, such a
 * request waits in "submitted" for ever: its document is ready, no run was ever
 * opened, and nothing says so.
 *
 * So the list sweeps before it renders. It costs one indexed lookup on
 * `(organisationId, state)` that almost always matches nothing, and it puts the
 * repair exactly where the problem gets noticed — the person wondering where
 * their report is opens this page, and opening it is the fix.
 *
 * Writing during a render is not this codebase's first: `promoteFromEnvironment`
 * does it on every authenticated request, and for the same reason — the work is
 * idempotent, bounded, and has nowhere better to live.
 */
export default async function RequestsPage() {
  const { organisation } = await requireWorkspace();

  // Before the read, so anything it starts is reflected in what is drawn.
  // Never throws — see advanceSubmitted — because a page that cannot render
  // its list is a worse failure than a request that waits another minute.
  await advanceSubmitted({ organisationId: organisation.id });
  // And the other end of the flow: a run that finished while nobody was
  // looking. The worker does not write this column, so this is where a
  // request stops saying "checking" — see advanceChecking.
  await advanceChecking({ organisationId: organisation.id });

  const requests = await listRequests(organisation.id);

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Architecture requests"
        lede="Answer the intake questions and the platform checks the design against your standards, without waiting for anyone to upload anything."
        action={<NewRequest />}
      />

      {requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card px-6 py-12 text-center">
          <ClipboardList size={22} className="mx-auto mb-3 text-ink/30" aria-hidden="true" />
          <p className="text-[14px] text-ink/70">No requests yet.</p>
          <p className="mt-1 text-[12.5px] text-ink/50">
            The first one takes a few minutes to fill in and is reviewed automatically.
          </p>
        </div>
      ) : (
        /* A table rather than a stack of cards, which is how the client's
           prototype lists anything with columns: the reference, who raised it
           and where it got to line up down the page, so a run of twenty can be
           scanned without reading each one. */
        <Panel flush>
          <DataTable head={["Reference", "Request", "Raised by", "Status"]} minWidth={640}>
            {requests.map((request) => (
              <Row key={request.id} className="transition-colors hover:bg-canvas-sunk/60">
                <Cell className="whitespace-nowrap font-mono text-[12px] tabular-nums text-ink/55">
                  {request.reference}
                </Cell>
                <Cell className="max-w-[22rem]">
                  <Link
                    href={`/dashboard/requests/${request.id}`}
                    className="block truncate font-medium text-ink hover:text-royal"
                  >
                    {request.title || "Untitled request"}
                  </Link>
                </Cell>
                {/* No project here. Every request opens one for itself and it
                    is never shown — naming it would invite somebody to go
                    looking for a thing they cannot manage. */}
                <Cell className="whitespace-nowrap text-ink/62">{request.requestedByName}</Cell>
                <Cell>
                  <Pill tone={TONE[request.state] ?? "neutral"}>
                    {LABEL[request.state] ?? request.state}
                  </Pill>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>
      )}
    </>
  );
}
