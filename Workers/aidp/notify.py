"""Telling the app that something has landed.

Two moments, and the same arrangement for both.

**A document has finished indexing.** The pipeline stops at embed.
`queue.NEXT_STAGE["embed"]` is None and nothing creates an analyse job on its
own, because deciding to assess is not the worker's decision to make: it needs
the framework version, which of a project's designs are ready, and how many
findings that comes to — all of which live in the app, in TypeScript, and none
of which this process has.

**An assessment has finished.** The analyse stage writes `assessment_run.state`
and stops there. It does not touch `architecture_request`, and must not: this
process only ever SELECTs that table, and a worker that could move a submission
through the workflow would be the engine advancing the governance it is
supposed to be judged by. So it says which run landed, and the app reads the
run row it already trusts and decides what that means.

Before this existed the app found out a run had finished when somebody opened a
page — the screens sweep for themselves before they render. That is fine for a
stepper that catches up when you look at it, and no use at all for a
notification: "your report is ready" has to be sent at the moment nobody is
looking, which is exactly when a page render will not happen.

**Neither call may fail the job that made it.** A document that is embedded is
embedded and a run that is complete is complete; whether the app heard about it
is a separate question, and the app sweeps for missed ones when anybody looks.
So every error here is logged and swallowed — the alternative is a stage that
retries, and eventually dead-letters, work it has already finished.

The same arrangement as credentials.py and storage.py, and for the same
reasons: one shared secret, one base URL, both already configured wherever a
worker runs against a deployed app.
"""

from __future__ import annotations

import httpx

from . import logs
from .config import get_config

log = logs.get(__name__)

#: Short on purpose. These are courtesy calls at the end of a job that has
#: already done its work, and the app's own sweeps are what guarantee the
#: request moves. Waiting thirty seconds would hold a worker off the next
#: document for no gain.
#:
#: It also sets what the app may do before replying: the routes answer first
#: and send mail afterwards, in `after()`, precisely because this number is
#: smaller than a mail provider's worst case.
TIMEOUT = 5.0

DOCUMENT_PATH = "/api/internal/advance-requests"
RUN_PATH = "/api/internal/advance-runs"


def _tell(path: str, payload: dict[str, str], missed: str, **context: object) -> dict | None:
    """POST to an internal endpoint, or say in the log why nothing was sent.

    Returns the decoded body on success and None on every failure. Never raises.
    """
    cfg = get_config()
    if not cfg.app_base_url or not cfg.worker_shared_secret:
        # No way to reach it, which is the ordinary local arrangement — the
        # same condition storage.py reads as "use the local backend". Nothing
        # is wrong; there is simply nobody to tell.
        return None

    endpoint = cfg.app_base_url.rstrip("/") + path
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            res = client.post(
                endpoint,
                json=payload,
                headers={"x-worker-secret": cfg.worker_shared_secret},
            )
            res.raise_for_status()
            body = res.json()
    except Exception as exc:  # noqa: BLE001 — see the module docstring
        # Named the way credentials.py names its address, and for the same
        # reason: "connection refused" on its own sends people to look at an app
        # that is running perfectly well somewhere the worker was not pointed.
        # The secret is never printed, only whether one was sent.
        logs.warn(
            log,
            missed,
            endpoint=endpoint,
            secret="sent" if cfg.worker_shared_secret else "missing",
            error=str(exc)[:200],
            **context,
        )
        return None

    return body if isinstance(body, dict) else None


def document_ready(document_id: str | None) -> None:
    """Tell the app a document has finished indexing, if there is an app to tell.

    Never raises.
    """
    if not document_id:
        return

    result = _tell(
        DOCUMENT_PATH,
        {"documentId": document_id},
        "could not tell the app this document is ready; its sweep will catch it",
        documentId=document_id,
    )
    if result is None:
        return

    # Only worth a line when something actually followed. A design uploaded by
    # hand answers zero to all three, which is every document that is not an
    # architecture request, and is not news.
    #
    # The key is "ready": the route returns { ready, waiting, failed } from
    # `advanceSubmitted`. It used to read "started", from an older shape of that
    # endpoint, so this branch had quietly not run since.
    if result.get("ready"):
        logs.info(
            log,
            "the app moved a request on from this document",
            documentId=document_id,
            ready=result.get("ready"),
        )


def run_complete(run_id: str | None) -> None:
    """Tell the app an assessment run has landed — complete or failed.

    Both endings go through here. The app reads the run's own state to decide
    which it was, so this carries no verdict of its own: saying "it failed"
    would be this process asserting something about a governance record, and
    the run row already says it.

    Never raises.
    """
    if not run_id:
        return

    result = _tell(
        RUN_PATH,
        {"runId": run_id},
        "could not tell the app this run has landed; its sweep will catch it",
        runId=run_id,
    )
    if result is None:
        return

    # A run started from the projects screen belongs to no request and answers
    # zero to everything, which is most runs and is not news.
    if result.get("reported") or result.get("failed"):
        logs.info(
            log,
            "the app moved a request on from this run",
            runId=run_id,
            reported=result.get("reported"),
            failed=result.get("failed"),
        )
