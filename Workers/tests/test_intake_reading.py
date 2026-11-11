"""The intake reading proposes only what the designs actually say.

A reading fills in an architecture request's structured questions from the
design documents attached to it, so a requestor does not retype their own
architecture into eight boxes. Everything it proposes goes in front of a person
before it becomes an answer — but the person is confirming at a glance, from a
quote, and a proposal they cannot check in two seconds is one they will wave
through. So the checks below the model are what make the saving safe rather than
merely fast.

Four of them matter enough to pin down:

1. **A quote that is not in the design is dropped.** The same rule as every
   other model reply in this system, and here it guards a form somebody signs.
2. **A field nobody asked for is dropped.** The question list comes down on the
   job payload from the app; an answer outside it means the two have drifted,
   and silently keeping it would write a column the app never meant to offer.
3. **A yes/no question is never answered "no".** Only "yes" can be read from a
   document. "No" is the answer that keeps a significance category from
   triggering — which is to say, the answer that routes a submission away from a
   reviewer — and inferring one from silence is the one failure here nobody
   would notice.
4. **Sections are traced to the design they came from.** Several designs are
   rendered into one prompt behind "D1/S4" labels, and an answer labelled with
   one design's section must not be checked against another's text.

There is no model in this suite. The reply is written by hand, which is the
point: these are the checks that run on whatever the model returns.

    docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse \\
      -e DATABASE_URL=postgresql://nobody@127.0.0.1:1/none \\
      --entrypoint python aidp-worker-test tests/test_intake_reading.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp import coverage, request_intake, whole_document  # noqa: E402

passed = failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def design(index: int, document_id: str, title: str, blocks: list[tuple[int, str, list[str]]]):
    """One loaded design from (ordinal, heading, lines) triples."""
    heads = [
        {"ordinal": ordinal, "title": heading, "headingPath": heading, "pageStart": ordinal, "pageEnd": ordinal}
        for ordinal, heading, _ in blocks
    ]
    rows = [
        {"page": ordinal, "kind": "text", "text": line, "sectionOrdinal": ordinal}
        for ordinal, _, lines in blocks
        for line in lines
    ]
    return request_intake.Design(
        index=index,
        document_id=document_id,
        title=title,
        sections=coverage.group(heads, rows),
        whole=whole_document.build(title, rows, []),
    )


PORTAL = design(
    1,
    "doc-portal",
    "Customer Portal Solution Design",
    [
        (
            1,
            "1 Overview",
            [
                "The Customer Portal is a React single-page application served from "
                "Amazon CloudFront, with a Node.js API behind an Application Load Balancer.",
            ],
        ),
        (
            2,
            "2 Data",
            [
                "All customer records are classified Confidential and are held in "
                "Amazon Aurora PostgreSQL 15 in eu-west-1.",
                "Session tokens are cached in Amazon ElastiCache for Redis.",
            ],
        ),
        (
            3,
            "3 Security",
            [
                "End users authenticate against the corporate Entra ID tenant using "
                "OpenID Connect, and API clients use OAuth 2.0 client credentials.",
            ],
        ),
    ],
)

BILLING = design(
    2,
    "doc-billing",
    "Billing Integration Note",
    [
        (
            1,
            "1 Interfaces",
            [
                "The portal calls the SAP billing service over REST, and receives "
                "nightly settlement files from Worldpay over SFTP.",
            ],
        ),
    ],
)

DESIGNS = [PORTAL, BILLING]

QUESTIONS = [
    {"field": "technologies", "shape": "list", "looksFor": "the technologies used"},
    {"field": "dataClassification", "shape": "text", "looksFor": "the sensitivity of the data"},
    {"field": "authMechanism", "shape": "text", "looksFor": "how people sign in"},
    {"field": "integrationPoints", "shape": "text", "looksFor": "the external systems"},
    {"field": "hostingEnvironment", "shape": "text", "looksFor": "where this runs"},
    {"field": "replacesTechnologyComponent", "shape": "yes", "looksFor": "what is being replaced"},
]


def answers(*items: dict) -> dict:
    return {"answers": list(items)}


def by_field(checked) -> dict:
    return {answer["field"]: answer for answer in checked.answers}


print("\nthe reading keeps what the designs bear out")

checked = request_intake.check(
    answers(
        {
            "field": "dataClassification",
            "value": ["Confidential"],
            "section": "D1/S2",
            "quote": "All customer records are classified Confidential and are held in Amazon Aurora PostgreSQL 15 in eu-west-1.",
            "page": 2,
        },
        {
            "field": "technologies",
            "value": ["React", "Node.js", "Amazon Aurora PostgreSQL 15", "Redis"],
            "section": "D1/S1",
            "quote": "The Customer Portal is a React single-page application served from Amazon CloudFront, with a Node.js API behind an Application Load Balancer.",
            "page": 1,
        },
        {
            "field": "integrationPoints",
            "value": ["SAP billing over REST, and nightly settlement files from Worldpay over SFTP."],
            "section": "D2/S1",
            "quote": "The portal calls the SAP billing service over REST, and receives nightly settlement files from Worldpay over SFTP.",
            "page": 1,
        },
    ),
    DESIGNS,
    QUESTIONS,
)
kept = by_field(checked)

ok("three answers kept", len(checked.answers) == 3, checked.dropped)
ok("a list answer stays a list", kept["technologies"]["value"] == [
    "React", "Node.js", "Amazon Aurora PostgreSQL 15", "Redis"
])
ok("a text answer is one string", kept["dataClassification"]["value"] == "Confidential")
ok(
    "an answer is cited to the design it was read from",
    kept["integrationPoints"]["documentId"] == "doc-billing"
    and kept["technologies"]["documentId"] == "doc-portal",
    (kept["integrationPoints"]["documentId"], kept["technologies"]["documentId"]),
)
ok(
    "the quote is carried for the requestor to check",
    kept["dataClassification"]["quote"].startswith("All customer records are classified"),
)


print("\nan answer the design does not support is dropped")

checked = request_intake.check(
    answers(
        # Plausible, and nowhere in either document. This is the failure the
        # whole check exists for: "Restricted" would be accepted at a glance.
        {
            "field": "dataClassification",
            "value": ["Restricted"],
            "section": "D1/S2",
            "quote": "All customer records are classified Restricted.",
            "page": 2,
        },
        # Real words, but from the other design — checked against D1 they are
        # not there, and a cross-design quote must not be rehomed into a
        # document it was never in.
        {
            "field": "integrationPoints",
            "value": ["SAP and Worldpay"],
            "section": "D1/S1",
            "quote": "The portal calls the SAP billing service over REST, and receives nightly settlement files from Worldpay over SFTP.",
            "page": 1,
        },
    ),
    DESIGNS,
    QUESTIONS,
)
ok("an invented quote proposes nothing", checked.answers == [], checked.answers)
ok("and it is counted rather than lost", sum(checked.dropped.values()) == 2, checked.dropped)


print("\nthe question list is the whole list")

checked = request_intake.check(
    answers(
        {
            "field": "estimatedCost",
            "value": ["250000"],
            "section": "D1/S1",
            "quote": "The Customer Portal is a React single-page application served from Amazon CloudFront, with a Node.js API behind an Application Load Balancer.",
            "page": 1,
        },
        {
            "field": "authMechanism",
            "value": ["OpenID Connect against Entra ID; OAuth 2.0 client credentials for APIs."],
            "section": "D1/S3",
            "quote": "End users authenticate against the corporate Entra ID tenant using OpenID Connect, and API clients use OAuth 2.0 client credentials.",
            "page": 3,
        },
    ),
    DESIGNS,
    QUESTIONS,
)
ok("a field nobody asked for is dropped", list(by_field(checked)) == ["authMechanism"], by_field(checked))
ok("and the drift is named", checked.dropped.get("unknownField") == 1, checked.dropped)
ok("by the name the model used", checked.unknown == ["estimatedCost"], checked.unknown)


print("\na field spelled differently is still that field")

# The question list goes down in the app's camelCase and a model may well answer
# in snake_case. That is the question answered correctly and spelled another
# way; dropping it would throw away a real reading over punctuation. What is
# stored is always the app's own name, because that is the column it is written
# to.
checked = request_intake.check(
    answers(
        {
            "field": "data_classification",
            "value": ["Confidential"],
            "section": "D1/S2",
            "quote": "All customer records are classified Confidential and are held in Amazon Aurora PostgreSQL 15 in eu-west-1.",
            "page": 2,
        },
        {
            "field": "Hosting Environment",
            "value": ["Amazon CloudFront in front of an Application Load Balancer."],
            "section": "D1/S1",
            "quote": "The Customer Portal is a React single-page application served from Amazon CloudFront, with a Node.js API behind an Application Load Balancer.",
            "page": 1,
        },
    ),
    DESIGNS,
    QUESTIONS,
)
kept = by_field(checked)
ok("a snake_case name maps back", "dataClassification" in kept, list(kept))
ok("so does a spaced one", "hostingEnvironment" in kept, list(kept))
ok("nothing was dropped for it", checked.dropped == {}, checked.dropped)
ok("and the respelling is counted", checked.corrected.get("respelledField") == 2, checked.corrected)

# The tolerance must not reach far enough to turn one field into another.
checked = request_intake.check(
    answers(
        {
            "field": "dataStores",
            "value": ["Aurora PostgreSQL"],
            "section": "D1/S2",
            "quote": "Session tokens are cached in Amazon ElastiCache for Redis.",
            "page": 2,
        },
    ),
    DESIGNS,
    [{"field": "dataClassification", "shape": "text", "looksFor": "the sensitivity"}],
)
ok(
    "a different field is still unknown",
    checked.answers == [] and checked.dropped.get("unknownField") == 1,
    checked.dropped,
)


print("\na yes/no question is never answered no")

# The model is told there is no way to answer "no". If it tries anyway — by
# naming the field with nothing to name, or by saying so in the value — the
# answer that reaches the request must still only ever be "yes", because that
# is the only direction a document can evidence. A "no" here would be a
# significance category quietly not triggering.
checked = request_intake.check(
    answers(
        {
            "field": "replacesTechnologyComponent",
            "value": [],
            "section": "D1/S1",
            "quote": "The Customer Portal is a React single-page application served from Amazon CloudFront, with a Node.js API behind an Application Load Balancer.",
            "page": 1,
        },
    ),
    DESIGNS,
    QUESTIONS,
)
kept = by_field(checked)
ok("a yes/no answer with nothing named is still an answer", "replacesTechnologyComponent" in kept)
ok(
    "and it carries no detail rather than a false one",
    kept["replacesTechnologyComponent"]["value"] == "",
    kept.get("replacesTechnologyComponent", {}).get("value"),
)
ok(
    "the proposal shape has no way to express 'no'",
    all(
        answer["value"] != "no" and answer["value"] is not False
        for answer in checked.answers
    ),
)


print("\ndesigns are rendered behind labels a quote can be traced through")

rendered, shortened = request_intake.render_designs(DESIGNS, 10**6)
ok("every design is labelled", "--- Design D1:" in rendered and "--- Design D2:" in rendered)
ok("sections carry their design", "=== D1/S2:" in rendered and "=== D2/S1:" in rendered, rendered[:200])
ok("no bare section label survives", "\n=== S" not in rendered)
ok("nothing was cut at this budget", shortened is False)

tight, cut = request_intake.render_designs(DESIGNS, 1)
ok("a tight budget still labels every design", "=== D2/S1:" in tight)


print("\nthe questions block is what the prompt lists")

asked = request_intake.render_questions(QUESTIONS)
ok("one block per question", asked.count("field: ") == len(QUESTIONS), asked.count("field: "))
ok(
    "the field name is the only thing on its line",
    all(
        line[len("field: "):].strip() in {q["field"] for q in QUESTIONS}
        for line in asked.splitlines()
        if line.startswith("field: ")
    ),
    asked,
)
ok(
    "how to answer is said in prose, not in a tag beside the name",
    "yes-only question" in asked and "list of short names" in asked and "[" not in asked,
    asked,
)
ok(
    "a question with no wording is left out",
    request_intake.render_questions([{"field": "x", "shape": "text"}]) == "",
)


print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
