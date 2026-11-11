"""An "absent" is only overturned by a search that settles the clause.

In whole-document mode an "absent" is checked a second time by searching the
same document, because a reader working through a long design can miss a
passage. That check took any citing verdict, including "partial" — and
"partial" over eight retrieved chunks, with no surrounding document to place
them in, is the cheap answer. Every absent in one real run was lost that way:
EA-007, EA-015 and INF-006, the last for a design naming no Databricks,
SageMaker or Bedrock anywhere.

It had been quiet only because the search's own verdict used to be demoted
before it arrived, so this was one bug surfacing in a second place.

What this proves:

  · a search that decides the clause still unseats an absent — "covered",
    "contradicts", or "not_applicable", which settles it just as firmly by
    showing the clause does not govern this design;
  · one that only hedges does not;
  · and neither does a decisive verdict citing nothing.

(An earlier version of this file also covered an arrow-glyph substitution in
`whole_document.build`. That change was reverted: it made the text the judge
read disagree with the text its quotes were checked against on four other
paths — `coverage`, `advice`, `lifecycle` and `request_intake` all render the
raw document and verify against the built one — so every gap quoting a line
with an arrow in it was silently dropped. The tests went with it.)

No database, no model, no network.

    python tests/test_absent_crosscheck.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.stages.analyse import DECISIVE_VERDICTS, _overrides_absent  # noqa: E402

passed = 0
failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name}", extra)


CITED = [{"chunkId": "c1", "excerpt": "Databricks is the lakehouse standard."}]

print("\nWhat unseats a whole-document 'absent'")
ok("a cited contradiction does", _overrides_absent("contradicts", CITED))
ok("a cited coverage does", _overrides_absent("covered", CITED))
ok("a cited not_applicable does", _overrides_absent("not_applicable", CITED))

print("\nWhat does not")
ok("a hedge", not _overrides_absent("partial", CITED))
ok("not_assessable, which is also a hedge", not _overrides_absent("not_assessable", CITED))
ok("a decisive verdict citing nothing", not _overrides_absent("contradicts", []))
ok("another absent", not _overrides_absent("absent", CITED))
ok("needs_review", not _overrides_absent("needs_review", CITED))

print("\nThe rule is stated once, not twice")
# If someone narrows DECISIVE_VERDICTS, this function must follow it rather
# than keep its own copy of the list.
for verdict in DECISIVE_VERDICTS:
    ok(f"{verdict} is accepted, per DECISIVE_VERDICTS", _overrides_absent(verdict, CITED))
ok(
    "and nothing outside it is",
    not any(
        _overrides_absent(v, CITED)
        for v in ("partial", "absent", "needs_review", "not_assessable")
        if v not in DECISIVE_VERDICTS
    ),
)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
