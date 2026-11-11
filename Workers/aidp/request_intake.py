"""Filling in an architecture request's structured questions from its designs.

The brief's intake model asks a requestor for twenty-odd answers before a review
can start, and eight of them — the technologies, the integrations, the
authentication, the data stores, their classification, where it is hosted — are
facts their design document already states. Asking for them again is the
data-entry problem the product exists to remove, and the brief says so itself:
Group C is "auto-extracted from the diagram and shown for confirmation".

This is the extraction. The confirmation is a person, in the wizard.

What this is careful about
--------------------------
**It proposes; it never answers.** Nothing written here is read by the
significance check, by the renderer, or by the report. The rows go into
`intake_reading`, the requestor accepts what they agree with, and accepting is
what writes the ordinary column on `architecture_request`. The classification
that decides whether a human reviews a submission therefore rests on what a
person stated, which is the only footing it can defend at a review board.

**Every answer quotes the design, and the quote is checked.** The same rule, and
the same checker, as the suggestions and the technology reading: `_checked_quote`
finds the words in the section the model named, or in the one other section they
really live in, or the answer is dropped. An answer nobody can trace to the
design is an answer the model made up, and this one would be made up *into a
form somebody signs*.

**"No" is never proposed.** Three of the questions are yes/no, and only "yes"
can be read from a document. A design that does not mention replacing anything
is not a design that replaces nothing; it is a design that did not say. Since a
"no" is also the answer that stops a significance category triggering, inferring
one from silence would quietly route a submission away from a reviewer. The
model is told there is no way to answer "no", and `check` drops one if it tries.

**The questions come from the app.** They arrive on the job payload rather than
being listed here, so the field names, their shapes and their wording have one
definition — src/lib/ingest/reading-vocabulary.ts — instead of two in different
languages that drift apart the first time a question is reworded.

A reading never fails the request. The row records what went wrong and the
wizard asks the questions the ordinary way.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field as dataclass_field

from psycopg.types.json import Jsonb

from . import cache, coverage, db, logs, usage, whole_document
from .ai import llm
from .config import get_config

log = logs.get(__name__)

VERSION = 1

#: Kept from one reading. There are nine questions; a reply with more entries
#: than this is not an answer sheet.
MAX_ANSWERS = 24

#: The most a proposed text answer may run to. Two sentences, which is what the
#: prompt asks for — a reviewer confirming an answer at a glance cannot be shown
#: half a page.
MAX_VALUE_CHARS = 600

#: And for one item of a list answer: a technology name, not a description.
MAX_ITEM_CHARS = 120

#: Items in a list answer. `updateRequest` caps the stored list at 40; this is
#: the same ceiling, applied before the proposal is shown rather than silently
#: at the moment it is accepted.
MAX_ITEMS = 40

#: Below this there is nothing to read. A design whose sections total less than
#: a paragraph has not been parsed into anything a quote can be found in.
MIN_DESIGN_CHARS = 200

_SECTION_LABEL = re.compile(r"^\s*D(\d+)\s*/\s*S(\d+)\s*$")


@dataclass
class Design:
    """One attached design, loaded and ready to be quoted against."""

    index: int
    document_id: str
    title: str
    sections: list[coverage.Section]
    whole: whole_document.WholeDocument

    @property
    def by_ordinal(self) -> dict[int, coverage.Section]:
        return {section.ordinal: section for section in self.sections}


@dataclass
class Checked:
    answers: list[dict] = dataclass_field(default_factory=list)
    dropped: dict[str, int] = dataclass_field(default_factory=dict)
    corrected: dict[str, int] = dataclass_field(default_factory=dict)
    #: The field names that were not on the question list, as the model spelled
    #: them. Named rather than only counted: "six answers were dropped" and
    #: "six answers came back in snake_case" look identical in a counter, and
    #: only one of them is a prompt that needs rewording.
    unknown: list[str] = dataclass_field(default_factory=list)

    def drop(self, reason: str) -> None:
        self.dropped[reason] = self.dropped.get(reason, 0) + 1

    def correct(self, reason: str) -> None:
        self.corrected[reason] = self.corrected.get(reason, 0) + 1


def _key(name: str) -> str:
    """A field name with the spelling taken out of it.

    The question list goes down to the model in the app's own camelCase, and a
    model that answers `integration_points` has understood the question
    perfectly and spelled it the way its training data spells things. Dropping
    that answer would throw away a correct reading over punctuation — so names
    are matched with case and separators removed, which maps every spelling of
    one field onto that field and still has no way to turn one field into
    another.
    """
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def _load_designs(conn, rows: list[dict]) -> list[Design]:
    """Each attached design, section by section, skipping any with nothing in it.

    A design still being parsed has no `source_line` rows, so `coverage._load`
    returns nothing for it. It is left out rather than failing the reading: the
    app only queues one for designs it believes are ready, and a race between
    the two should cost an answer, not the whole reading.
    """
    out: list[Design] = []
    for row in rows:
        sections, whole = coverage._load(conn, row["id"])
        if whole is None or not sections:
            continue
        if sum(len(section.text) for section in sections) < MIN_DESIGN_CHARS:
            continue
        out.append(
            Design(
                index=len(out) + 1,
                document_id=row["id"],
                title=row.get("title") or "",
                sections=sections,
                whole=whole,
            )
        )
    return out


def render_designs(designs: list[Design], budget: int) -> tuple[str, bool]:
    """Every design behind a "D1/S4" label. (text, was anything shortened?)

    `coverage.render_design` already renders one design and already decides what
    to cut when it will not fit; this gives each an equal share of the budget
    and re-labels its sections so a quote can be traced back to the document it
    came from. Anchored at the start of a line so a section heading quoted
    inside a body is not mistaken for one.
    """
    if not designs:
        return "", False
    share = max(2_000, budget // len(designs))
    blocks: list[str] = []
    shortened = False
    for design in designs:
        text, cut = coverage.render_design(design.sections, share)
        shortened = shortened or cut
        text = re.sub(r"(?m)^=== S(\d+): ", rf"=== D{design.index}/S\1: ", text)
        blocks.append(f"--- Design D{design.index}: {design.title} ---\n{text}")
    return "\n\n".join(blocks), shortened


#: How each shape is described to the model. Prose rather than a bracketed tag:
#: the first version wrote "technologies [list] — ..." and the reply came back
#: naming the field "technologies [list]", because the prompt tells the model to
#: copy the field name exactly and the tag was sitting inside it. The name is
#: now the only thing on its line that could be a name.
_SHAPE_WORDS = {
    "list": "answer with a list of short names",
    "yes": "a yes-only question: answer it only if the design states it outright",
    "text": "answer with one or two sentences",
}


def render_questions(questions: list[dict]) -> str:
    """The questions as the prompt lists them, two lines each.

    The field name sits alone on its line behind "field:", so that "copy the
    field name exactly" has exactly one thing it can mean.
    """
    blocks = []
    for question in questions:
        name = str(question.get("field") or "").strip()
        shape = str(question.get("shape") or "text").strip()
        asks = " ".join(str(question.get("looksFor") or "").split())
        if not name or not asks:
            continue
        how = _SHAPE_WORDS.get(shape, _SHAPE_WORDS["text"])
        blocks.append(f"field: {name}\n  asks for: {asks}\n  how: {how}")
    return "\n\n".join(blocks)


def _value(item: dict, shape: str) -> list[str] | str | None:
    """The answer in the shape the field stores, or None when there is not one."""
    raw = item.get("value")
    items = [" ".join(str(part or "").split()) for part in raw] if isinstance(raw, list) else []
    items = [part for part in items if part]

    if shape == "list":
        trimmed = [part[:MAX_ITEM_CHARS] for part in items][:MAX_ITEMS]
        return trimmed or None
    if shape == "yes":
        # A yes/no answer *is* the flag; what the design named is the detail,
        # and a yes with nothing named is still a yes.
        return items[0][:MAX_ITEM_CHARS] if items else ""
    text = " ".join(items)
    return text[:MAX_VALUE_CHARS] if text else None


def check(raw: dict, designs: list[Design], questions: list[dict]) -> Checked:
    """Keep the answers the designs bear out, and count the rest.

    The counts are not decoration: a reading that proposed nothing because every
    quote failed and a reading that proposed nothing because the designs say
    nothing look identical from the app, and only one of them is a bug.
    """
    # Keyed by the spelling-free form, and carrying the app's own spelling as
    # the value: whatever the model called a field, what gets stored is the name
    # the app asked for, because that is the column it will be written to.
    shapes = {
        _key(question.get("field")): (
            str(question.get("field")),
            str(question.get("shape") or "text"),
        )
        for question in questions
        if question.get("field")
    }
    by_index = {design.index: design for design in designs}
    out = Checked()
    seen: set[str] = set()

    items = raw.get("answers") if isinstance(raw.get("answers"), list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        given = str(item.get("field") or "").strip()
        match = shapes.get(_key(given))
        if match is None:
            # A field nobody asked for. The app would drop it too; naming it
            # here is what says the prompt and the catalogue have drifted.
            out.drop("unknownField")
            if given and given not in out.unknown:
                out.unknown.append(given[:60])
            continue
        name, shape = match
        if given != name:
            out.correct("respelledField")
        if name in seen:
            out.drop("duplicate")
            continue

        match = _SECTION_LABEL.match(str(item.get("section") or ""))
        if not match:
            out.drop("unreadableSection")
            continue
        design = by_index.get(int(match.group(1)))
        section = design.by_ordinal.get(int(match.group(2))) if design else None
        if design is None or section is None:
            out.drop("unknownSection")
            continue

        if not " ".join(str(item.get("quote") or "").split()):
            out.drop("missingQuote")
            continue
        # Four values, and the fourth matters: `_checked_quote` will rehome a
        # quote that turns out to live in exactly one other section, and taking
        # its answer is what keeps the citation on the section the words are
        # really in. See the same unpacking in lifecycle.py.
        quote, page, reason, home = _checked_quote(
            item, section, design.whole, design.sections
        )
        if quote is None:
            out.drop(reason or "unquoted")
            continue
        section = home

        value = _value(item, shape)
        if value is None:
            out.drop("emptyValue")
            continue

        seen.add(name)
        pages = sorted(section.pages)
        out.answers.append(
            {
                "field": name,
                "value": value,
                "documentId": design.document_id,
                "documentTitle": design.title[:300],
                "section": (section.heading_path or section.title)[:300],
                "page": page if page is not None else (pages[0] if pages else section.page_start),
                "quote": quote[:1000],
            }
        )
        if len(out.answers) >= MAX_ANSWERS:
            break

    return out


def _checked_quote(item, section, whole, sections):
    """`coverage._checked_quote`, named here so the import reads as a borrowing.

    Imported through the function rather than at module scope because it is a
    private name in another module: pulling it in at the top would make it look
    like part of this module's own surface.
    """
    from .coverage import _checked_quote as borrowed

    return borrowed(item, section, whole, sections)


def _designs_of(conn, request: dict) -> list[dict]:
    """The request's attached designs, newest last, minus its own rendered form.

    The rendered answers are a design by every column that matters — role
    "assessed", in the project, indexed — and reading them would propose the
    request's own answers back to it as though a document had said them.
    """
    return db.query(
        conn,
        """
        SELECT "id", "title"
          FROM "document"
         WHERE "projectId" = %(project)s
           AND "organisationId" = %(org)s
           AND "role" = 'assessed'
           AND "status" = 'ready'
           AND (%(own)s::text IS NULL OR "id" <> %(own)s)
         ORDER BY "createdAt", "id"
        """,
        {
            "project": request["projectId"],
            "org": request["organisationId"],
            "own": request.get("documentId"),
        },
    )


def _fail(conn, reading_id: str, reason: str) -> None:
    db.execute(
        conn,
        'UPDATE "intake_reading" SET "state" = %s, "error" = %s, "updatedAt" = now() '
        'WHERE "id" = %s',
        ("failed", reason[:1000], reading_id),
    )


def record(request_id: str, questions: list[dict]) -> dict:
    """Read this request's designs and store what they answer.

    Never raises for an ordinary shortfall — no key, no designs, nothing
    readable — because every one of those is a sentence the requestor should see
    on the screen rather than a job the queue retries five times. A provider
    that cannot be reached *does* raise, so the queue's backoff gets its turn.
    """
    with db.connection() as conn:
        reading = db.one(
            conn,
            'SELECT * FROM "intake_reading" WHERE "requestId" = %s',
            (request_id,),
        )
        if reading is None:
            # The requestor discarded it, or the request went with it. Nothing
            # to write and nothing wrong.
            return {"state": "gone"}
        request = db.one(
            conn,
            'SELECT "id", "organisationId", "projectId", "documentId" '
            'FROM "architecture_request" WHERE "id" = %s',
            (request_id,),
        )
        if request is None:
            _fail(conn, reading["id"], "That request no longer exists.")
            return {"state": "failed"}

        rows = _designs_of(conn, request)
        designs = _load_designs(conn, rows)

    if not llm.available():
        with db.connection() as conn:
            _fail(
                conn,
                reading["id"],
                "No model API key is configured, so the designs could not be read. "
                "Answer the questions below instead.",
            )
        return {"state": "failed"}

    if not designs:
        with db.connection() as conn:
            _fail(
                conn,
                reading["id"],
                "There was nothing readable in the attached designs yet. Wait for them to "
                "finish being read, or answer the questions below instead.",
            )
        return {"state": "failed"}

    asked = render_questions(questions)
    if not asked:
        with db.connection() as conn:
            _fail(conn, reading["id"], "No questions were sent with this reading.")
        return {"state": "failed"}

    cfg = get_config()
    budget = max(20_000, cfg.whole_document_max_tokens * whole_document.CHARS_PER_TOKEN - len(asked))
    rendered, shortened = render_designs(designs, budget)

    organisation = request["organisationId"]
    provider, model = llm.model_name()

    # Reused for an unchanged submission, exactly as the suggestions and the
    # technology reading are: the same designs and the same questions give the
    # same answers, and a requestor who presses the button twice should not pay
    # twice. The key is the designs' full text, so attaching one misses.
    key = None
    if cfg.advice_cache_days > 0 and organisation:
        full, _ = render_designs(designs, 10**9)
        key = cache.fingerprint(
            "intake",
            str(VERSION),
            provider,
            model,
            llm.intake_prompt_identity(),
            asked,
            full,
        )
    stored = (
        cache.get_payload(organisation, cache.INTAKE, key, max_age_days=cfg.advice_cache_days)
        if key
        else None
    )
    cached = stored.payload.get("raw") if stored else None

    if isinstance(cached, dict):
        raw = cached
        source = "cache"
    else:
        raw = llm.read_intake(designs=rendered, questions=asked)
        source = "model"
        if key:
            cache.put_payload(
                organisation,
                cache.INTAKE,
                key,
                model=model,
                payload={"raw": raw},
                cost_tokens=usage.estimate_tokens(rendered + asked),
            )

    checked = check(raw, designs, questions)

    with db.connection() as conn:
        db.execute(
            conn,
            """
            UPDATE "intake_reading"
               SET "state"     = 'ready',
                   "proposals" = %s,
                   "model"     = %s,
                   "error"     = NULL,
                   "updatedAt" = now()
             WHERE "id" = %s
            """,
            (Jsonb(checked.answers), model, reading["id"]),
        )

    logs.info(
        log,
        "intake read from the attached designs",
        requestId=request_id,
        designs=len(designs),
        proposed=len(checked.answers),
        dropped=sum(checked.dropped.values()),
        reasons=checked.dropped or None,
        corrected=checked.corrected or None,
        unknownFields=checked.unknown or None,
        truncated=shortened,
        extraction=source,
    )
    return {
        "state": "ready",
        "proposed": len(checked.answers),
        "dropped": checked.dropped,
    }
