"""One clause failing must not cost the other ninety-nine.

A hundred-clause framework came back reporting a single clause. There was no
limit anywhere — no `clauses[:1]`, no `break` in the grading loop, no `take` in
the query or the UI. The loop was simply not guarded: `_assess_one` raising on
one clause propagated out of `handle`, the job layer retried and dead-lettered
it, and the run kept whatever clauses had already been committed. Each clause is
its own transaction, so clause 1 survived and clauses 2 to 100 were never
attempted. A model returning JSON that does not parse is enough to cause it, and
the symptom — one finding out of a hundred — reads exactly like a test limit
somebody forgot to take out.

What this holds in place:

  - the loop reaches every clause, however many fail on the way
  - a clause that cannot be judged is written as `needs_review`, never skipped
    silently and never left to read as a pass
  - quota exhaustion still aborts, because every clause after it would fail the
    same way and the run is worth retrying once the credit is back
  - the whole-document path is guarded identically to the search path

    docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse \\
      -e DATABASE_URL=postgresql://nobody@127.0.0.1:1/none \\
      --entrypoint python aidp-worker-test tests/test_clause_loop_resilience.py
"""

from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp import designs  # noqa: E402
from aidp.stages import analyse  # noqa: E402

passed = failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


CLAUSES = [
    {
        "id": f"cl-{n}",
        "title": f"Clause {n}",
        "statement": f"Requirement {n} must hold.",
        "rationale": "",
        "requirements": [],
        "guidance": "",
        "sourceRefs": [],
        "headingPath": f"Standards > {n}",
        "numberText": f"{n}.0",
        "pageStart": n,
        "documentTitle": "Security Standards",
        "isBaseline": True,
    }
    for n in range(1, 11)
]

A = designs.Design("doc-a", "Target Architecture")
SCOPE = designs.Scope([A], [])
RUN = {
    "id": "run-1",
    "organisationId": "org-1",
    "documentId": "doc-a",
    "projectId": None,
    "frameworkId": "fw-1",
    "mode": "retrieval",
}


# ---------------------------------------------------------------------------
print("\n1. The loop is guarded at all")

src = analyse.handle.__doc__ or ""
loop_src = __import__("inspect").getsource(analyse.handle)
# Matched with a pattern rather than a literal: the call takes enough arguments
# to be wrapped across lines, and a test that fails when a formatter moves a
# bracket is a test that gets edited until it passes. The property is the same —
# each path is *called*, not merely named.
_CALLS_DOCUMENT = re.compile(r"_assess_document_one\(\s*run,\s*clause")
_CALLS_SEARCH = re.compile(r"(?<!_document_one\()\b_assess_one\(\s*run,\s*clause")

ok(
    "the per-clause call sits inside a try",
    "try:" in loop_src and bool(_CALLS_SEARCH.search(loop_src)),
)
ok(
    "a broad except keeps the loop going",
    "except Exception" in loop_src and "continuing" in loop_src,
)
ok(
    "quota exhaustion is re-raised rather than swallowed",
    "except llm.QuotaExhausted" in loop_src and "raise" in loop_src,
)
ok(
    "a failed clause is written, not skipped",
    'verdict="needs_review"' in loop_src,
)
ok(
    "and the run says how many it could not judge",
    "clauses that could not be judged" in loop_src,
)
# Both reading methods go through one function, which is what the pool runs, so
# neither can acquire a guard the other lacks. `judge_task` raising — by either
# route — surfaces at `future.result()` inside the try below.
task_src = loop_src[loop_src.index("def judge_task(") : loop_src.index("progress.step(step_label")]
ok(
    "the whole-document path is guarded exactly as the search path is",
    bool(_CALLS_DOCUMENT.search(task_src)) and bool(_CALLS_SEARCH.search(task_src)),
)
ok(
    "and the only place either is called from is inside the try",
    loop_src.index("try:") < loop_src.index("future.result()")
    and len(_CALLS_DOCUMENT.findall(loop_src)) == 1
    and len(_CALLS_SEARCH.findall(loop_src)) == 1,
)

# The guard must be written so that QuotaExhausted is caught *before* the broad
# clause — otherwise `except Exception` swallows it and the run grinds through
# a hundred clauses against an exhausted key.
quota_at = loop_src.index("except llm.QuotaExhausted")
broad_at = loop_src.index("except Exception")
ok("quota is matched before the broad except", quota_at < broad_at, (quota_at, broad_at))


# ---------------------------------------------------------------------------
print("\n2. No artificial limit anywhere in the clause path")

import inspect  # noqa: E402

for name, fn in (
    ("handle", analyse.handle),
    ("_framework_clauses", analyse._framework_clauses),
):
    body = inspect.getsource(fn)
    ok(f"{name}: no clause slicing", "clauses[:1]" not in body and "clauses[0]" not in body)
    ok(f"{name}: no LIMIT in the clause query", " LIMIT 1" not in body.upper())

frame_src = inspect.getsource(analyse._framework_clauses)
ok("the clause query is not capped", "LIMIT" not in frame_src.upper(), frame_src[-200:])
ok(
    "every pending design-clause unit is submitted, not a fixed index",
    "for clause, design_id in pending" in loop_src and "pending[" not in loop_src,
)
ok(
    "and every submitted unit is waited on",
    "futures.as_completed(running)" in loop_src,
)

# ---------------------------------------------------------------------------
print("\n3. Judging clauses at once does not weaken any of the above")

# The loop runs several clauses concurrently. Three things have to stay true of
# it that a sequential loop got for free.
ok(
    "the fan-out is bounded rather than one thread per clause",
    "max_workers=workers" in loop_src and "assess_concurrency" in loop_src,
)
# A pool thread does not inherit ContextVars. The credential this job's model
# calls are made with is one, so without an explicit copy every clause would
# look for an API key that was not there.
ok(
    "each task carries the job's bound context onto its thread",
    "contextvars.copy_context().run" in loop_src,
)
# Quota exhaustion stops the run rather than being written as a hundred
# verdicts. Cancelling is not enough on its own: the raise has to happen after
# the pool has shut down, or findings would still be landing for a spent key.
ok(
    "quota exhaustion cancels the rest and still re-raises",
    "other.cancel()" in loop_src
    and loop_src.index("quota = exc") < loop_src.index("raise quota"),
)
ok(
    "a stopped run is abandoned only once the pool is shut down",
    loop_src.index("with futures.ThreadPoolExecutor") < loop_src.index("if stopped:"),
)


print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
