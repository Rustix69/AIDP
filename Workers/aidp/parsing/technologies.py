"""The technology stack — a workbook whose every row is an approved technology.

A sibling of `registers.py`, and the distinction between them is the whole
reason this file exists.

A standards register states **rules**: `SEC-006 | Identity and Access | All
access must be authenticated...` is an obligation, and a design either meets it
or breaches it. A technology stack states **facts about what is approved**:
`Amazon Redshift | Analytics | Hold | RA3 / Serverless | ...` is not something a
design can comply with. There is no obligation in it at all.

`registers.detect` already refuses the stack template, and says why: the stack
names its rows "Amazon Web Services (AWS)" and describes them under
Justification, so it has no identifier column and no statement column. That
refusal is correct — ingesting a stack as standards would measure every design
against the existence of AWS — but it left the file with nowhere to go. This is
where it goes.

## How a stack is consulted

Not by the clause loop. A standards run walks every clause and pays a model to
reach a verdict on each. A stack is **matched**, and the three things worth
reporting fall straight out of a lookup:

  * a technology the design names that sits on `hold`
  * a technology the design names that is absent from the stack altogether
  * a version outside the row's approved range

None of those needs a model to decide, which is why this parser's job ends at
producing clean rows.

## Status is the column that matters, and here it is populated

The opposite of the registers. All six standards registers ship with a blank
Status column — see the note in `registers.py` — so blank means "not yet
triaged" there and the default is to assess anyway. The stack template ships
with all 215 rows filled, using the four-way radar vocabulary: Adopt, Trial,
Assess, Hold.

So an *unreadable* status here is a genuine anomaly rather than the normal case,
and it resolves to `assess` — the position that asserts least. Defaulting an
unparseable cell to `adopt` would approve a technology nobody approved, and
defaulting it to `hold` would invent a breach.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .tables import Table

#: The four positions a stack takes, lower-cased. The vocabulary is the
#: Thoughtworks radar's, which is what the template's Categories sheet rolls
#: rows up by, so it is the customer's own word for each of these.
STATUSES = ("adopt", "trial", "assess", "hold")

#: What an unreadable or missing status becomes. The position that asserts
#: least — see the module docstring.
DEFAULT_STATUS = "assess"

#: A stack row is identified by its name, because the template has no id
#: column. Everything else may be blank.
_NAME_COLUMNS = (
    "technology name",
    "technology",
    "component name",
    "product name",
    "tool name",
    "component",
    "product",
    "tool",
    "name",
)
_CATEGORY_COLUMNS = ("category", "domain", "layer", "area", "type")
_STATUS_COLUMNS = ("status", "position", "ring", "stance", "adoption")
_VERSION_COLUMNS = (
    "approved version(s)",
    "approved versions",
    "approved version",
    "version(s)",
    "versions",
    "version",
)
_JUSTIFICATION_COLUMNS = ("justification", "rationale", "why", "reason", "purpose")
_SCENARIO_COLUMNS = (
    "scenarios in which this needs to be used",
    "scenarios",
    "scenario",
    "when to use",
    "usage",
    "use cases",
)
_OWNER_COLUMNS = ("owner", "owning team", "accountable", "steward")
_ADDED_COLUMNS = ("added date", "added", "date added")
_REVIEWED_COLUMNS = ("last reviewed date", "last reviewed", "reviewed", "review date")
_NOTES_COLUMNS = ("notes", "note", "comment", "comments")

#: Enough rows to show the sheet means it. Three is the same floor
#: `registers.py` uses, and for the same reason: two rows that happen to say
#: "Adopt" are a coincidence, a dozen are a scheme.
_MIN_ROWS = 3


@dataclass
class Technology:
    """One row: a technology, and this organisation's position on it."""

    name: str
    status: str
    ordinal: int
    category: str = ""
    approved_versions: str = ""
    justification: str = ""
    scenarios: str = ""
    owner: str = ""
    added_date: str = ""
    last_reviewed_date: str = ""
    notes: str = ""


@dataclass
class Stack:
    """A workbook read as a technology stack."""

    sheet: int
    title: str
    technologies: list[Technology] = field(default_factory=list)

    @property
    def counts(self) -> dict[str, int]:
        """How many rows hold each position, for the ingest summary."""
        out = {status: 0 for status in STATUSES}
        for technology in self.technologies:
            out[technology.status] = out.get(technology.status, 0) + 1
        return out


def _norm(text: str) -> str:
    return " ".join(str(text or "").split()).strip().lower()


