"""An unsupported part of an answer is not an unsupported answer.

The guards exist to stop a confident model convicting a design of something it
never said. One of them went too far. A model that read a design correctly,
quoted it correctly, and *also* named a standing decision nobody had made had
the whole finding thrown away and replaced with "needs_review".

On a 170-clause run against a real design that fired twenty times — more than
half of every clause sent for human review — and it took with it a contradiction
carrying three verified quotes, the shared-database breach it named, and the fix
for it. The reason it fired on every one: the organisation had no standing
decisions at all, so the model was handed an empty register, named the design's
own ADRs instead, and every id was "fabricated" by definition. A check that
cannot not fire is not a check.

What this proves:

  · a verdict with verified document evidence survives a bad decision citation,
    and the citation is dropped;
  · a verdict with nothing verifiable behind it is still demoted, because there
    the invented citation is the only thing holding it up;
  · the set-aside is reported only when there was a register to get wrong, so a
    customer with no decisions on file does not read twenty notes about one;
  · the quote guard is unchanged — some quotes verifying keeps the verdict, none
    verifying still loses it;
  · and the engine never answers a self-contradicting finding by calling it a
    pass. A rationale that argues compliance under a verdict that says otherwise
    goes to a reviewer, in either direction, rather than being resolved in the
    design's favour.

No database, no model, no network.

    python tests/test_guard_strips.py
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


CLAUSE = "Systems of Record must be accessed through governed interfaces, not direct database access."
QUOTE = "The legacy application shares a database schema with the newer Order Read API."
EVIDENCE = [{"chunkId": "quote-1", "excerpt": QUOTE, "sourceKind": "quote", "page": 5}]
REASON = "The design shares a database schema between services. Decouple it behind an interface."


def guard(**over):
    args = dict(
        verdict="contradicts",
        confidence=0.95,
        evidence=list(EVIDENCE),
        best_score=1.0,
        rationale=REASON,
        fabricated=[],
        offered=0,
        clause_text=CLAUSE,
    )
    args.update(over)
    return analyse._guard(
        args.pop("verdict"),
        args.pop("confidence"),
        args.pop("evidence"),
        args.pop("best_score"),
        args.pop("rationale"),
        **args,
    )


print("\nA cited decision nobody made, on a finding that stands on its own")
verdict, rationale = guard(fabricated=["MO-ADR-007"])
ok("the verdict survives", verdict == "contradicts", verdict)
ok("the model's own reason survives", "shares a database schema" in rationale, rationale)
ok(
    "and with no register offered, nothing is said about it",
    "not on record" not in rationale,
    rationale,
)

print("\nThe same, where the customer does keep a decision register")
verdict, rationale = guard(fabricated=["MO-ADR-007"], offered=3)
ok("the verdict still survives", verdict == "contradicts", verdict)
ok("the set-aside is reported", "not on record, set aside" in rationale, rationale)
ok("and it reads as singular for one", "1 cited standing decision " in rationale, rationale)

verdict, rationale = guard(fabricated=["a", "b"], offered=3)
ok("plural for more than one", "2 cited standing decisions " in rationale, rationale)

print("\nA fabricated citation is still fatal where nothing else backs the verdict")
# "absent" rather than "contradicts": a citing verdict with no evidence is
# already stopped by the guard above, so this is the path where the invented
# citation really is the only thing holding the answer up.
verdict, rationale = guard(verdict="absent", fabricated=["MO-ADR-007"], evidence=[], offered=3)
ok("demoted", verdict == "needs_review", verdict)
ok("and says why", "not on record" in rationale, rationale)

verdict, _ = guard(verdict="absent", fabricated=["MO-ADR-007"], evidence=[], offered=0)
ok("and with no register offered either, since nothing backs it", verdict == "needs_review", verdict)

print("\nThe guard is otherwise untouched")
verdict, _ = guard()
ok("a clean contradiction is left alone", verdict == "contradicts", verdict)
verdict, rationale = guard(evidence=[])
ok("a citing verdict with no evidence still goes", verdict == "needs_review", verdict)
ok("for the reason it always did", "cited nothing" in rationale, rationale)

print("\nQuote verification, unchanged")


def document(**over):
    args = dict(
        verdict="covered",
        confidence=0.95,
        rationale=REASON,
        evidence=list(EVIDENCE),
        unverified=[],
        fabricated=[],
        offered=0,
        conflicted=False,
        clause_text=CLAUSE,
    )
    args.update(over)
    return analyse._guard_document(
        args.pop("verdict"), args.pop("confidence"), args.pop("rationale"), **args
    )


verdict, rationale = document(unverified=[("Source 16 Target", "not in the document")])
ok("one bad quote among good ones keeps the verdict", verdict == "covered", verdict)
ok("and says what was set aside", "not found, set aside" in rationale, rationale)

verdict, rationale = document(
    evidence=[], unverified=[("Source 16 Target", "the quoted words are not in the document")]
)
ok("no quote verifying still loses it", verdict == "needs_review", verdict)

print("\nA finding whose reason contradicts its own verdict")
# The clause requires MFA for privileged access. The design says the legacy
# operations console has none — quoted in the finding's own evidence — and the
# model then wrote a last sentence saying the clause was met. This used to be
# resolved by promoting the verdict to "covered", and the report told a
# reviewer an unprotected privileged console was compliant.
SELF_CONTRADICTING = {
    "verdict": "partial",
    "confidence": 0.95,
    "rationale": (
        "MFA is enforced for corporate SSO, AWS console and remote VPN. The legacy "
        "operations console uses username and password. This satisfies the clause's "
        "requirement for appropriate authentication with MFA for privileged access."
    ),
    "evidence": [],
    "appliedDecisions": [],
}
AUTH_CLAUSE = {
    "statement": (
        "All access must be authenticated appropriately to sensitivity, with MFA for "
        "privileged and remote access."
    ),
    "title": "Authentication Standards",
}

ok(
    "the self-contradiction is still detected",
    analyse._fix_is_a_compliance_claim("partial", SELF_CONTRADICTING["rationale"]),
)

# Without these, a `_fix_is_a_compliance_claim` that returned True
# unconditionally would pass every other assertion in this file — while
# demoting every unmet finding in production to needs_review.
#
# It was close to that. `_COMPLIANT_PROSE` matches "conforms to", "meets the"
# and "adheres to"; `_IMPERATIVE` is a closed verb list that did not know
# Ensure, Adopt, Use or Update. Four of these five read as self-contradictions.
print("\n  …and an ordinary fix is left alone")
for fix in (
    "Ensure the legacy console conforms to the MFA baseline.",
    "Adopt MuleSoft so the design conforms to the integration standard.",
    "Use KMS so the staging file meets the encryption requirement.",
    "Update the ADR so it adheres to the exception process.",
    "Document the retention period so the design satisfies the clause.",
    "Establish a named owner so the domain adheres to the governance policy.",
):
    ok(f"not flagged: {fix[:46]}…", not analyse._fix_is_a_compliance_claim("partial", fix), fix)

ok(
    "a covered verdict is never flagged",
    not analyse._fix_is_a_compliance_claim("covered", SELF_CONTRADICTING["rationale"]),
)
# The engine maps any unrecognised verdict to needs_review, and needs_review is
# in `_NEEDS_REMEDIATION` — so without a guard the engine writes "Graded
# 'needs_review', then gave a reason arguing the design already complies" about
# a label it assigned itself, changing no verdict in the process. Asserted on
# `_normalise`, where the guard lives, not on the predicate.
GARBLED = {
    "verdict": "not-a-verdict",
    "confidence": 0.9,
    "rationale": SELF_CONTRADICTING["rationale"],
    "evidence": [],
    "appliedDecisions": [],
}
verdict, _conf, rationale, _cited, _claimed = analyse._normalise(GARBLED, AUTH_CLAUSE)
ok("an unrecognised verdict still becomes needs_review", verdict == "needs_review", verdict)
ok(
    "but the engine does not accuse the model over its own label",
    "do not agree" not in rationale,
    rationale,
)
verdict, _conf, rationale, _cited, _claimed = analyse._normalise(SELF_CONTRADICTING, AUTH_CLAUSE)
ok("it is never resolved as a pass", verdict != "covered", verdict)
ok("it goes to a reviewer", verdict == "needs_review", verdict)
ok("and the report says what did not add up", "do not agree" in rationale, rationale)
ok("the model's own words are kept for the reviewer", "legacy operations console" in rationale.lower(), rationale)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
