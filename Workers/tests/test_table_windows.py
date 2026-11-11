"""A table too large to embed becomes several chunks, not one refused request.

Every embedding provider caps a single input — OpenAI's text-embedding-3-* at
8192 tokens — and rejects the *whole batch* when one input is over it. The
whole-table chunk was the only unbounded thing the chunker produced: one per
table, every row rendered into it. A 215-row technology-stack sheet made a
52,000-character chunk, and the 400 it came back with failed the index build
for a document whose other 258 chunks were fine.

The windows have to keep what that chunk is for. It exists so a question about
the table itself — "what are the criticality tiers?" — can be answered by
something other than a single row, so a window without the header line is a
grid of values with nothing saying what the columns mean.

    docker run --rm -v "$PWD":/w -w /w --entrypoint python \\
      aidp-worker-test tests/test_table_windows.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.ai import embeddings  # noqa: E402
from aidp.stages.chunk import _MAX_TABLE_CHARS, _table_windows  # noqa: E402

passed = failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


COLUMNS = ["Technology", "Category", "Status", "Justification"]


def rows(count: int, width: int = 200) -> list[dict[str, str]]:
    return [
        {
            "Technology": f"Component {i}",
            "Category": "Cloud Provider",
            "Status": "Adopt",
            "Justification": "x" * width,
        }
        for i in range(1, count + 1)
    ]


print("1. A table that already fits is left exactly as it was")

small = _table_windows(COLUMNS, rows(3))
ok("one window", len(small) == 1, len(small))
ok("spanning every row", small[0][1:] == (1, 3), small[0][1:])
ok("header first", small[0][0].splitlines()[0] == " | ".join(COLUMNS))
ok("every row present", small[0][0].count("Component ") == 3)


print("\n2. A table too large to embed is split")

big = rows(215)
windows = _table_windows(COLUMNS, big)
ok("more than one window", len(windows) > 1, len(windows))
ok(
    "none over the budget",
    all(len(text) <= _MAX_TABLE_CHARS for text, _, _ in windows),
    [len(t) for t, _, _ in windows],
)
ok(
    "none over the provider's input ceiling",
    all(len(text) <= embeddings.MAX_INPUT_CHARS for text, _, _ in windows),
)
ok("every window carries the header", all(t.startswith(" | ".join(COLUMNS)) for t, _, _ in windows))

# The point of splitting rather than truncating: nothing is lost.
covered = [i for _, first, last in windows for i in range(first, last + 1)]
ok("the rows are covered once each, in order", covered == list(range(1, 216)), covered[:5])
ok("the last window ends at the last row", windows[-1][2] == 215, windows[-1][2])
present = sum(text.count("Component ") for text, _, _ in windows)
ok("no row is dropped", present == 215, present)


print("\n3. An empty cell still says so")

sparse = _table_windows(COLUMNS, [{"Technology": "Tier 4"}] * 3)
ok("blank renders as 'not specified'", sparse[0][0].count("not specified") == 9, sparse[0][0])


print("\n4. One row wider than the whole budget")

huge = _table_windows(COLUMNS, rows(2, width=_MAX_TABLE_CHARS * 2))
ok("each is its own window", len(huge) == 2, len(huge))
ok("and is cut to the budget", all(len(t) <= _MAX_TABLE_CHARS for t, _, _ in huge))
ok("neither row is lost", [w[1] for w in huge] == [1, 2], [w[1] for w in huge])


print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
