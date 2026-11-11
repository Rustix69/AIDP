"""The standards register: every row a standard, and nothing inferred.

The client's six registers (Security, Data, Infrastructure, Integration,
Solution Architecture, Enterprise Architecture) all state 170 standards between
them in one shape — `Standard ID | Category | Standard Name | Status | Standard
Statement | Rationale | Owner | Notes`. Before this path existed a register
ingested to *zero* clauses: `_parse_workbook` indexed the grid as a table and
never ran clause extraction, so the framework came back empty and the assessment
died on "The framework contains no clauses."

The cases below are the ones that decide whether a register is usable, not
merely parsed:

1. **One section per row, numbered by the register's own id.** `_reference`
   reads `numberText` off the section, so getting this wrong does not lose data
   — it makes all thirty-six security findings cite the same string.
2. **The Technology Stack template must not be read as standards.** It shares
   four of the eight column names. It is a catalogue of technologies, and taken
   for a register it would measure every design against the existence of AWS.
3. **The Categories roll-up must not win over the register.** Both sheets are
   grids, and the roll-up appears in every one of these workbooks.
4. **"id" is a substring of "guidance".** A Guidance column taken for the
   identifier would number every standard after its own advice.

    docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse \\
      -e DATABASE_URL=postgresql://nobody@127.0.0.1:1/none \\
      --entrypoint python aidp-worker-test tests/test_standards_register.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.parsing import registers  # noqa: E402
from aidp.parsing.tables import Table  # noqa: E402

passed = failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


def table(columns: list[str], rows: list[list[str | None]], *, sheet: int = 1, caption="") -> Table:
    return Table(
        page_start=sheet,
        page_end=sheet,
        bbox=(0.0, 0.0, float(len(columns)), float(len(rows))),
        columns=columns,
        rows=[{columns[i]: row[i] if i < len(row) else None for i in range(len(columns))}
              for row in rows],
        caption=caption,
    )


class _EmptyBook:
    """A workbook with no sheets beside the register, for the source-line tests."""

    lines: list = []
    hints: dict = {}
    tables: list = []


REGISTER_COLUMNS = [
    "Standard ID", "Category", "Standard Name", "Status",
    "Standard Statement", "Rationale", "Owner", "Notes",
]

SECURITY = table(
    REGISTER_COLUMNS,
    [
        ["SEC-001", "Security Governance", "Security Governance Framework", None,
         "The organization must operate under a formally approved information security framework.",
         "Keeps decisions consistent and traceable to approved risk appetite.",
         "Security Engineering", None],
        ["SEC-006", "Identity and Access", "Authentication Standards", None,
         "All access must be authenticated appropriately to sensitivity, with MFA for "
         "privileged and remote access.",
         "Passwords alone are insufficient against credential attacks.",
         "Identity & Access Management Team", None],
        ["SEC-009", "Network Security", "Network Segmentation and Zoning", "Recommended",
         "Networks must be segmented into security zones by trust and sensitivity.",
         "Contains the blast radius of a compromise.",
         "Network Engineering", "Reviewed 2026-08"],
    ],
    caption="Security Standards",
)

# The roll-up that sits on sheet 2 of every one of these workbooks.
CATEGORIES = table(
    ["Category", "Mandatory", "Recommended", "Total"],
    [["Security Governance", "0", "0", "0"], ["Identity and Access", "0", "0", "0"]],
    sheet=2,
    caption="Categories",
)

# The stack template: same Category / Status / Owner / Notes, no identifiers,
# no statements.
STACK = table(
    ["Technology Name", "Category", "Status", "Approved Version(s)", "Justification",
     "Owner", "Added Date", "Notes"],
    [
        ["Amazon Web Services (AWS)", "Cloud Provider", "Adopt", "N/A (managed)",
         "Single strategic public cloud.", "Cloud Platform Team", "2026-01-19", None],
        ["AWS Organizations & Control Tower", "Cloud Provider", "Adopt", "N/A (managed)",
         "Multi-account governance with guardrails.", "Cloud Platform Team", "2026-02-13", None],
        ["PostgreSQL", "Database", "Adopt", "15.x", "Relational default.",
         "Cloud Platform Team", "2026-03-02", None],
    ],
    caption="Technology Stack",
)


# ---------------------------------------------------------------------------
print("\n1. A register is recognised, and its neighbours are not")

ok("the register sheet is detected", registers.detect(SECURITY) is not None)
ok("the categories roll-up is not a register", registers.detect(CATEGORIES) is None)
ok("the technology stack catalogue is not a register", registers.detect(STACK) is None)

# Order matters: the roll-up and the stack both come first here, and the
# register still has to be the one that is read.
found = registers.read([CATEGORIES, STACK, SECURITY], sheet_names={1: "Security Standards"})
ok("read() picks the register out of a workbook of grids", found is not None)
ok("and takes all of its rows", found and len(found.standards) == 3, found and len(found.standards))


# ---------------------------------------------------------------------------
print("\n2. One row becomes one section, carrying its own identifier")

sections, clauses = registers.build(found, "Security Standards")
ok("one section per standard", len(sections) == 3, len(sections))
ok("one clause per section", [len(clauses[i]) for i in range(3)] == [1, 1, 1])
ok(
    "the section is numbered with the register's id, which is what a finding cites",
    [s.number_text for s in sections] == ["SEC-001", "SEC-006", "SEC-009"],
    [s.number_text for s in sections],
)
ok(
    "the section is titled with the standard's name, not its id",
    sections[1].title == "Authentication Standards",
    sections[1].title,
)
ok(
    "the category survives in the heading path",
    sections[1].heading_path
    == "Security Standards › Identity and Access › SEC-006 Authentication Standards",
    sections[1].heading_path,
)
ok(
    "every section holds exactly one clause, so the reference stays quotable",
    all(len(clauses[i]) == 1 for i in range(3)),
)


# ---------------------------------------------------------------------------
print("\n3. The columns land in the fields the judge reads")

clause = clauses[1][0]
ok("statement is the statement", clause.statement.startswith("All access must be authenticated"))
ok("rationale is the rationale", clause.rationale.startswith("Passwords alone"))
ok(
    "requirements are left empty rather than invented from the statement",
    clause.requirements == [],
    clause.requirements,
)
ok("the clause is not empty, so it will be judged", not clause.is_empty)
ok("origin records how it was read", clause.origin == "register", clause.origin)


# ---------------------------------------------------------------------------
print("\n4. Status: blank means not yet triaged, and is still assessed")

ok(
    "a blank status defaults to adopted",
    [s.status for s in found.standards[:2]] == ["adopted", "adopted"],
    [s.status for s in found.standards[:2]],
)
ok(
    "a stated status is kept as written, not overwritten",
    found.standards[2].status == "Recommended",
    found.standards[2].status,
)
ok(
    "status, owner, category and notes travel with the clause",
    clauses[2][0].source["register"]
    == {
        "id": "SEC-009",
        "category": "Network Security",
        "status": "Recommended",
        "owner": "Network Engineering",
        "notes": "Reviewed 2026-08",
    },
    clauses[2][0].source["register"],
)


# ---------------------------------------------------------------------------
print("\n5. The column binding is not fooled by a substring")

# "id" sits inside "guidance", and "ref" inside "preferred".
TRAP = table(
    ["Guidance", "Preferred Approach", "Standard ID", "Standard Statement"],
    [
        ["Consult the ARB", "Managed service", "ARC-001", "Designs must be reviewed."],
        ["Prefer buy", "SaaS", "ARC-002", "Build is justified only where no product fits."],
        ["Document it", "ADR", "ARC-003", "Decisions must be recorded."],
    ],
)
binding = registers.detect(TRAP)
ok("the identifier column is the one actually named", binding and binding["id"] == "Standard ID",
   binding and binding["id"])

trapped = registers.read([TRAP])
ok(
    "so the sections are numbered ARC-001..003, not by their guidance",
    trapped and [s.identifier for s in trapped.standards] == ["ARC-001", "ARC-002", "ARC-003"],
    trapped and [s.identifier for s in trapped.standards],
)


# ---------------------------------------------------------------------------
print("\n6. A row that is not a standard, and one that is incomplete")

MIXED = table(
    REGISTER_COLUMNS,
    [
        ["SEC-001", "Governance", "Framework", None, "A statement.", "A reason.", "Team", None],
        ["SEC-002", "Governance", "Unwritten", None, None, "A reason.", "Team", None],
        ["SEC-003", "Governance", "Ownership", None, "Another statement.", "", "Team", None],
        [None, None, "Total: 3", None, None, None, None, None],
    ],
)
mixed = registers.read([MIXED])
ok("a row with no statement is not made into a clause", len(mixed.standards) == 2,
   len(mixed.standards))
ok("and is reported rather than dropped in silence", mixed.incomplete == ["SEC-002"],
   mixed.incomplete)
ok("a totals row carrying no identifier is skipped without complaint",
   [s.identifier for s in mixed.standards] == ["SEC-001", "SEC-003"],
   [s.identifier for s in mixed.standards])
ok("a missing rationale is empty, not None", mixed.standards[1].rationale == "")


# ---------------------------------------------------------------------------
print("\n7. Too few rows is not a register")

THIN = table(
    REGISTER_COLUMNS,
    [["SEC-001", "Governance", "Framework", None, "A statement.", "A reason.", "Team", None]],
)
ok("one identified row is a coincidence, not a scheme", registers.detect(THIN) is None)

# Half the rows carrying no identifier means the column is not an identifier.
LOOSE = table(
    ["ID", "Standard Statement"],
    [["SEC-001", "A statement."], ["see above", "More prose."],
     ["and also", "Yet more."], ["n/a", "And more."]],
)
ok("a column of mostly free text is not an identifier column",
   registers.detect(LOOSE) is None)


# ---------------------------------------------------------------------------
print("\n8. The real workbooks, when they are present")

TEMPLATES = pathlib.Path(__file__).resolve().parents[2] / "templates"
EXPECTED = {
    "Security_Standards.xlsx": ("SEC", 36),
    "Data_Standards.xlsx": ("DAT", 28),
    "Infrastructure_Standards.xlsx": ("INF", 18),
    "Integration_Standards.xlsx": ("INT", 40),
    "Solution_Architecture_Standards.xlsx": ("SOL", 33),
    "Enterprise_Architecture_Standards.xlsx": ("EA", 15),
}

if not TEMPLATES.is_dir():
    print("  .... templates/ not present, skipping")
else:
    from aidp.parsing import sheets  # noqa: E402

    total = 0
    for filename, (prefix, count) in sorted(EXPECTED.items()):
        path = TEMPLATES / filename
        if not path.is_file():
            print(f"  .... {filename} missing, skipping")
            continue
        book = sheets.read(path.read_bytes())
        register = registers.read(book.tables)
        ok(f"{filename} reads as a register", register is not None)
        if not register:
            continue
        ok(
            f"{filename} yields {count} standards",
            len(register.standards) == count,
            len(register.standards),
        )
        ids = [s.identifier for s in register.standards]
        ok(f"{filename} identifiers are all {prefix}-*",
           all(i.startswith(prefix + "-") for i in ids), ids[:3])
        ok(f"{filename} identifiers are unique", len(set(ids)) == len(ids))
        ok(f"{filename} every standard carries a statement",
           all(s.statement for s in register.standards))
        ok(f"{filename} no row is incomplete", register.incomplete == [], register.incomplete)
        total += len(register.standards)

    ok("170 standards across the six registers", total == 170, total)

    stack = TEMPLATES / "AIDP_Technology_Stack_Template (1).xlsx"
    if stack.is_file():
        book = sheets.read(stack.read_bytes())
        ok(
            "the technology stack template is not ingested as standards",
            registers.read(book.tables) is None,
        )

    # ----------------------------------------------------------------------
    # Source lines. Without these the parsed-content screen is blank: it reads
    # a section's text back out of `source_line`, not out of the clause.
    print("\n9. Every section is readable on the parsed-content screen")

    security = TEMPLATES / "Security_Standards.xlsx"
    if security.is_file():
        from aidp.stages import parse  # noqa: E402

        out = parse._parse_workbook(  # noqa: SLF001
            security.read_bytes(),
            {"title": "Security Standards", "mimeType": "", "storageKey": "s.xlsx",
             "role": "reference"},
            lambda: None,
        )
        lines = out.source_lines or []
        by_section: dict[int, list] = {}
        for line in lines:
            by_section.setdefault(line.section, []).append(line)

        ok("the register produces source lines at all", bool(lines), len(lines))
        ok(
            "every section has some, so no row opens empty",
            len(by_section) == len(out.sections),
            f"{len(by_section)} of {len(out.sections)}",
        )
        first = by_section.get(0, [])
        ok(
            "a standard leads with its own identifier as a heading",
            bool(first) and first[0].kind == "heading"
            and first[0].text.startswith("SEC-001"),
            first[0].text if first else None,
        )
        ok(
            "followed by its statement and rationale",
            len(first) == 3 and all(ln.kind == "text" for ln in first[1:]),
            [(ln.kind, ln.text[:30]) for ln in first],
        )
        assumptions = next(
            (i for i, s in enumerate(out.sections) if s.title == "Assumptions"), None
        )
        ok("the Assumptions sheet is a section", assumptions is not None)
        text = " ".join(ln.text for ln in by_section.get(assumptions, []))
        ok(
            "and it is readable — it records which rows are only proposals",
            "Proposed" in text,
            text[:80],
        )
        ok(
            "the register's own grid is not emitted a second time as table rows",
            not any(ln.kind == "table_row" and "SEC-0" in ln.text for ln in lines),
        )


# ---------------------------------------------------------------------------
print("\n10. A Requirements column, which is what makes a clause checkable")

WITH_REQS = table(
    [*REGISTER_COLUMNS[:6], "Requirements", *REGISTER_COLUMNS[6:]],
    [
        ["SEC-005", "Identity and Access", "Identity Lifecycle Management", "Mandatory",
         "Identities must be provisioned, modified and de-provisioned through a controlled, "
         "auditable process.",
         "Stale or orphaned accounts are a leading cause of unauthorised access.",
         "Provisioning must be tied to an authoritative source such as the HR system\n"
         "Access must be revoked within one business day of termination\n"
         "Dormant accounts exceeding 90 days of inactivity must be disabled automatically",
         "Identity & Access Management Team", None],
        # Bullet glyphs rather than bare lines — the other way a person writes a cell.
        ["SEC-006", "Identity and Access", "Authentication Standards", "Mandatory",
         "All access must be authenticated appropriately to sensitivity.",
         "Passwords alone are insufficient.",
         "• MFA must be enforced for all remote and administrative access\n"
         "• Shared or generic accounts must be prohibited",
         "Identity & Access Management Team", None],
        # One obligation written as prose, with a full stop inside a parenthesis
        # that must not split it in two.
        ["SEC-018", "Data Protection", "Cryptographic Standards", "Mandatory",
         "Confidential data must be encrypted at rest and in transit.",
         "Algorithms weaken over time.",
         "Data at rest must use AES-256 (FIPS 140-2 validated i.e. approved modules)",
         "Security Engineering", None],
        # A standard the author has not finished: column present, cell empty.
        ["SEC-033", "Awareness", "Security Awareness Program", "Recommended",
         "All personnel must complete security awareness training annually.",
         "People are the most targeted control.", None,
         "Security Engineering", None],
    ],
)

ok("a register with the column is still a register", registers.detect(WITH_REQS) is not None)
rich = registers.read([WITH_REQS])
ok("the column is noticed", rich.has_requirements_column is True)
ok(
    "line breaks separate obligations",
    rich.standards[0].requirements == [
        "Provisioning must be tied to an authoritative source such as the HR system",
        "Access must be revoked within one business day of termination",
        "Dormant accounts exceeding 90 days of inactivity must be disabled automatically",
    ],
    rich.standards[0].requirements,
)
ok(
    "so do bullet glyphs, and the glyph is not kept",
    rich.standards[1].requirements == [
        "MFA must be enforced for all remote and administrative access",
        "Shared or generic accounts must be prohibited",
    ],
    rich.standards[1].requirements,
)
ok(
    "a single obligation is not split at a full stop inside it",
    rich.standards[2].requirements
    == ["Data at rest must use AES-256 (FIPS 140-2 validated i.e. approved modules)"],
    rich.standards[2].requirements,
)
ok("an empty cell yields none, not a blank entry", rich.standards[3].requirements == [])
ok(
    "and that standard is named as judged on its statement alone",
    rich.without_requirements == ["SEC-033"],
    rich.without_requirements,
)

sections_r, clauses_r = registers.build(rich, "Security Standards")
ok(
    "the requirements reach the clause the judge reads",
    clauses_r[0][0].requirements == rich.standards[0].requirements,
)
ok(
    "the statement is not repeated into them",
    all(
        c[0].statement not in c[0].requirements
        for c in clauses_r.values()
        if c[0].requirements
    ),
)

lines_r = registers.source_lines(rich, _EmptyBook(), {})
first_lines = [ln for ln in lines_r if ln.section == 0]
ok(
    "each obligation is its own source line, so a reviewer can see what was judged",
    [ln.kind for ln in first_lines] == ["heading", "text", "text", "bullet", "bullet", "bullet"],
    [ln.kind for ln in first_lines],
)

# The whole point, stated as a test: without the column nothing is checkable.
plain = registers.read([SECURITY])
ok(
    "the same register without the column states no obligations at all",
    plain.has_requirements_column is False
    and sum(len(s.requirements) for s in plain.standards) == 0,
)
ok(
    "and every one of its standards is reported as judged on its statement alone",
    len(plain.without_requirements) == len(plain.standards),
    plain.without_requirements,
)


print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
