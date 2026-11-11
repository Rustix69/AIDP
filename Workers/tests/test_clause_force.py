"""The judge is told which clauses are mandatory, and to read past the rule.

Two halves of one failure. A design usually states a rule and its exception in
one breath, and the engine was grading on the rule half:

    "MFA is enforced for corporate SSO, AWS console and remote VPN. Legacy
     operations console has username/password authentication."

That is one passage. It was quoted, verified, and the clause requiring MFA for
privileged access came back "covered".

The second half is why the judge had nothing to weigh it against. `_render_clause`
printed how strongly a clause binds only when the parser had recorded a strength
for each requirement — and a clause read from a register workbook has no
requirement rows at all, because its obligation lives in its statement. Across a
170-clause run over six client registers that line never printed once, while the
prompt went on asking the model to weigh exactly that.

What this proves:

  · a register clause — statement only, no requirements — still tells the judge
    whether it is a must or a should;
  · a clause that establishes no obligation says nothing rather than inventing
    one, which is the rule obligations.py exists to hold;
  · per-requirement strengths are still printed where the parser recorded them;
  · and both judge prompts still carry the rule that sends the model to the end
    of the passage before it answers "covered".

No database, no model, no network.

    python tests/test_clause_force.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.ai import llm  # noqa: E402
from aidp.stages.analyse import _render_clause  # noqa: E402

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


def clause(statement: str, *, title: str = "A clause", requirements=None, refs=None) -> dict:
    return {
        "title": title,
        "statement": statement,
        "requirements": requirements or [],
        "sourceRefs": refs or {},
    }


print("\nA register clause — a statement and nothing else")
MANDATORY = clause(
    "All access must be authenticated appropriately to sensitivity, with MFA for "
    "privileged and remote access.",
    title="Authentication Standards",
)
rendered = _render_clause(MANDATORY)
ok("its force is stated", "How strongly this clause binds:" in rendered, rendered)
ok("as a must", "must" in rendered.split("How strongly this clause binds:")[1])
ok("and admits it was read, not recorded", "read from" in rendered, rendered)

ADVISORY = clause(
    "Production generative AI applications should apply guardrails and PII redaction.",
    title="Generative AI Guardrails",
)
ok("a should is not reported as a must", "should" in _render_clause(ADVISORY).split(
    "How strongly this clause binds:")[1])

print("\nA clause that establishes no obligation")
DESCRIPTIVE = clause(
    "Technology selection covers each layer: front end, data and storage, DevOps.",
    title="Layered Technology Reference Model",
)
rendered = _render_clause(DESCRIPTIVE)
ok("says nothing about force", "How strongly this clause binds:" not in rendered, rendered)
ok("and never invents a must", "must" not in rendered.lower(), rendered)

print("\nPer-requirement strengths are still printed where the parser has them")
PARSED = clause(
    "Records are retained and logs archived.",
    requirements=["Records are retained", "Logs are archived"],
    refs={"requirements": [{"strength": "should"}, {"strength": "must"}]},
)
rendered = _render_clause(PARSED)
ok("the rows survive", "- [should] Records are retained" in rendered, rendered)
ok("both of them", "- [must] Logs are archived" in rendered, rendered)
ok(
    "and the clause's own force is the strongest of them",
    "How strongly this clause binds: must" in rendered,
    rendered,
)

print("\nBoth judge prompts send the model past the rule to the exception")
for name, prompt in (
    ("retrieval", llm._JUDGE_PROMPT),
    ("whole-document", llm._DOCUMENT_JUDGE_SYSTEM),
):
    ok(f"{name}: the carve-out rule is present", "exception" in prompt.lower(), name)
    ok(
        f"{name}: it names what a carve-out looks like",
        '"legacy"' in prompt and "carve-out" in prompt,
        name,
    )
    ok(
        f"{name}: and says a must is not met by all-but-one",
        "everywhere except one named system" in prompt,
        name,
    )

print("\nThe force line is for the prompt; the guards get the clause")
from aidp.stages.analyse import _figure_corroborates, _keywords  # noqa: E402

prompt = _render_clause(MANDATORY)
guard = _render_clause(MANDATORY, with_force=False)
ok("the prompt copy states the force", "How strongly this clause binds" in prompt)
ok("the guard copy does not", "How strongly this clause binds" not in guard, guard)
LEAKED = {"read", "binds", "strongly", "wording"}
ok(
    "the prompt copy is where those words live",
    LEAKED <= set(_keywords(prompt)),
    sorted(set(_keywords(prompt)) & LEAKED),
)
ok(
    "and the guard copy carries none of them for evidence to match against",
    not (set(_keywords(guard)) & LEAKED),
    sorted(set(_keywords(guard)) & LEAKED),
)

# The regression itself. `_figure_corroborates` needs two shared keywords, and
# "read" and "binds" came free with the obligation sentence — so a figure
# description about queues corroborated a cryptography clause, and a verdict
# resting on nothing but a diagram stopped being demoted.
CRYPTO = clause(
    "Confidential data must be encrypted at rest and in transit.",
    title="Cryptographic Standards",
)
FIGURE = "Diagram read by the team showing how each service binds to its own queue."
ok(
    "an unrelated figure does not corroborate the clause",
    not _figure_corroborates(_render_clause(CRYPTO, with_force=False), FIGURE, 1),
)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
