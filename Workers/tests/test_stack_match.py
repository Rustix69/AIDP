"""Matching a design against the organisation's technology stack.

The two findings this has to make possible, from the Meridian answer key:

    EA-007  contradicts — new Redshift marts on a Hold technology
    EA-008  contradicts — Mirth Connect is not in the Technology Stack

They are not the same shape, and that is the whole design. A held technology is
found by looking for the stack's names in the design. An absent one cannot be:
searching stack names only ever surfaces what is already in the stack. So this
checks that the first half is reliable and that the second half is handed to
the judge intact — and, mostly, that the first half does not accuse anybody of
anything it cannot prove.

Runs against the real 227-row template when it is on disk, because every trap
below was found in it rather than imagined.
"""

import os
import re
import inspect
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aidp import stack  # noqa: E402
from aidp.parsing import sheets, technologies  # noqa: E402

passed = 0
failed = 0


def ok(label, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed += 1
        print(f"  FAIL {label}" + (f"\n         {detail}" if detail else ""))


TEMPLATE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "templates",
    "AIDP_Technology_Stack_Template (1).xlsx",
)


def real_stack() -> stack.Stack | None:
    if not os.path.exists(TEMPLATE):
        return None
    with open(TEMPLATE, "rb") as handle:
        book = sheets.read(handle.read())
    read = technologies.read(
        book.tables, sheet_names={t.page_start: (t.caption or "") for t in book.tables}
    )
    if read is None:
        return None
    return stack.Stack(
        rows=[
            stack.Row(
                name=t.name,
                status=t.status,
                category=t.category,
                approved_versions=t.approved_versions,
                notes=t.notes,
            )
            for t in read.technologies
        ]
    )


# ---------------------------------------------------------------------------
# 1. The name on the row, in its parts
# ---------------------------------------------------------------------------
print("\n1. reading a row's name\n")

row = stack.Row(name="PostgreSQL (Amazon Aurora / RDS)", status="adopt")
ok("the primary name is what sits before the bracket", row.primary == "PostgreSQL", row.primary)
ok("and the bracket is kept, separately", row.bracketed == "Amazon Aurora / RDS", row.bracketed)

ok(
    "only Adopt counts as approved for new work",
    stack.Row(name="x", status="adopt").approved_for_new_work
    and not stack.Row(name="x", status="trial").approved_for_new_work
    and not stack.Row(name="x", status="hold").approved_for_new_work,
)

# ---------------------------------------------------------------------------
# 2. The must-get: a held technology, found by name
# ---------------------------------------------------------------------------
print("\n2. the half that is a lookup\n")

held = stack.Stack(
    rows=[
        stack.Row(name="Amazon Redshift", status="hold", notes="Not for new use."),
        stack.Row(name="Apache Kafka (Amazon MSK)", status="adopt"),
        stack.Row(name="PostgreSQL (Amazon Aurora / RDS)", status="adopt", approved_versions="15.x, 16.x"),
    ]
)

design = (
    "The analytics layer builds new Redshift marts for the reporting domain, "
    "fed by Kafka topics from the ingestion tier, with PostgreSQL as the "
    "operational store."
)
hits = stack.names_in(held, design)
names = [hit.row.name for hit in hits]

ok("the held technology is found", "Amazon Redshift" in names, names)
ok(
    "found from the design's own shorter name, not the stack's full one",
    any(hit.row.name == "Amazon Redshift" and "Redshift marts" in hit.quote for hit in hits),
    [hit.quote for hit in hits],
)
ok("a vendor-prefixed name is found by its bare word", "Apache Kafka (Amazon MSK)" in names, names)
ok("and so is one carrying a bracket", "PostgreSQL (Amazon Aurora / RDS)" in names, names)
ok("the held one is listed first", names[0] == "Amazon Redshift", names)

ok(
    "each hit quotes the design, so a reviewer can check it",
    all(hit.quote.strip() for hit in hits),
)

