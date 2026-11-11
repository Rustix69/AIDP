"""The standards register — a workbook whose every row is already a standard.

The other three formats hand us prose and ask us to find the rules inside it. A
PDF lost its structure at export and it gets rebuilt from typography; a deck
states a structure that is not the one we need; a Word file labels its parts and
sometimes lies about them. All three end at the same place: a model, or a
heuristic, deciding where one rule stops and the next begins.

A register has already made that decision. `SEC-006 | Identity and Access |
Authentication Standards | | All access must be authenticated... | Passwords
alone are insufficient... | Identity & Access Management Team` is one standard,
stated as one row, with its parts in named columns. Nothing has to be inferred,
so nothing here infers. That matters beyond cost: every clause the model path
produces is a judgement that can be wrong in a way nobody notices until a report
cites a heading as if it were a rule, and the register is the one input shape
where we can be *certain* instead.

**One row becomes one section, not one clause.** This looks like the wrong grain
until you follow where a citation comes from: `_reference` in the analyse stage
reads `numberText` off the *section*, because a decision anchored to a clause has
to keep finding it after the clause has been sharpened and replaced. A clause
carries no number of its own. So putting all thirty-six security standards in one
section would make every finding in the report cite the same string — the exact
failure `_reference` documents for a ten-principle integration table. One section
per row, numbered with the register's own `SEC-006`, is what makes the report
quotable.

**What the register does not carry is requirements.** The source documents these
were distilled from state three or four testable obligations under each standard;
the register keeps the statement and drops them. A statement-only clause is a
real clause — `is_empty` is false, it retrieves, it gets judged — but it gets
judged less sharply, and the honest place to fix that is `ClauseDraft`
sharpening, which exists for precisely this shape and calls it "the commonest
shape in a half-written library". We do not invent requirements here by splitting
the statement into sentences: a one-sentence statement would become one
requirement identical to itself, which reads in the report as though the parser
found something it did not.

**Status is kept, not acted on.** The column is empty in every row of all six
registers the client supplied, and each workbook's own Assumptions sheet says it
is meant to hold `Mandatory` or `Recommended`. Blank therefore means "not yet
triaged" rather than "not applicable", and the default is to assess it — a
standard nobody has classified is still a standard. The raw value travels into
`sourceRefs.register` so that the day those cells get filled in, the scoping
decision is a query rather than a re-ingest.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import clauses as clause_parser
from . import rules
from .clauses import Clause
from .sections import Section
from .spans import Line
from .tables import Table

#: What a blank Status means. See the module docstring: blank is "not yet
#: triaged", and an untriaged standard is still assessed.
DEFAULT_STATUS = "adopted"

# Column vocabularies. The client's six registers all use the first name in each
# tuple; the rest are there so a register from another customer, or a later
# revision of these, does not need a code change to be read.
#
# Matched on word boundaries rather than as bare substrings, which is not
# fussiness: "id" appears inside "guidance", and a Guidance column silently
# taken for the identifier would number every standard after its own advice.
_ID_COLUMNS = ("standard id", "control id", "requirement id", "ref id", "id", "ref")
_NAME_COLUMNS = ("standard name", "control name", "principle name", "name", "title")
_STATEMENT_COLUMNS = (
    "standard statement",
    "statement",
    "control statement",
    "requirement",
    "description",
)
_RATIONALE_COLUMNS = ("rationale", "intent", "purpose", "why")
_CATEGORY_COLUMNS = ("category", "domain", "control area", "area", "theme")
_STATUS_COLUMNS = ("status", "applicability", "adoption")
_OWNER_COLUMNS = ("owner", "accountable", "owning team")
_NOTES_COLUMNS = ("notes", "note", "comment", "comments")
# The testable obligations under a standard — the half a statement does not
# carry. "Implications" is TOGAF's word for the same field and is matched for
# the same reason `clauses._LABELS` matches it: a TOGAF-worded register would
# otherwise land every obligation in the rationale.
_REQUIREMENTS_COLUMNS = (
    "requirements",
    "requirement",
    "obligations",
    "obligation",
    "implications",
    "implication",
    "controls",
    "acceptance criteria",
)

#: A register identifier: "SEC-001", "DAT-028", "INF-1", "EA_7". Deliberately
#: not matching a bare number — a "#" column counting rows from one is an
#: ordinal, not an identity, and reusing it as a citation would make two
#: different registers both cite "1".
_ID_VALUE = re.compile(r"^[A-Za-z]{2,8}[-_ ]?\d{1,4}$")

#: Below this the grid is not a register. Three rows that all carry a prefixed
#: identifier is a deliberate scheme; one or two is a coincidence.
_MIN_ROWS = 3


@dataclass
class Standard:
    """One row, resolved into the parts the rest of the pipeline reads."""

    identifier: str
    name: str
    category: str
    statement: str
    rationale: str
    status: str
    owner: str
    notes: str
    sheet: int
    #: The testable obligations, one per entry. Empty when the register states
    #: none — which is not the same as a standard having none, and is why the
    #: parse reports it rather than letting a thin report look like a thin
    #: design. See `Register.without_requirements`.
    requirements: list[str] = field(default_factory=list)


@dataclass
class Register:
    """A workbook read as a standards register."""

    standards: list[Standard] = field(default_factory=list)
    #: The sheet the register was found on, so the caller can leave the
    #: workbook's other sheets to the ordinary path.
    sheet: int = 1
    #: The register's own name for itself — the sheet title, which in these
    #: workbooks is "Security Standards" rather than "Sheet1".
    title: str | None = None
    #: Rows that looked like standards but carried no statement. Reported, not
    #: dropped in silence: a register row with an empty statement cell is a
    #: standard somebody has not written yet, and the library should say so.
    incomplete: list[str] = field(default_factory=list)
    #: Whether the sheet had a Requirements column at all. False means the
    #: register cannot state obligations; True with empty cells means somebody
    #: left them blank. The two are different problems and read differently in
    #: the ingest report.
    has_requirements_column: bool = False

    @property
    def without_requirements(self) -> list[str]:
        """Standards stating no obligation, so judged on their statement alone."""
        return [s.identifier for s in self.standards if not s.requirements]


def _norm(text: str) -> str:
    return " ".join(str(text or "").split()).strip().lower()


def _find(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    """The column whose header names one of `candidates`.

    Exact match first, across the whole candidate list, before any fuzzy match
    is tried. A register with both "Standard Statement" and "Statement of
    Applicability" must bind to the one it actually named, and scanning
    candidates in order with containment allowed would let the second win on a
    column list that happens to be ordered against us.
    """
    normalised = [(column, _norm(column)) for column in columns]
    for candidate in candidates:
        for column, name in normalised:
            if name == candidate:
                return column
    for candidate in candidates:
        pattern = re.compile(rf"\b{re.escape(candidate)}\b")
        for column, name in normalised:
            if pattern.search(name):
                return column
    return None


def _cell(row: dict[str, str | None], column: str | None) -> str:
    if not column:
        return ""
    return " ".join(str(row.get(column) or "").split()).strip()


def _cell_lines(row: dict[str, str | None], column: str | None) -> str:
    """The same cell with its line breaks kept, whitespace collapsed within each.

    A Requirements cell says how many obligations it holds by how many lines it
    uses, and `_cell` would flatten four of them into one run-on string. The
    sentence fallback in `clauses._items` would then re-split it on full stops,
    which is right for a cell written as prose and wrong for one written as a
    list — "Access must be revoked within 1 business day. Dormant accounts
    disabled after 90 days." is two obligations either way, but
    "Encrypt at rest using AES-256 (FIPS 140-2 validated)" is one, and a stop
    inside it would become two.
    """
    if not column:
        return ""
    raw = str(row.get(column) or "")
    return "\n".join(" ".join(part.split()) for part in raw.splitlines() if part.strip())


def detect(table: Table) -> dict[str, str | None] | None:
    """The column bindings if this grid is a standards register, else None.

    Three things have to hold, and the third is what keeps the Technology Stack
    template out: a column of prefixed identifiers, a column of statements, and
    enough rows carrying an identifier that the scheme is evidently deliberate.
    The stack template has a Category, a Status, an Owner and Notes — four of
    the register's eight columns — but it names its rows "Amazon Web Services
    (AWS)" and describes them under Justification. It is a catalogue of
    technologies, not a set of rules, and ingesting it as standards would
    measure every design against the existence of AWS.
    """
    if table.is_empty:
        return None

    columns = list(table.columns)
    identifier = _find(columns, _ID_COLUMNS)
    statement = _find(columns, _STATEMENT_COLUMNS)
    if not identifier or not statement:
        return None

    carried = sum(1 for row in table.rows if _ID_VALUE.match(_cell(row, identifier)))
    if carried < _MIN_ROWS or carried < len(table.rows) / 2:
        return None

    return {
        "id": identifier,
        "name": _find(columns, _NAME_COLUMNS),
        "category": _find(columns, _CATEGORY_COLUMNS),
        "statement": statement,
        "rationale": _find(columns, _RATIONALE_COLUMNS),
        "status": _find(columns, _STATUS_COLUMNS),
        "owner": _find(columns, _OWNER_COLUMNS),
        "notes": _find(columns, _NOTES_COLUMNS),
        # Optional, unlike the two above it. A register without this column is
        # still a register; it just states no obligations, and the parse says so.
        "requirements": _find(columns, _REQUIREMENTS_COLUMNS),
    }


def read(tables: list[Table], *, sheet_names: dict[int, str] | None = None) -> Register | None:
    """The first grid in the workbook that is a register, read whole.

    First rather than largest, and only one. These workbooks carry a register
    sheet plus a Categories roll-up and an Assumptions note, and the roll-up is
    a grid too — but it counts standards rather than stating them, and it has no
    identifier column, so `detect` turns it down before this has to choose.
    """
    for table in tables:
        binding = detect(table)
        if not binding:
            continue

        register = Register(
            sheet=table.page_start,
            has_requirements_column=bool(binding["requirements"]),
        )
        if sheet_names:
            register.title = sheet_names.get(table.page_start)

        for row in table.rows:
            identifier = _cell(row, binding["id"])
            if not _ID_VALUE.match(identifier):
                # A continuation row, a blank separator, or a total. Not a
                # standard, and not an error either.
                continue
            statement = _cell(row, binding["statement"])
            if not statement:
                register.incomplete.append(identifier)
                continue
            register.standards.append(
                Standard(
                    identifier=identifier,
                    name=_cell(row, binding["name"]),
                    category=_cell(row, binding["category"]),
                    statement=statement,
                    rationale=_cell(row, binding["rationale"]),
                    status=_cell(row, binding["status"]) or DEFAULT_STATUS,
                    owner=_cell(row, binding["owner"]),
                    notes=_cell(row, binding["notes"]),
                    sheet=table.page_start,
                    requirements=clause_parser._items(  # noqa: SLF001 — same package
                        _cell_lines(row, binding["requirements"])
                    ),
                )
            )

        if register.standards:
            return register
    return None


def _line(text: str, sheet: int, y: float) -> Line:
    return Line(
        text=text,
        page=sheet,
        y=y,
        x0=0.0,
        bbox=(0.0, y, 0.0, y),
        sig=("sheet", 11.0, False, False, 0),
    )


def build(register: Register, document_title: str) -> tuple[list[Section], dict[int, list[Clause]]]:
    """Sections and clauses, one of each per standard.

    The section carries the identity — `SEC-006` as `numberText`, which is what
    a finding cites and what a decision anchors to — and the clause carries the
    content. `headingPath` keeps the category so that retrieval and the library
    screen can still group by it; no parent section is created for the category
    itself, because an Identity and Access heading with no text of its own would
    be reported as an empty section on every one of these documents.
    """
    sections: list[Section] = []
    clauses: dict[int, list[Clause]] = {}
    book = document_title or "Standards"

    for index, standard in enumerate(register.standards):
        title = standard.name or standard.identifier
        crumbs = [book]
        if standard.category:
            crumbs.append(standard.category)
        crumbs.append(f"{standard.identifier} {title}".strip())

        body = [standard.statement]
        if standard.rationale:
            body.append(standard.rationale)

        section = Section(
            ordinal=index + 1,
            number_text=standard.identifier,
            title=title,
            depth=1,
            heading_path=" › ".join(crumbs),
            page_start=standard.sheet,
            page_end=standard.sheet,
            lines=[_line(text, standard.sheet, float(index)) for text in body],
            y_start=float(index),
        )
        sections.append(section)

        clauses[index] = [
            Clause(
                ordinal=1,
                title=title,
                statement=standard.statement,
                rationale=standard.rationale,
                # Whatever the register stated, and nothing more. Where it
                # states none this stays empty on purpose: manufacturing
                # obligations from the statement would put words in the
                # standard's mouth, and a design would then be failed against a
                # rule its author never wrote. See the module docstring.
                requirements=standard.requirements,
                guidance=[],
                page_start=standard.sheet,
                page_end=standard.sheet,
                origin="register",
                source={
                    "register": {
                        "id": standard.identifier,
                        "category": standard.category,
                        "status": standard.status,
                        "owner": standard.owner,
                        "notes": standard.notes,
                    }
                },
            )
        ]

    return sections, clauses


def source_lines(
    register: Register, book, sheet_sections: dict[int, int]
) -> list[rules.SourceLine]:
    """The document's numbered lines, which is what the parsed view reads back.

    Every other format fills this in, and a register that did not left the
    parsed-content screen blank: `sectionContent` reads its lines from
    `source_line`, so with no rows written, opening a standard showed its clause
    and nothing else, and opening the Assumptions sheet showed nothing at all —
    which is the one sheet recording where these standards came from and which
    of them are proposals rather than policy.

    The register's own grid is deliberately *not* emitted here. Its rows are
    already the clauses; writing them again as table lines would put every
    statement in the index twice and let one fact answer as two independent
    pieces of evidence — the duplication `sheets.py` avoids by not re-emitting
    table rows as prose.
    """
    out = rules._Builder()  # noqa: SLF001 — same package, as parse.py does

    for index, standard in enumerate(register.standards):
        heading = f"{standard.identifier} {standard.name}".strip()
        out.text(heading, kind="heading", page=standard.sheet, section=index, depth=1)
        out.text(standard.statement, kind="text", page=standard.sheet, section=index)
        if standard.rationale:
            out.text(standard.rationale, kind="text", page=standard.sheet, section=index)
        # One line each, as bullets. A reviewer checking a finding needs to see
        # the obligation it was judged against on its own, not folded into a
        # paragraph with the other three.
        for requirement in standard.requirements:
            out.text(
                f"• {requirement}", kind="bullet", page=standard.sheet, section=index
            )

    # The workbook's other sheets, in sheet order, each under its own section.
    for sheet in sorted(sheet_sections):
        section = sheet_sections[sheet]
        for position, line in enumerate(book.lines):
            if line.page != sheet:
                continue
            hint = str(book.hints.get(position, ""))
            out.text(
                line.text,
                kind="heading" if hint in ("sheet", "title") else "text",
                page=sheet,
                section=section,
            )
        for table in book.tables:
            if table.page_start == sheet:
                out.table(table, section=section)

    return out.lines
