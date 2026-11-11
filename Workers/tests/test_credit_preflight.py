"""A run refuses to start on an empty key — and refuses nothing else.

Dying halfway is the worst outcome the analyse stage has. The credits are spent
either way, and what they bought is a fraction of a report: on one real run the
fraction that happened to hold DAT and EA, while every clause that would have
decided the review sat in the two thirds that never ran.

So the balance is checked before the first clause. The check then has to be far
more careful than the thing it prevents, because it runs ahead of every single
assessment:

  · a resume with every clause already judged needs no model calls at all, only
    the finishing passes. Refusing it on an empty key would fail a run that was
    about to succeed for free — and quota failures are fatal now, so it would be
    marked failed and lose its coverage, advice and root-cause passes. That is
    the exact resume the check was written to protect.
  · a provider that reports no balance, and a check that fails for its own
    reasons, must both read as "unknown" and let the run proceed. Unknown is not
    empty. Refusing to start on a number nobody could read would be a worse
    failure than the one being prevented.
  · and "has credit" is not "has enough". A key holding $0.11 was asked for $2
    of work, and every check that only asked whether the balance was positive
    said yes — right up until clause nine. What the balance has to be measured
    against is the work, which is why the floor is per clause.

    python tests/test_credit_preflight.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.ai import llm  # noqa: E402
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


calls: list[str] = []


def answering(value):
    def probe():
        calls.append("asked")
        if isinstance(value, Exception):
            raise value
        return value

    return probe


original = llm.credit_remaining
try:
    print("\nA resume with nothing left to judge")
    calls.clear()
    llm.credit_remaining = answering(0.0)
    analyse._refuse_without_credit(0)
    ok("is allowed through", True)
    ok("without even asking the provider", not calls, calls)

    print("\nAn empty key with work to do")
    calls.clear()
    llm.credit_remaining = answering(0.0)
    try:
        analyse._refuse_without_credit(170)
        ok("is refused", False, "no exception raised")
    except llm.QuotaExhausted as exc:
        ok("is refused", True)
        ok("and says how much work it was for", "170 clauses" in str(exc), str(exc))

    print("\nUnknown is not empty")
    for name, value in (
        ("a provider that reports no balance", None),
        ("a check that raises", RuntimeError("no credential bound")),
    ):
        llm.credit_remaining = answering(value)
        try:
            analyse._refuse_without_credit(170)
            ok(f"{name} lets the run proceed", True)
        except Exception as exc:  # noqa: BLE001
            ok(f"{name} lets the run proceed", False, f"{type(exc).__name__}: {exc}")

    print("\nA balance that is positive and nowhere near enough")
    # The case the check exists for, and the one a `left <= 0` test waves
    # through: $0.11 against a run that needs about $2.
    llm.credit_remaining = answering(0.1134)
    try:
        analyse._refuse_without_credit(170)
        ok("is refused", False, "no exception raised")
    except llm.QuotaExhausted as exc:
        ok("is refused", True)
        ok("the message names what is there", "0.11" in str(exc), str(exc))
        ok("and what it would take", "0.34" in str(exc), str(exc))

    print("\nThe floor is per clause, so it scales with the work")
    llm.credit_remaining = answering(0.1134)
    try:
        analyse._refuse_without_credit(5)
        ok("the same balance runs five clauses", True)
    except Exception as exc:  # noqa: BLE001
        ok("the same balance runs five clauses", False, exc)

    print("\nCredit that covers the work")
    llm.credit_remaining = answering(12.5)
    try:
        analyse._refuse_without_credit(170)
        ok("is allowed through", True)
    except Exception as exc:  # noqa: BLE001
        ok("is allowed through", False, exc)
finally:
    llm.credit_remaining = original

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