# ---------------------------------------------------------------------------
# 3. The half that is NOT a lookup
# ---------------------------------------------------------------------------
print("\n3. the half that cannot be a lookup\n")

absent_design = "Integration runs through Mirth Connect, deployed on two nodes."
ok(
    "a technology the stack has never heard of produces no hit at all",
    stack.names_in(held, absent_design) == [],
    "this is the point: absence is not findable by scanning the stack",
)
block = stack.render(held, stack.names_in(held, absent_design))
ok(
    "so the full approved list goes to the judge instead",
    "Apache Kafka (Amazon MSK)" in block and "PostgreSQL" in block,
)
ok(
    "with the question it has to answer stated",
    "not named here has not been through" in block,
    block[-200:],
)
ok("and it says plainly that nothing was found by name", "No technology" in block, block[:120])

# ---------------------------------------------------------------------------
# 4. What it must NOT claim — every one of these is a real row
# ---------------------------------------------------------------------------
print("\n4. the accusations it refuses to make\n")

traps = stack.Stack(
    rows=[
        stack.Row(name="Go", status="adopt"),
        stack.Row(name="Ray", status="assess"),
        stack.Row(name="Databricks SQL (Serverless)", status="adopt"),
        stack.Row(name="MongoDB (self-hosted)", status="hold"),
        stack.Row(name="Amazon Web Services (AWS)", status="adopt"),
        stack.Row(name="Amazon MQ", status="hold"),
        stack.Row(name="Microsoft SQL Server (Amazon RDS)", status="trial"),
    ]
)

def found_in(text):
    return [hit.row.name for hit in stack.names_in(traps, text)]

ok(
    "a two-letter name is never scanned for — 'Go' is inside 'Google' and 'going'",
    found_in("We are going to use Google Cloud for this.") == [],
    found_in("We are going to use Google Cloud for this."),
)
ok(
    "nor a three-letter one — 'Ray' is inside 'array' and names another product in 'AWS X-Ray'",
    found_in("An array of services, traced with AWS X-Ray.") == [],
    found_in("An array of services, traced with AWS X-Ray."),
)
ok(
    "a bracket is never read as a name — 'Serverless' is not Databricks SQL",
    found_in("The ingestion tier is serverless throughout.") == [],
    found_in("The ingestion tier is serverless throughout."),
)
ok(
    "nor is a deployment flavour — 'self-hosted' is not MongoDB",
    found_in("The broker is self-hosted on EC2.") == [],
    found_in("The broker is self-hosted on EC2."),
)
ok(
    "a vendor word is not stripped when what is left is a phrase — 'web services' is not AWS",
    found_in("The design exposes several web services.") == [],
    found_in("The design exposes several web services."),
)
ok(
    "nor when what is left is too short to stand alone — 'MQ' is not Amazon MQ",
    found_in("Messages are carried over MQ.") == [],
    found_in("Messages are carried over MQ."),
)
ok(
    "nor 'SQL' from Microsoft SQL Server",
    found_in("All access is through parameterised SQL.") == [],
    found_in("All access is through parameterised SQL."),
)
ok(
    "but the full name still matches",
    found_in("We run Microsoft SQL Server in RDS.") == ["Microsoft SQL Server (Amazon RDS)"],
    found_in("We run Microsoft SQL Server in RDS."),
)
ok(
    "a name is a whole word, not a fragment — 'Kafkaesque' is not Kafka",
    stack.names_in(held, "The result was Kafkaesque.") == [],
)

