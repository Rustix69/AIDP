"""A table quoted as a grid verifies, and nothing invented does.

The parse binds every cell to its column so a row lifted out of its table still
says which value answers what — `rules._row_text` stores

    Stakeholder: Chief Product Officer | Primary concern: Time to market

A model copying that table out writes the header once and then the bare values,
the way the table is printed:

    Chief Product Officer | Time to market

Those words are all the document's own, in order, and `verify` refused them.
Measured on the MERIDIAN ONE corpus before this change: of 95 table rows, 95
verified when quoted as stored and **0** when quoted as the grid. Fifteen of the
twenty-two refused quotes across every stored finding are table quotes, and a
refused quote is not a cosmetic loss — `_guard_document` demotes a verdict left
with no evidence, which is how a correct "covered" on INT-002 became
"needs_review" in one run and survived in the next only because the model
happened to also quote a sentence of prose.

So `build` keeps a second per-page index of the table lines with the repeated
column labels taken off, and `verify` consults it after the document's own words
and before the figure descriptions.

**The half that matters more.** Widening what verifies must not widen it to
words the document does not contain, because every guard in the engine rests on
a refusal meaning something. Two properties make that safe and are pinned below:

  * `_ungrid` only ever removes a short leading "Label: " from a pipe-separated
    cell, so the indexed text is always a subsequence of the row's own words —
    it cannot introduce a word that was never there.
  * the index is kept apart from `_normal`, exactly as `_figures` is. Appending
    a second rendering of the same words to a page would let a quote match by
    spanning the join between the two copies and claim a passage that is printed
    nowhere.

    docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse \\
      -e DATABASE_URL=postgresql://nobody@127.0.0.1:1/none \\
      --entrypoint python aidp-worker-test tests/test_table_quotes.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp import whole_document  # noqa: E402

passed = failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def line(ordinal: int, kind: str, page: int, text: str) -> dict:
    return {"ordinal": ordinal, "kind": kind, "page": page, "text": text}


DOCUMENT = whole_document.build(
    "Design",
    [
        line(1, "heading", 2, "2. Stakeholders"),
        line(2, "text", 2, "The stakeholders below set the platform's priorities."),
        line(3, "table_header", 2, "Stakeholder | Primary concern / decision interest"),
        line(
            4,
            "table_row",
            2,
            "Stakeholder: Chief Product Officer | Primary concern / decision interest: "
            "Time to market and conversion.",
        ),
        line(
            5,
            "table_row",
            2,
            "Stakeholder: Chief Technology Officer | Primary concern / decision interest: "
            "Platform resilience and technical debt.",
        ),
        line(6, "heading", 3, "3. Security"),
        line(
            7,
            "text",
            3,
            "Emergency access is through a shared SSH key and session recording "
            "is not enabled for this path.",
        ),
    ],
    [],
)

print("the grid form verifies")
ok(
    "a row quoted as the reader sees it",
    DOCUMENT.verify("Chief Product Officer | Time to market and conversion.", 2).verified,
)
ok(
    "a header followed by its rows, which is how a grid is copied out",
    DOCUMENT.verify(
        "Stakeholder | Primary concern / decision interest | Chief Product Officer | "
        "Time to market and conversion.",
        2,
    ).verified,
)
ok(
    "two consecutive rows, which are adjacent in the printed table",
    DOCUMENT.verify(
        "Chief Product Officer | Time to market and conversion. | Chief Technology Officer",
        2,
    ).verified,
)

print("\nthe stored form still verifies, and prose is untouched")
ok(
    "a row quoted exactly as the parse stored it",
    DOCUMENT.verify(
        "Stakeholder: Chief Technology Officer | Primary concern / decision interest: "
        "Platform resilience and technical debt.",
        2,
    ).verified,
)
ok(
    "ordinary prose",
    DOCUMENT.verify("session recording is not enabled for this path", 3).verified,
)

print("\na grid hit is the document's own words, not a generated reading")
check = DOCUMENT.verify("Chief Product Officer | Time to market and conversion.", 2)
ok("source_kind is page, as for any other quote", check.source_kind == "page", check)
ok("and it carries no caveat", check.reason == "", check.reason)
ok("on the page it is printed on", check.page == 2, check.page)

print("\nand nothing invented is admitted")
ok(
    "a sentence the document never makes",
    not DOCUMENT.verify("Session recording is enabled for every path.", 3).verified,
)
ok(
    "a real cell value with an invented one appended",
    not DOCUMENT.verify(
        "Chief Product Officer | Time to market and a board-approved exception register.", 2
    ).verified,
)
ok(
    "a column label invented onto a real value",
    not DOCUMENT.verify("Approval status: Chief Product Officer", 2).verified,
)
ok(
    "words from two pages welded together",
    not DOCUMENT.verify(
        "Chief Technology Officer | session recording is not enabled for this path", 2
    ).verified,
)

print("\nthe index is kept apart from the page text")
ok(
    "_tables holds only the pages that have tables",
    set(DOCUMENT._tables) == {2},
    sorted(DOCUMENT._tables),
)
ok(
    "the prose page is not in it",
    3 not in DOCUMENT._tables,
)
ok(
    "and _normal still holds the stored form, unchanged",
    "stakeholder chief product officer" in DOCUMENT._normal[2],
)
ok(
    "so the text the judge reads is the stored form",
    "Stakeholder: Chief Product Officer" in DOCUMENT.text
    and "Approval status" not in DOCUMENT.text,
)

print("\n_ungrid only removes a short leading label")
ok(
    "a column label goes",
    whole_document._ungrid("Stakeholder: Chief Product Officer") == "Chief Product Officer",
)
ok(
    "a long lead-in is prose and keeps its colon",
    whole_document._ungrid(
        "The platform supports the following regulated activities and obligations: lending"
    )
    == "The platform supports the following regulated activities and obligations: lending",
)
ok(
    "a cell with no colon is untouched",
    whole_document._ungrid("Chief Product Officer | Time to market")
    == "Chief Product Officer | Time to market",
)
ok(
    "a label with an empty value is untouched",
    whole_document._ungrid("Notes: ") == "Notes: ",
)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
