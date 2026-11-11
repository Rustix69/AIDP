"""Which way a run reads the design, and who decides.

Search shows the judge the eight passages it ranked closest to each clause. Its
dominant failure is the clause whose answer was on page 23 and did not make that
window: the report says "not addressed" about something the design plainly
addresses, which is the fastest way there is to lose a reviewer's trust.
Reading the document whole cannot make that mistake and checks every quote word
for word against the page.

Whether a design *can* be read whole is a question about its token count, and
nobody pressing "assess" knows that. So the default stopped being an answer and
became "auto": the worker decides, and says in the run's note what it did.

What this holds in place:

  · "auto" on a single design that fits is read whole;
  · "auto" on a design too long, or one processed before its pages were stored,
    falls back to search and says so — a fallback, not a refusal, because
    nothing was promised;
  · "auto" on a project of several designs searches, silently, because that is
    the right answer and not a downgrade: several designs concatenated would
    put three "page 4"s in front of a judge whose every quote is checked by
    page;
  · an explicit "retrieval" is still honoured. A reviewer who asked for search
    gets search, and the engine does not overrule them;
  · an explicit "document" that cannot be served still explains itself in the
    older, apologetic wording, because that request *was* made and was not met;
  · whatever happens, the mode returned is the mode actually used — a run must
    never claim a method that did not produce its verdicts.

No database and no model: `db.connection` and `whole_document.load` are stubbed.

    docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse \\
      -e DATABASE_URL=postgresql://nobody@127.0.0.1:1/none \\
      --entrypoint python aidp-worker-test tests/test_assessment_mode.py
"""

from __future__ import annotations

import contextlib
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp import designs, whole_document  # noqa: E402
from aidp.config import get_config  # noqa: E402
from aidp.stages import analyse  # noqa: E402

passed = 0
failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}", extra)


class _Whole:
    """Stands in for a loaded document of a given size."""

    def __init__(self, tokens: int) -> None:
        self._tokens = tokens
        self.text = "x" * tokens

    @property
    def tokens(self) -> int:
        return self._tokens


@contextlib.contextmanager
def _no_connection():
    yield None


def resolve(mode: str, *, designs_in: int = 1, tokens: int | None = 1000):
    """`_resolve_mode` with the database and the loader stubbed out."""
    scope = designs.Scope(
        designs=[designs.Design(f"doc{i}", f"Design {i}") for i in range(designs_in)],
        unready=[],
    )
    loaded = None if tokens is None else _Whole(tokens)

    original_connection = analyse.db.connection
    original_load = analyse.whole_document.load
    analyse.db.connection = _no_connection
    analyse.whole_document.load = lambda *a, **k: loaded
    try:
        return analyse._resolve_mode({"mode": mode}, scope)
    finally:
        analyse.db.connection = original_connection
        analyse.whole_document.load = original_load


limit = get_config().whole_document_max_tokens


# ---------------------------------------------------------------------------
print("\nauto reads one design whole when it fits")

mode, note, whole = resolve(analyse.AUTO, tokens=1000)
ok("the mode is document", mode == "document", mode)
ok("the document is loaded for the judge", whole is not None)
ok("and nothing needs explaining", note is None, note)


# ---------------------------------------------------------------------------
print("\nauto falls back without apologising for a promise it never made")

mode, note, whole = resolve(analyse.AUTO, tokens=limit + 1)
ok("a design past the budget is searched", mode == "retrieval", mode)
ok("the document is not handed to the judge", whole is None)
ok("the note says which method was used", bool(note) and "search" in (note or "").lower(), note)
ok("and says why, in tokens", bool(note) and "tokens" in (note or ""), note)
ok(
    "without implying a request was refused",
    bool(note) and "not by reading the whole document" not in (note or ""),
    note,
)

mode, note, whole = resolve(analyse.AUTO, tokens=None)
ok("a design with no stored pages is searched", mode == "retrieval", mode)
ok("and told it can be reprocessed to be read whole", "reprocess" in (note or "").lower(), note)


# ---------------------------------------------------------------------------
print("\nauto on a project searches, and that is not a downgrade")

mode, note, whole = resolve(analyse.AUTO, designs_in=3)
ok("several designs are searched", mode == "retrieval", mode)
ok("the document is not loaded", whole is None)
ok(
    "and no note is raised, because nothing was given up",
    note is None,
    note,
)


# ---------------------------------------------------------------------------
print("\nan explicit choice is still the reviewer's")

mode, note, whole = resolve("retrieval", tokens=1000)
ok("asking for search gets search, even on a design that would fit", mode == "retrieval", mode)
ok("the engine does not overrule it with a note", note is None, note)
ok("and does not load the document anyway", whole is None)

mode, note, whole = resolve("document", tokens=1000)
ok("asking to read the whole document does that", mode == "document", mode)

mode, note, whole = resolve("document", tokens=limit + 1)
ok("asking for a read that cannot be served falls back", mode == "retrieval", mode)
ok(
    "and says so as an unmet request, not a choice",
    "not by reading the whole document" in (note or ""),
    note,
)

mode, note, whole = resolve("document", designs_in=2)
ok("asking to read a whole project explains why it cannot", bool(note), note)
ok(
    "naming the page-number problem rather than the budget",
    "page number" in (note or "").lower(),
    note,
)


# ---------------------------------------------------------------------------
print("\nthe mode returned is always one that can actually be used")

for case, kwargs in (
    ("auto, fits", {"mode": analyse.AUTO, "tokens": 1000}),
    ("auto, too long", {"mode": analyse.AUTO, "tokens": limit + 1}),
    ("auto, no pages", {"mode": analyse.AUTO, "tokens": None}),
    ("auto, project", {"mode": analyse.AUTO, "designs_in": 2}),
    ("explicit retrieval", {"mode": "retrieval", "tokens": 1000}),
    ("explicit document", {"mode": "document", "tokens": 1000}),
    ("unset", {"mode": "", "tokens": 1000}),
):
    kwargs = dict(kwargs)
    mode, _, whole = resolve(kwargs.pop("mode"), **kwargs)
    ok(f"{case}: never reports 'auto' as the method used", mode in analyse.MODES, mode)
    ok(
        f"{case}: a document mode always has a document to read",
        (mode == "document") == (whole is not None),
        (mode, whole is not None),
    )


print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