# Found on the real MERIDIAN ONE design, after the rest of this file passed.
# "HashiCorp Vault" shortens to "Vault", and the design said:
#
#   AWS Backup protects core databases, but vault lock is not enabled on all
#   backup plans
#
# which matched, and reported a Hold technology the design had never chosen —
# `vault lock` is a feature of AWS Backup. The shortened form now has to be
# capitalised, because a technology is a proper noun and this was not one.
vaults = stack.Stack(rows=[stack.Row(name="HashiCorp Vault", status="hold")])
ok(
    "a shortened name in lower case is the common noun, not the technology",
    stack.names_in(
        vaults,
        "AWS Backup protects core databases, but vault lock is not enabled on all backup plans.",
    )
    == [],
    [h.row.name for h in stack.names_in(vaults, "but vault lock is not enabled")],
)
ok(
    "but the technology itself is still found",
    [h.row.name for h in stack.names_in(vaults, "Secrets are held in Vault.")]
    == ["HashiCorp Vault"],
)
ok(
    "and so is the full name, in any case",
    [h.row.name for h in stack.names_in(vaults, "We run hashicorp vault on EC2.")]
    == ["HashiCorp Vault"],
)

# ---------------------------------------------------------------------------
# 5. Which clauses this is attached to
# ---------------------------------------------------------------------------
print("\n5. the clauses it is shown to\n")

ea007 = {
    "title": "Technology Radar Status Model",
    "statement": "Every technology is classified Adopt, Trial, Assess or Hold in the "
    "Technology Stack; only Adopt is used for new production work.",
}
ea008 = {
    "title": "Technology Selection and Approval",
    "statement": "New technology is introduced through the evaluation and procurement "
    "process; a product not in the Technology Stack needs approval.",
}
ours = {
    "title": "Approved Technology",
    "statement": "Designs must use technologies the organisation has approved; a technology "
    "recorded as on hold must not be introduced, and one absent from the approved stack "
    "requires assessment before adoption.",
}
encryption = {
    "title": "Encryption at Rest",
    "statement": "Persistent stores holding Confidential data must be encrypted at rest.",
}
assessed = {
    "title": "Pre-Release Security Assessment",
    "statement": "Internet-facing systems must be assessed before first release.",
}

ok("EA-007 gets the stack", stack.concerns_technology(ea007))
ok("EA-008 gets the stack", stack.concerns_technology(ea008))
ok("our own approved-technology clause gets it", stack.concerns_technology(ours))
ok("a clause about encryption does not", not stack.concerns_technology(encryption))
ok(
    "and neither does one that merely says 'assessed'",
    not stack.concerns_technology(assessed),
    "'assess' alone appears across the security register",
)

# ---------------------------------------------------------------------------
# 6. Against the real 227 rows
# ---------------------------------------------------------------------------
print("\n6. the real stack\n")

real = real_stack()
if real is None:
    print("     templates/ not present, skipping")
else:
    ok("the template reads as a stack", len(real.rows) > 200, len(real.rows))
    counts = real.counts
    ok("with technologies on hold in it", counts.get("hold", 0) > 0, counts)

    scannable = [r for r in real.rows if stack._searchable(r)]
    ok(
        "most rows can be looked for by name",
        len(scannable) > len(real.rows) * 0.9,
        f"{len(scannable)} of {len(real.rows)}",
    )
    # The rule is on the PRIMARY name, not the whole row name: "Java (Amazon
    # Corretto)" is a long string naming a four-letter technology, and four
    # letters cannot be hunted for in prose.
    short = [r for r in real.rows if not stack._searchable(r)]
    ok(
        "and the ones that cannot are the short ones, deliberately",
        all(
            len(re.sub(r"[^A-Za-z0-9]", "", r.primary)) < stack._MIN_SCANNABLE
            for r in short
        ),
        [(r.name, r.primary) for r in short],
    )
    # Which is a miss, never a false accusation — and it degrades into the half
    # the judge does anyway. Java is not scanned for; the judge still sees it.
    everything = stack.render(real, [])
    ok(
        "a name too short to scan for still reaches the judge in the list",
        all(r.name in everything for r in short),
        [r.name for r in short if r.name not in everything],
    )

    # The Meridian case, against the real file.
    meridian = (
        "The reporting domain introduces new Amazon Redshift marts. "
        "Integration is handled by Mirth Connect between the clinical systems."
    )
    hits = stack.names_in(real, meridian)
    found = [h.row.name for h in hits]
    ok("Redshift is found in the real stack", any("Redshift" in n for n in found), found)
    ok(
        "and it is recorded as Hold",
        any("Redshift" in h.row.name and h.row.status == "hold" for h in hits),
        [(h.row.name, h.row.status) for h in hits],
    )
    ok(
        "Mirth Connect is not found, because it is not there",
        not any("Mirth" in n for n in found),
        found,
    )
    block = stack.render(real, hits)
    ok("the block names Redshift's position for the judge", "Hold" in block)
    ok("and carries the whole approved list", block.count(",") > 100)
    # Cheap, but not free: this goes into every clause the gate lets through.
    print(f"     block is {len(block)} characters, roughly {len(block)//4} tokens")

