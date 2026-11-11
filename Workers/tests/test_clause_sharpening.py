"""Sharpening a clause, without a database or a model.

A `partial` verdict means the clause could not be judged. The feature this
tests turns that into the requirement lines it was missing — the one place in
the system where a model's words can end up binding future assessments, so the
checks are the product and not a detail of it.

What a wrong answer here looks like: nothing raises. A line that is not a
requirement, or that names one vendor, or that restates what the clause already
says, is simply added to the standards library by a reviewer who had no way to
tell. Every refusal below is one of those, and every one is deterministic so a
model's mood cannot change the outcome.

    docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse \
      -e DATABASE_URL=postgresql://nobody@127.0.0.1:1/none \
      --entrypoint python aidp-worker-test tests/test_clause_sharpening.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp import standards  # noqa: E402

passed = failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


CLAUSE = {
    "clauseRef": "9.3",
    "title": "Resilience and idempotency",
    "statement": "Integrations must handle failure without losing data.",
    "rationale": "A dropped message is an invisible outage.",
    "requirements": ["Retries must be bounded and use exponential backoff."],
    "guidance": [],
}

# As a finding stores it. `documentTitle` is empty on a single-design run — only
# a project run names which design a quote came from — so the checks have to
# find the design's name in the heading path, whose first segment is the
# document title. Both shapes appear here on purpose.
EVIDENCE = [
    {
        "excerpt": "The ingestion service must discard messages that exhaust their "
        "three retries.",
        "headingPath": "Field Telemetry Ingestion SAD › 4.2 Message Handling",
        "page": 4,
        "documentTitle": "",
    },
    {
        "excerpt": "Transport Layer Security is terminated at the gateway.",
        "headingPath": "Field Telemetry Ingestion SAD › 5.1 Transport",
        "page": 5,
        "documentTitle": "Field Telemetry Ingestion SAD",
    },
]

GOOD = (
    "Every queue consumer must define a dead-letter destination for messages that "
    "exhaust their retries."
)


def reply(*requirements: dict, note: str = "The clause never said where exhausted messages go.") -> dict:
    return {"requirements": list(requirements), "note": note}


def one(text: str, basis: int = 1) -> dict:
    return {"text": text, "basis": basis}


def drafted(*requirements: dict, **kw) -> standards.Drafted:
    return standards.check(reply(*requirements, **kw), clause=CLAUSE, evidence=EVIDENCE)


def reasons(out: standards.Drafted) -> list[str]:
    return [item["reason"] for item in out.set_aside]


# ---------------------------------------------------------------------------
print("\n1. A requirement that is one gets through")

out = drafted(one(GOOD))
ok("kept", out.requirements == [GOOD], out.requirements)
ok("nothing refused", out.set_aside == [], out.set_aside)
ok("ready for a person", out.state == "ready")
ok("with the model's case for it", out.note.startswith("The clause never said"), out.note)

# The false positive that would matter most: a standard is written in exactly
# these words, and a check that threw them away would be worse than no check.
out = drafted(
    one("Transport security must use TLS 1.2 or later, and MFA must protect the API console.")
)
ok("acronyms are not mistaken for the design's names", len(out.requirements) == 1, out.set_aside)

out = drafted(
    one("Every consumer must publish a Dead Letter Queue depth metric to the monitoring system.")
)
ok(
    "nor is a capitalised technical term from a quoted passage",
    len(out.requirements) == 1,
    out.set_aside,
)


# ---------------------------------------------------------------------------
print("\n2. What is not a requirement is refused")

out = drafted(one("The design lacks a dead-letter destination for exhausted messages."))
ok("an observation about one design", reasons(out) == ["not written as a requirement"], out.set_aside)

out = drafted(one("Consumers must handle failures appropriately and retry where possible."))
ok(
    "wording nothing could be failed on",
    reasons(out) == ["wording a design could not be failed on"],
    out.set_aside,
)

out = drafted(one("Messages must not be lost."))
ok("too short to name a mechanism", reasons(out) == ["too short to name a mechanism"], out.set_aside)

out = drafted(one("Consumers must " + "define a dead-letter destination " * 12))
ok("longer than one requirement", reasons(out) == ["longer than one requirement"], out.set_aside)


# ---------------------------------------------------------------------------
print("\n3. What the clause already says is refused")

# Not word for word — the same rule in other words. Two halves of one clause
# saying the same thing reach the judge as two independent requirements.
out = drafted(one("Retries must be bounded and use exponential backoff."))
ok("a restatement of an existing line", reasons(out) == ["the clause already requires this"], out.set_aside)

out = drafted(one("Retries must be bounded and use exponential backoff for every queue consumer."))
ok(
    "and a line that swallows an existing one",
    reasons(out) == ["the clause already requires this"],
    out.set_aside,
)

# Worth being plain about the floor: this catches a restatement word for word
# and one that contains or is contained by an existing line. A duplicate in
# genuinely different words is not caught here — the approver reads the clause's
# existing lines directly above the proposal, which is what that check is.
out = drafted(one("Each failed delivery must be reattempted a bounded number of times."))
ok("a reworded duplicate is left to the approver", out.requirements and not out.set_aside)

out = drafted(one(GOOD), one(GOOD))
ok("the same line proposed twice", out.requirements == [GOOD], out.requirements)
ok("and the second one is named", reasons(out) == ["repeats another proposed line"], out.set_aside)


# ---------------------------------------------------------------------------
print("\n4. What belongs to one system is refused")

# The mirror of the quote check in every other stage: there a claim has to be in
# the document, here it must not be. A line that is the design's own sentence is
# a fact about one system and cannot bind the next one.
# The realistic lift: the design already phrases something as a rule, and the
# model hands it back as one. It passes every earlier check, so only this one
# stands between one system's sentence and the whole library.
out = drafted(one("The ingestion service must discard messages that exhaust their three retries."))
ok(
    "a sentence copied out of the design",
    reasons(out) == ["copied from the design rather than written as a rule"],
    out.set_aside,
)

# Part of the design's name, not all of it — the shape that got through before
# the windows in `_proper_names`.
out = drafted(
    one("The Field Telemetry Ingestion consumer must define a dead-letter destination for messages.")
)
ok(
    "a line naming the design itself",
    reasons(out) == ["names the design itself (Field Telemetry Ingestion)"],
    out.set_aside,
)

# From the heading path alone, because a single-design run's evidence carries no
# document title at all.
ok(
    "the design's name is found in the heading path too",
    "Field Telemetry" in standards._proper_names([EVIDENCE[0]]),
    sorted(standards._proper_names([EVIDENCE[0]])),
)
ok(
    "a section heading is not treated as the design's name",
    "Message Handling" not in standards._proper_names(EVIDENCE),
    sorted(standards._proper_names(EVIDENCE)),
)


# ---------------------------------------------------------------------------
print("\n5. A basis it was never given is refused")

# The same rule `_applied` holds decisions to in the analyse stage: a model
# citing something it was not shown has invented its grounds.
out = drafted(one(GOOD, basis=7))
ok("a passage number outside the list", reasons(out) == ["cites a passage that was not given"], out.set_aside)

out = drafted(one(GOOD, basis=0))
ok("and zero is not a passage either", reasons(out) == ["cites a passage that was not given"], out.set_aside)

out = drafted({"text": GOOD})
ok("no basis at all", reasons(out) == ["cites a passage that was not given"], out.set_aside)

out = drafted(one(GOOD, basis=2))
ok("the second passage is a real basis", out.requirements == [GOOD], out.set_aside)


# ---------------------------------------------------------------------------
print("\n6. Bounds and the honest empty answer")

many = [
    one("Every queue consumer must define a dead-letter destination for exhausted messages."),
    one("Consumers must record the message identifier of every dead-lettered message."),
    one("Operators must be alerted when the dead-letter destination depth exceeds zero."),
    one("Consumers must retain dead-lettered messages for at least thirty days."),
]
out = standards.check(reply(*many), clause=CLAUSE, evidence=EVIDENCE)
ok(f"at most {standards.MAX_REQUIREMENTS} lines reach a reviewer", len(out.requirements) == 3, out.requirements)

# "This clause is already specific enough" is a real answer, and the state must
# not call it a failure — a failed draft tells the reviewer to try again, which
# would be wrong here.
out = standards.check(reply(note="The clause is already specific."), clause=CLAUSE, evidence=EVIDENCE)
ok("no requirements is still ready, not failed", out.state == "ready" and out.requirements == [])
ok("and the note says why", out.note == "The clause is already specific.")

out = standards.check({"requirements": "not a list"}, clause=CLAUSE, evidence=EVIDENCE)
ok("a malformed reply yields nothing rather than raising", out.requirements == [])

long_note = standards.check(reply(one(GOOD), note="x" * 400), clause=CLAUSE, evidence=EVIDENCE)
ok("the note is bounded", len(long_note.note) == standards.MAX_NOTE)


# ---------------------------------------------------------------------------
print("\n7. What the model is shown")

rendered = standards.render_clause(CLAUSE)
ok("the clause's existing lines are numbered", "1. Retries must be bounded" in rendered, rendered)
ok("and its reference is named", "Reference: 9.3" in rendered)

bare = standards.render_clause({**CLAUSE, "requirements": []})
ok(
    "a clause with no requirements says so out loud",
    "Requirements it already has: none." in bare,
    bare,
)

ev = standards.render_evidence(EVIDENCE)
ok("passages are numbered from one", ev.startswith("[1] "), ev[:40])
ok("and carry their page", "page 4" in ev)
ok("no passages is said, not shown empty", "cited no passages" in standards.render_evidence([]))

finding = standards.render_finding({"verdict": "partial", "rationale": "Retries but no dead-letter path."})
ok("the finding says a person agreed", "confirmed by a reviewer" in finding, finding)

ok(
    "evidence without an excerpt is dropped rather than guessed at",
    standards.evidence_of({"evidence": [{"headingPath": "x"}, EVIDENCE[0]]}) == [EVIDENCE[0]],
)
ok("and a non-list evidence field is no evidence", standards.evidence_of({"evidence": "x"}) == [])


# ---------------------------------------------------------------------------
print("\n8. The register row the proposal would become")

# A register clause carries its row's identity under sourceRefs.register. Six of
# this customer's standards are spreadsheets, so this is the common shape, not
# the exotic one.
REGISTER_CLAUSE = dict(
    CLAUSE,
    clauseRef="DAT-004",
    sourceRefs={
        "register": {
            "id": "DAT-004",
            "category": "Data Architecture",
            "owner": "Data Platform Team",
            "status": "adopted",
            "notes": "",
        }
    },
)

IDENTITY = {
    "identifier": "DAT-004a",
    "parentIdentifier": "DAT-004",
    "category": "Data Architecture",
    "owner": "Data Platform Team",
    "status": standards.PROPOSED_STATUS,
}

GOOD_ENTRY = {
    "title": "Curated Layer Access",
    "statement": "Consumption layers must read data only through the curated layer.",
    "rationale": "A consumer reading the raw layer is coupled to a schema nobody agreed to keep stable.",
}


def entry_drafted(entry: dict, clause=REGISTER_CLAUSE, identity=IDENTITY) -> standards.Drafted:
    body = reply(one(GOOD))
    body["entry"] = entry
    return standards.check(body, clause=clause, evidence=EVIDENCE, identity=identity)


out = entry_drafted(GOOD_ENTRY)
ok("the drafted row is kept", out.entry.get("statement") == GOOD_ENTRY["statement"], out.entry)
ok("with its title", out.entry.get("title") == "Curated Layer Access")
ok("and its rationale", out.entry.get("rationale") == GOOD_ENTRY["rationale"])

# The point of the whole column: identity is carried, never written by a model.
ok("the reference is derived, not drafted", out.entry.get("identifier") == "DAT-004a")
ok("the row it grew out of is named", out.entry.get("parentIdentifier") == "DAT-004")
ok("the category is carried over", out.entry.get("category") == "Data Architecture")
ok("the owner is carried over", out.entry.get("owner") == "Data Platform Team")
ok("and nothing a model wrote is adopted", out.entry.get("status") == "proposed")

# A model that returns an identifier must not be able to set one. This is the
# check that stops a reference somebody has cited in a design being reused.
out = entry_drafted(dict(GOOD_ENTRY, identifier="DAT-009", status="adopted", owner="Someone Else"))
ok("a drafted identifier is ignored", out.entry.get("identifier") == "DAT-004a", out.entry)
ok("a drafted status is ignored", out.entry.get("status") == "proposed")
ok("a drafted owner is ignored", out.entry.get("owner") == "Data Platform Team")

# The statement passes the floor a requirement line passes, because an approver
# reading a plausible row reads it for sense rather than auditing it.
out = entry_drafted(dict(GOOD_ENTRY, statement="Consumption layers read from the curated layer."))
ok("a statement that is not a rule is dropped", "statement" not in out.entry, out.entry)
ok("and the reason is kept", "statement not written as a rule" in reasons(out), out.set_aside)

out = entry_drafted(dict(GOOD_ENTRY, statement="Layers must use an appropriate access path."))
ok("a vague statement is dropped", "statement" not in out.entry)
ok("with its reason", "statement a design could not be failed on" in reasons(out))

out = entry_drafted(
    dict(GOOD_ENTRY, statement="The Field Telemetry Ingestion consumer must use the curated layer.")
)
ok("a statement naming the design is dropped", "statement" not in out.entry)
ok(
    "and says which name",
    any("names the design itself" in r for r in reasons(out)),
    out.set_aside,
)

out = entry_drafted(dict(GOOD_ENTRY, title="Field Telemetry Ingestion Access"))
ok("a title naming the design is dropped", "title" not in out.entry, out.entry)

out = entry_drafted(dict(GOOD_ENTRY, title="x" * 200))
ok("an overlong title is dropped", "title" not in out.entry)
out = entry_drafted(dict(GOOD_ENTRY, rationale="x" * 500))
ok("an overlong rationale is dropped", "rationale" not in out.entry)

# One bad column must not take the good ones with it.
out = entry_drafted(dict(GOOD_ENTRY, statement="Layers read from the curated layer."))
ok("a refused column leaves the others standing", out.entry.get("title") == "Curated Layer Access")
ok("and the requirement lines are untouched", out.requirements == [GOOD], out.requirements)

# A clause from a prose standard has no register row behind it. The prose the
# model wrote is still worth keeping — publishing a rule of its own needs a
# title and a statement whether or not the library is a spreadsheet — but it
# must be given no reference, category or owner, because inventing those would
# claim this standard is filed somewhere it is not.
out = standards.check(
    {**reply(one(GOOD)), "entry": GOOD_ENTRY}, clause=CLAUSE, evidence=EVIDENCE
)
ok("a prose clause still gets the words", out.entry.get("statement") == GOOD_ENTRY["statement"])
ok("but no reference", not out.entry.get("identifier"), out.entry)
ok("no category", not out.entry.get("category"))
ok("and no owner", not out.entry.get("owner"))

out = standards.check(reply(one(GOOD)), clause=REGISTER_CLAUSE, evidence=EVIDENCE, identity=IDENTITY)
ok("a reply with no entry still carries the identity", out.entry.get("identifier") == "DAT-004a")
ok("and states nothing it was not given", "statement" not in out.entry, out.entry)

out = standards.check(
    {**reply(one(GOOD)), "entry": "not an object"},
    clause=REGISTER_CLAUSE,
    evidence=EVIDENCE,
    identity=IDENTITY,
)
ok("a malformed entry yields the identity, not a raise", out.entry.get("category") == "Data Architecture")

# ---------------------------------------------------------------------------
print("\n9. The reference a rule published beside another would carry")

ok("suffixed, never renumbered", standards.next_reference("DAT-004", set()) == "DAT-004a")
ok(
    "and skips one already taken",
    standards.next_reference("DAT-004", {"DAT-004a", "DAT-004b"}) == "DAT-004c",
)
ok(
    "a rule grown from a suffixed rule does not stack suffixes",
    standards.next_reference("DAT-004a", {"DAT-004a"}) == "DAT-004b",
)
ok("a clause with no reference is given none", standards.next_reference("", set()) == "")
ok(
    "and twenty-six is where it stops asking",
    standards.next_reference("DAT-004", {f"DAT-004{chr(c)}" for c in range(ord("a"), ord("z") + 1)})
    == "",
)

# ---------------------------------------------------------------------------
print("\n10. Reading a register row off a clause")

ok(
    "the row is found where the parser wrote it",
    standards.register_of(REGISTER_CLAUSE)["category"] == "Data Architecture",
)
ok(
    "and where an older publish left it",
    standards.register_of(
        {"sourceRefs": {"inherited": {"register": {"id": "DAT-004", "category": "Data"}}}}
    )["identifier"]
    == "DAT-004",
)
ok("a prose clause has none", standards.register_of(CLAUSE) == {})
ok("and malformed refs raise nothing", standards.register_of({"sourceRefs": "x"}) == {})

ok(
    "the model is shown the category it must write in",
    "Category: Data Architecture" in standards.render_clause(REGISTER_CLAUSE),
)
ok(
    "and who owns the row",
    "Owned by: Data Platform Team" in standards.render_clause(REGISTER_CLAUSE),
)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
