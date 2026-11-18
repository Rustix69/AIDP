"""Every name the workers call on `aidp.ai.llm` actually exists on it.

This file exists because one did not, for three commits, and nothing noticed.

`analyse._reconsider_covered` called `llm.review_covered(...)`. The method was
on the `LLM` Protocol and on all three client classes — Gemini, Anthropic,
OpenRouter — but the module-level wrapper that dispatches to `client()` was
never written. So every run raised `AttributeError: module 'aidp.ai.llm' has no
attribute 'review_covered'` on the first batch, and the deliberate catch-all in
`_review_covered` swallowed it:

    except Exception as exc:  # noqa: BLE001 — the clause verdicts stand without it
        logs.warn(log, "covered clauses could not be reviewed", ...)

That catch-all is right — a failed tail pass must never cost a run its verdicts
— which is exactly why a missing name could hide behind it indefinitely. The
whole covered-review pass, the answer to the "MFA everywhere except the legacy
console" class of false pass, had never once executed. A paid 170-clause run
bought a warning line.

`test_covered_review.py` could not catch it: it calls `analyse._covered_batches`
and `analyse._adopt_covered_review` directly, which is the right way to test the
batching and the adoption, and means it never goes through `llm` at all.

So this checks the seam itself rather than either side of it. It reads the
`llm.<name>` attributes out of the workers' own source and asserts the module
answers to each one — and asserts the three client classes agree, because a
wrapper that dispatches to a method one provider lacks fails the same way, just
later and only for that provider.

Source is read, not imported, for the attributes: importing every stage to see
what it touches would need a database URL and a model key, and this has to run
anywhere.

No database, no model, no network.

    python tests/test_llm_surface.py
"""

from __future__ import annotations

import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.ai import llm  # noqa: E402

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


PACKAGE = pathlib.Path(__file__).resolve().parents[1] / "aidp"

#: `llm.name(` — a call, not a mere mention. The trailing paren matters: the
#: codebase refers to `llm.QuotaExhausted` and `llm.available` in prose and in
#: `except` clauses, and an attribute that is only ever named in a comment is
#: not a seam this has to hold.
_CALL = re.compile(r"\bllm\.([a-z_][a-z0-9_]*)\s*\(")

#: `client().name(` inside llm.py — the wrappers that actually hand the call to
#: a provider. Derived from the source rather than listed here, because a list
#: is a second place to update and this check exists precisely because somebody
#: updated one place and not the other. Plenty of module functions are pure
#: helpers (`model_name`, `parse_json`, `contextualise_many`, the prompt
#: identities) and dispatch to nothing; they are not a seam.
_DISPATCH = re.compile(r"\bclient\(\)\.([a-z_][a-z0-9_]*)\s*\(")


def _called_names() -> dict[str, set[str]]:
    """Every `llm.<name>(` in the workers' own source, by the file calling it."""
    out: dict[str, set[str]] = {}
    for path in sorted(PACKAGE.rglob("*.py")):
        # The module does call itself — `judge` uses `_client()` directly — and
        # holding llm.py against its own text would prove nothing.
        if path.resolve() == pathlib.Path(llm.__file__).resolve():
            continue
        for name in _CALL.findall(path.read_text()):
            out.setdefault(name, set()).add(str(path.relative_to(PACKAGE)))
    return out


print("\n1. Every name the workers call resolves on the module")

called = _called_names()
ok("the scan found calls at all", len(called) >= 10, sorted(called))

missing = {name: sorted(where) for name, where in called.items() if not hasattr(llm, name)}
ok(
    "no worker calls a name the module does not have",
    not missing,
    missing,
)

# The one that was actually missing, named outright so a regression reads as
# itself rather than as "something in the surface check".
ok("review_covered is on the module", hasattr(llm, "review_covered"))
ok(
    "and it is callable, not a stray attribute",
    callable(getattr(llm, "review_covered", None)),
)


print("\n2. Every provider implements what the wrappers dispatch to")

# A module wrapper is `return client().name(...)`, so the name has to exist on
# whichever client the environment picks. One provider missing it is the same
# bug, discovered later and only by the customer using that provider.
CLIENTS = [llm.GeminiLLM, llm.AnthropicLLM, llm.OpenRouterLLM]

wrapped = sorted(set(_DISPATCH.findall(pathlib.Path(llm.__file__).read_text())))
ok("the dispatch scan found wrappers", len(wrapped) >= 10, wrapped)
for client in CLIENTS:
    absent = [name for name in wrapped if not hasattr(client, name)]
    ok(f"{client.__name__} implements every dispatched call", not absent, absent)


print("\n3. The Protocol and the clients still agree")

# `LLM` is what the clients are checked against; a method added to one client
# and not to the Protocol is a call nobody can make through a typed reference.
protocol = {
    name
    for name in dir(llm.LLM)
    if not name.startswith("_") and callable(getattr(llm.LLM, name, None))
}
for client in CLIENTS:
    absent = sorted(name for name in protocol if not hasattr(client, name))
    ok(f"{client.__name__} satisfies the LLM protocol", not absent, absent)

ok(
    "review_covered is on the protocol too",
    "review_covered" in protocol,
    sorted(protocol),
)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
