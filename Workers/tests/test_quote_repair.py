"""A quote the model mis-transcribed is repaired, not refused.

Six of the eight quotes ever refused on a real run were one corruption, and
every one of them was a correct finding sent to `needs_review`. These are the
stored values, read back by codepoint:

    source_line  : 'Source → Target: Web/mobile → API Gateway'        (clean)
    model quote  : 'Source \\x0216 Target: Web/mobile \\x0216 API Gateway'

The document carries a real U+2192. The model writes it back as U+0002 followed
by a digit run. `normalise` drops the control character on its own — it is not a
word character — and keeps "16", so a word-perfect quote fails to match on two
stray numbers that were never in the document.

So a control character takes its adjacent digits with it.

**Why this is not the change that was reverted.** An earlier attempt substituted
arrow glyphs inside `whole_document.build`, which changed the text the judge
reads. Four other paths — `coverage`, `advice`, `lifecycle` and `request_intake`
— render the raw document and verify against the built one, so the two sides
stopped agreeing and every gap quoting a line with an arrow in it was silently
dropped.

This change is in `normalise` alone, which is the comparison key and is applied
to **both** sides of every comparison. `render` is untouched, so the judge still
reads the document exactly as before. Checked against the whole stored corpus —
11,383 source lines and 120 figure descriptions — not one contains a control
character, so the document side of the comparison is provably unchanged and only
a corrupted quote is ever repaired. The tests below pin both halves of that: the
repair works, and the document side does not move.

No database, no model, no network.

    python tests/test_quote_repair.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp import whole_document as wd  # noqa: E402

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


# Page 5 of the real design, as stored.
PAGE = (
    "Source → Target: Web/mobile → API Gateway | Pattern / mechanism: "
    "Request-Response; HTTPS REST | Latency, frequency, volume: Interactive; "
    "payload <2 MB; peak 1,500 req/s platform-wide"
)
DOC = wd.build("MERIDIAN ONE", [{"page": 5, "kind": "table_row", "text": PAGE}], [])


print("\nThe corruption is repaired")
ok(
    "the clean quote still verifies",
    DOC.verify("Source → Target: Web/mobile → API Gateway", 5).verified,
)
ok(
    "U+0002 plus one digit",
    DOC.verify("Source \x021 Target: Web/mobile \x021 API Gateway", 5).verified,
)
ok(
    "U+0002 plus two digits",
    DOC.verify("Source \x0216 Target: Web/mobile \x0216 API Gateway", 5).verified,
)
ok(
    "digits before the control character too",
    DOC.verify("Source 16\x02 Target: Web/mobile 16\x02 API Gateway", 5).verified,
)

print("\nFigures that mean something are left alone")
ok("a thousands-separated rate", DOC.verify("peak 1,500 req/s platform-wide", 5).verified)
# Four words after normalising, because "payload <2 MB" alone is three and
# `MIN_QUOTE_WORDS` refuses it on length — which is a different rule, correctly
# applied, and not this one's business.
ok("a payload bound", DOC.verify("Interactive; payload <2 MB", 5).verified)
ok(
    "a digit a space away from a control character survives",
    wd.normalise("see \x02 1,500 req/s") == "see 1 500 req s",
)
ok(
    "real whitespace is not a corrupt glyph",
    wd.normalise("clause 5\n6 applies") == "clause 5 6 applies",
    wd.normalise("clause 5\n6 applies"),
)

print("\nThe repair cannot manufacture a match")
ok(
    "a passage that is simply not there stays refused",
    not DOC.verify("Kafka topic retention is seven days", 5).verified,
)
ok(
    "nor does stripping digits join two separate passages",
    not DOC.verify("Source \x021 Target: Kafka \x021 API Gateway", 5).verified,
)

print("\nThe document side of the comparison does not move")
# The failure mode of the reverted attempt: the judge reading one text and its
# quotes being checked against another.
ok("render() keeps the document's own arrow", "→" in wd.render(DOC))
ok("the rendered page is byte-for-byte the source line", PAGE in wd.render(DOC))
ok(
    "no page of ordinary prose is altered by the repair",
    wd._CORRUPT_GLYPH.sub(" ", PAGE) == PAGE,
)
ok(
    "and contains() reads both sides the same way",
    wd.contains(PAGE, "Web/mobile \x0216 API Gateway"),
)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