def _find(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    """The column whose header names one of `candidates`.

    Exact match across the whole candidate list first, then word-boundary
    containment — the same two passes as `registers._find`, and for the same
    reason. "Approved Version(s)" and "Version" can both be present, and
    scanning with containment allowed would let the looser one win on a column
    order that happens to run against us.

    Word boundaries rather than bare substrings matter here too: "name" sits
    inside "Component Namespace", and binding the identity column to a
    namespace would name every technology after its own package prefix.
    """
    normalised = [(column, _norm(column)) for column in columns]
    for candidate in candidates:
        for column, name in normalised:
            if name == candidate:
                return column
    for candidate in candidates:
        pattern = re.compile(rf"\b{re.escape(re.sub(r'[()]', '', candidate))}\b")
        for column, name in normalised:
            if pattern.search(re.sub(r"[()]", "", name)):
                return column
    return None


def _cell(row: dict[str, str | None], column: str | None) -> str:
    if not column:
        return ""
    return " ".join(str(row.get(column) or "").split()).strip()


def read_status(value: str) -> str:
    """One cell as a position, or `DEFAULT_STATUS` where it says nothing known.

    Tolerant of the decorations a spreadsheet picks up — "Adopt", "ADOPT",
    "Adopt " — and deliberately not tolerant of guessing. "Adopt (pilot)" is
    not `adopt`: a cell qualifying its own answer is one a person should look
    at, and `assess` is how this file says "look at it".
    """
    candidate = _norm(value)
    return candidate if candidate in STATUSES else DEFAULT_STATUS


def detect(table: Table) -> dict[str, str | None] | None:
    """The column bindings if this grid is a technology stack, else None.

    Three things have to hold, and the third is what keeps the six standards
    registers out of this path:

      1. a column naming the thing,
      2. a column holding its position,
      3. **enough rows whose position is actually one of the four.**

    The registers all carry a Status column, so (1) and (2) alone would match
    them — "Standard Name" binds, "Status" binds — and every security standard
    would be ingested as a technology. What they do not carry is a *populated*
    Status: the column is blank in all 170 rows. So the vocabulary check is the
    discriminator, and it is checked against the rows rather than the header,
    because a header can be called anything.

    The template's own Categories roll-up sheet is excluded by (2): its columns
    are Category, Adopt, Trial, Assess, Hold, Total — the positions are column
    *headers* there, not values, and there is no status column to bind.
    """
    if table.is_empty:
        return None

    columns = list(table.columns)
    name = _find(columns, _NAME_COLUMNS)
    status = _find(columns, _STATUS_COLUMNS)
    if not name or not status:
        return None

    named = [row for row in table.rows if _cell(row, name)]
    if len(named) < _MIN_ROWS:
        return None

    positioned = sum(1 for row in named if _norm(_cell(row, status)) in STATUSES)
    if positioned < _MIN_ROWS or positioned < len(named) / 2:
        return None

    return {
        "name": name,
        "status": status,
        "category": _find(columns, _CATEGORY_COLUMNS),
        "versions": _find(columns, _VERSION_COLUMNS),
        "justification": _find(columns, _JUSTIFICATION_COLUMNS),
        "scenarios": _find(columns, _SCENARIO_COLUMNS),
        "owner": _find(columns, _OWNER_COLUMNS),
        "added": _find(columns, _ADDED_COLUMNS),
        "reviewed": _find(columns, _REVIEWED_COLUMNS),
        "notes": _find(columns, _NOTES_COLUMNS),
    }


def read(tables: list[Table], *, sheet_names: dict[int, str] | None = None) -> Stack | None:
    """The first grid in the workbook that is a technology stack, read whole.

    Duplicate names collapse to the first occurrence. The database makes
    (document, name) unique — the name is the only identity a stack row has —
    so a sheet listing "Redis" twice has to resolve here rather than failing
    the whole ingest on a constraint. First wins because the sheet is read top
    to bottom and the first statement of a position is the one a reader meets.
    """
    for table in tables:
        binding = detect(table)
        if binding is None:
            continue

        technologies: list[Technology] = []
        seen: set[str] = set()
        for row in table.rows:
            name = _cell(row, binding["name"])
            if not name:
                continue
            key = name.lower()
            if key in seen:
                continue
            seen.add(key)
            technologies.append(
                Technology(
                    name=name,
                    status=read_status(_cell(row, binding["status"])),
                    ordinal=len(technologies) + 1,
                    category=_cell(row, binding["category"]),
                    approved_versions=_cell(row, binding["versions"]),
                    justification=_cell(row, binding["justification"]),
                    scenarios=_cell(row, binding["scenarios"]),
                    owner=_cell(row, binding["owner"]),
                    added_date=_cell(row, binding["added"]),
                    last_reviewed_date=_cell(row, binding["reviewed"]),
                    notes=_cell(row, binding["notes"]),
                )
            )

        if len(technologies) < _MIN_ROWS:
            continue

        names = sheet_names or {}
        return Stack(
            sheet=table.page_start,
            title=(table.caption or names.get(table.page_start) or "").strip(),
            technologies=technologies,
        )

    return None
