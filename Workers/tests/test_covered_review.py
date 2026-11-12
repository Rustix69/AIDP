"""A "covered" is checked against the evidence it rests on.

Every code guard in `stages/analyse.py` is demote-only and fires on a verdict
with **no** verified quote. A finding that quotes the design accurately and then
reasons wrongly from it passes all of them, and that is not a hypothetical —
these are the real values stored for clause SEC-006 on run
`cmw6go9ex000ffbuyydaic3xy`:

    verdict:   covered @0.95
    evidence:  "MFA is enforced for corporate SSO, AWS console and remote VPN.
                Customer authentication uses password plus risk-based OTP for
                selected transactions. Legacy operations console has
                username/password authentication."
    rationale: "...This satisfies the clause's requirement."

The clause requires MFA for all privileged access. The exception is in the
design's own words, inside the finding's own verified evidence, and the engine
reported the clause compliant. Replaying `fidelity.*` over all 45 `covered`
findings of that run returns zero firings — there was nothing watching this
direction at all.

No regex reaches it. "Legacy operations console has username/password
authentication" carries no breach vocabulary; what makes it a breach is the word
"all" in the clause. So the judgement is asked of a model, and what this file
pins is the code around that call — the part that decides which of its answers
are allowed to change a finding.

What this proves:

  · an exception quoted from the finding's own evidence demotes it;
  · a quote that is NOT in that evidence is refused, so the review cannot
    invent a carve-out the design never stated;
  · "stands" writes nothing, so a verdict the review agrees with keeps the
    confidence and wording it had;
  · the pass is demote-only — it can never raise a verdict, promote to
    "covered", or reach a verdict outside its own enum;
  · the original evidence survives the demotion, because that passage is the
    whole reason a reviewer is being shown the finding;
  · and a batch answer naming a clause that is not in the batch is ignored.

No database, no model, no network.

    python tests/test_covered_review.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.stages import analyse  # noqa: E402

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


# The real clause and the real evidence, as stored.
SEC_006 = {
    "id": "clause-sec-006",
    "title": "SEC-006 Authentication",
    "statement": (
        "Multi-factor authentication shall be enforced for all privileged and "
        "remote access."
    ),
    "requirements": [],
    "headingPath": "Security Standards › Access Control",
    "documentTitle": "Security_Standards",
}

EVIDENCE = [
    {
        "chunkId": "quote-1",
        "headingPath": "",
        "page": 6,
        "excerpt": (
            "MFA is enforced for corporate SSO, AWS console and remote VPN. "
            "Customer authentication uses password plus risk-based OTP for "
            "selected transactions. Legacy operations console has "
            "username/password authentication."
        ),
        "sourceKind": "quote",
        "figureId": None,
    }
]

ROW = {"clauseId": SEC_006["id"], "designKey": None, "evidence": EVIDENCE, "rationale": "..."}
BATCH = [(SEC_006, ROW)]

written: list[dict] = []


def fake_write(run_id, clause, **kwargs):
    written.append({"clause": clause, **kwargs})


analyse._write = fake_write  # noqa: SLF001 — the point is to inspect what is written


def adopt(reply: dict) -> int:
    written.clear()
    return analyse._adopt_covered_review({"id": "run-1"}, BATCH, reply)


print("\nThe failure this exists for")
moved = adopt(
    {
        "clauses": [
            {
                "clause": 1,
                "verdict": "partial",
                "quote": "Legacy operations console has username/password authentication",
                "rationale": "MFA covers SSO, console and VPN but not the legacy console.",
            }
        ]
    }
)
ok("SEC-006 is demoted on its own quoted exception", moved == 1 and len(written) == 1)
ok("to the verdict the review reached", written and written[0]["verdict"] == "partial")
ok(
    "the exception is named in the finding",
    written and "Legacy operations console" in written[0]["rationale"],
)
ok(
    "and the finding says the review is why",
    written and "its own quoted evidence names an exception" in written[0]["rationale"],
)
ok(
    "the evidence it turns on is kept",
    written and written[0]["evidence"] == EVIDENCE,
)
ok(
    "at the confidence of a second reading, not the first",
    written and written[0]["confidence"] == analyse.COVERED_REVIEW_CONFIDENCE,
)

print("\nAn exception it cannot quote is not an exception")
ok(
    "a quote absent from the evidence is refused",
    adopt(
        {
            "clauses": [
                {
                    "clause": 1,
                    "verdict": "contradicts",
                    "quote": "Service accounts bypass MFA entirely",
                    "rationale": "Service accounts are exempt.",
                }
            ]
        }
    )
    == 0,
)
ok(
    "and words stitched from two places are too",
    adopt(
        {
            "clauses": [
                {
                    "clause": 1,
                    "verdict": "partial",
                    "quote": "MFA is enforced for username/password authentication",
                    "rationale": "Stitched from two sentences.",
                }
            ]
        }
    )
    == 0,
)
ok(
    "an empty quote cannot carry a demotion",
    adopt({"clauses": [{"clause": 1, "verdict": "partial", "quote": "", "rationale": "x"}]}) == 0,
)

print("\nDemote-only: the review can never raise a verdict")
QUOTE = "Legacy operations console has username/password authentication"
for verdict in ("covered", "stands", "absent", "not_applicable", "needs_review", "", "COVERED"):
    ok(
        f"{verdict!r} is not written back",
        adopt({"clauses": [{"clause": 1, "verdict": verdict, "quote": QUOTE, "rationale": "x"}]})
        == 0,
    )
ok(
    "only partial and contradicts are",
    all(
        adopt({"clauses": [{"clause": 1, "verdict": v, "quote": QUOTE, "rationale": "x"}]}) == 1
        for v in ("partial", "contradicts")
    ),
)

print("\nA malformed batch answer changes nothing")
ok("a clause number past the batch", adopt({"clauses": [{"clause": 9, "verdict": "partial",
                                                         "quote": QUOTE, "rationale": "x"}]}) == 0)
ok("a clause number of zero", adopt({"clauses": [{"clause": 0, "verdict": "partial",
                                                  "quote": QUOTE, "rationale": "x"}]}) == 0)
ok("no clauses key at all", adopt({}) == 0)
ok("clauses that is not a list", adopt({"clauses": "partial"}) == 0)
ok("an item that is not an object", adopt({"clauses": ["partial"]}) == 0)

print("\nWhat the model is shown")
rendered = analyse._render_covered(BATCH)
ok("the clause is numbered for the batch", rendered.startswith("[1]"))
ok("its own passages are included", "Legacy operations console" in rendered)
ok(
    "and they are labelled as the proof under review",
    "Quoted as proof that the design meets it" in rendered,
)
ok(
    "the obligation line is withheld, as for every other guard",
    "binds" not in rendered.lower(),
)

print("\nA finding with no verified evidence is not reviewed")
# `_guard` has already demoted those; there would be nothing to read it against.
ok("no excerpts means nothing to check", analyse._excerpts([]) == [])
ok("a blank excerpt does not count", analyse._excerpts([{"excerpt": "   "}]) == [])
ok("neither does a non-dict item", analyse._excerpts(["text"]) == [])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