# ---------------------------------------------------------------------------
# 7. It reaches the judge, and only the judge
# ---------------------------------------------------------------------------
print("\n7. where the block actually goes\n")

from aidp.stages import analyse  # noqa: E402

block = stack.render(held, stack.names_in(held, design))
clause_ea007 = dict(ea007, requirements=[], sourceRefs=None)
clause_enc = dict(encryption, requirements=[], sourceRefs=None)

prompt = analyse._render_clause(clause_ea007, stack_block=block)
ok("the judge sees the stack on a clause about the stack", "Amazon Redshift" in prompt, prompt[-300:])
ok(
    "under a heading that says it is the organisation's record, not the standard",
    "not part of the standard above" in prompt,
)
ok(
    "and after the clause, never before it",
    prompt.index("Statement:") < prompt.index("Amazon Redshift"),
)

ok(
    "a clause about encryption is not given it, even when one is passed",
    "Amazon Redshift" not in analyse._render_clause(clause_enc, stack_block=block),
)

# The one that would be a real defect. `fidelity` tokenises this string to
# decide whether cited evidence is on the clause's subject; two hundred
# technology names would corroborate almost anything.
guard_copy = analyse._render_clause(clause_ea007, with_force=False)
ok(
    "the guards are never given it",
    "Amazon Redshift" not in guard_copy,
    guard_copy[-200:],
)
ok(
    "and the default is no block at all, so every other run reads as it did",
    "Amazon Redshift" not in analyse._render_clause(clause_ea007),
)


# ---------------------------------------------------------------------------
# 7. Every judge prompt on the whole-document path gets it, the guards do not
#
# `_assess_document_one` asks twice: the whole-document reading, and a search
# as the second opinion when that reading says "absent". The second call was
# written without the block, so a technology clause was judged once with the
# stack and once without, and `_overrides_absent` read the disagreement as a
# missed passage. Source-level, because the alternative is a live run.
print("\n7. The second opinion is asked the same question as the first")

def _call(source: str, name: str) -> str:
    """The text of one call, to its matching bracket — not the first `)`, which
    on this call lands inside `get_config()`."""
    start = source.index(name + "(") + len(name)
    depth = 0
    for offset, character in enumerate(source[start:]):
        depth += (character == "(") - (character == ")")
        if depth == 0:
            return source[start : start + offset + 1]
    raise AssertionError(f"unbalanced brackets after {name}(")


source = inspect.getsource(analyse._assess_document_one)
second = _call(source, "_judge_by_search")

ok(
    "the second opinion is handed the stack block",
    "stack_block=stack_block" in second,
    second,
)

# The primary reading moved into `judged_document_once` when the harness was
# given the engine's own judging step to measure rather than a copy of it. The
# invariant is unchanged and is what matters: the block reaches the judge and
# never reaches the guards, whichever function holds the two calls.
reading = inspect.getsource(analyse.judged_document_once)
ok(
    "and the primary reading still is",
    "_render_clause(clause, stack_block=stack_block)" in reading,
)
ok(
    "while the guard copy on the same path still is not",
    "_render_clause(clause, with_force=False)" in reading,
)
ok(
    "and _assess_document_one reaches the judge through that one function",
    "judged_document_once(" in source,
)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
