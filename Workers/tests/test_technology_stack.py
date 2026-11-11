"""The technology stack: a catalogue of what is approved, not a set of rules.

`registers.py` refuses the stack template on purpose — it has no identifier
column and no statement column, and read as standards it would measure every
design against the existence of AWS. `technologies.py` is where it goes
instead, and these are the cases that decide whether that split actually holds.

1. **A register must not be read as a stack.** This is the mirror of the test
   in test_standards_register.py and the more dangerous direction: both shapes
   carry a Name column and a Status column, so binding alone matches a register
   and all 170 standards would be ingested as technologies. The discriminator
   is that a register's Status column is *blank* in every row.
2. **The Categories roll-up must not win.** It appears in the stack workbook
   too, and its columns are the four positions — as headers, not values.
3. **An unreadable status becomes `assess`.** Never `adopt`, which would
   approve something nobody approved, and never `hold`, which would invent a
   breach.
4. **Redshift is on hold and Mirth Connect is absent.** The two findings the
   Meridian answer key marks must-get (EA-007, EA-008) are exactly these two
   lookups, so the parse has to carry them.

    docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse \\
      -e DATABASE_URL=postgresql://nobody@127.0.0.1:1/none \\
      --entrypoint python aidp-worker-test tests/test_technology_stack.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.parsing import registers, technologies  # noqa: E402
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


STACK_COLUMNS = [
    "Technology Name", "Category", "Status", "Approved Version(s)",
    "Justification", "Scenarios in which this needs to be used", "Owner",
    "Added Date", "Last Reviewed Date", "Notes",
]

STACK_ROWS = [
    ["Amazon Web Services (AWS)", "Cloud Provider", "Adopt", "N/A (managed)",
     "Single strategic public cloud", "All new cloud-hosted workloads",
     "Cloud Platform Team", "2026-01-19", "2026-08-21", "Multi-cloud is out of scope"],
    ["Amazon Redshift", "Analytics", "Hold", "RA3 / Serverless",
     "Being consolidated onto the lakehouse", "Existing marts only",
     "Data Platform Team", "2026-01-19", "2026-08-21", ""],
    ["PostgreSQL (Aurora)", "Database", "Adopt", "15, 16",
     "Default relational engine", "New transactional services",
     "Data Platform Team", "2026-01-19", "2026-08-21", ""],
    ["Apache Kafka (MSK)", "Messaging", "Trial", "3.6",
     "Event backbone pilot", "High-volume streaming",
     "Integration Team", "2026-03-02", "2026-08-21", ""],
    ["OpenTelemetry", "Observability", "Assess", "1.x",
     "Being evaluated", "New services only", "SRE", "2026-05-11", "2026-08-21", ""],
]

# The six client registers, as `registers.py` reads them: a Status column that
# is present and blank in every row.
REGISTER_COLUMNS = [
    "Standard ID", "Category", "Standard Name", "Status",
    "Standard Statement", "Rationale", "Owner", "Notes",
]
REGISTER_ROWS = [
    ["SEC-001", "Security Governance", "Security Governance Framework", None,
     "The organization must operate under a documented framework.",
     "Keeps decisions consistent.", "Security Engineering", None],
    ["SEC-002", "Identity and Access", "Authentication Standards", None,
     "All access must be authenticated.", "Passwords alone are insufficient.",
     "IAM Team", None],
    ["SEC-003", "Data Protection", "Encryption at Rest", None,
     "Data must be encrypted at rest.", "Limits breach blast radius.",
     "Security Engineering", None],
    ["SEC-004", "Network", "Segmentation", None,
     "Networks must be segmented by trust zone.", "Contains lateral movement.",
     "Network Team", None],
]

print("\n  the stack is read")
stack = technologies.read([table(STACK_COLUMNS, STACK_ROWS)])
ok("a stack workbook is detected", stack is not None)
assert stack is not None
ok("every row is kept", len(stack.technologies) == 5, len(stack.technologies))

by_name = {t.name: t for t in stack.technologies}
ok("AWS is adopt", by_name["Amazon Web Services (AWS)"].status == "adopt")
ok("Kafka is trial", by_name["Apache Kafka (MSK)"].status == "trial")
ok("OpenTelemetry is assess", by_name["OpenTelemetry"].status == "assess")

print("\n  the two must-get lookups (EA-007, EA-008)")
ok("Redshift is on hold", by_name["Amazon Redshift"].status == "hold")
ok("Mirth Connect is absent from the stack", "Mirth Connect" not in by_name)

print("\n  the columns bind")
redshift = by_name["Amazon Redshift"]
ok("Approved Version(s) binds despite its parentheses",
   redshift.approved_versions == "RA3 / Serverless", redshift.approved_versions)
ok("category binds", redshift.category == "Analytics", redshift.category)
ok("the long scenarios header binds",
   redshift.scenarios == "Existing marts only", redshift.scenarios)
ok("owner binds", redshift.owner == "Data Platform Team", redshift.owner)
ok("ordinal follows the sheet", [t.ordinal for t in stack.technologies] == [1, 2, 3, 4, 5],
   [t.ordinal for t in stack.technologies])

print("\n  counts roll up")
ok("counts match the rows",
   stack.counts == {"adopt": 2, "trial": 1, "assess": 1, "hold": 1}, stack.counts)

print("\n  a register is NOT a stack")
register_table = table(REGISTER_COLUMNS, REGISTER_ROWS)
ok("detect refuses a standards register", technologies.detect(register_table) is None)
ok("read refuses a standards register", technologies.read([register_table]) is None)
# And the mirror still holds, so neither parser has quietly taken the other's file.
ok("registers still accepts a register", registers.detect(register_table) is not None)
ok("registers still refuses a stack",
   registers.detect(table(STACK_COLUMNS, STACK_ROWS)) is None)

print("\n  the Categories roll-up is not a stack")
rollup = table(
    ["Category", "Adopt", "Trial", "Assess", "Hold", "Total"],
    [["Cloud Provider", "2", "0", "0", "0", "2"],
     ["Database", "4", "1", "0", "2", "7"],
     ["Messaging", "1", "1", "0", "1", "3"],
     ["Analytics", "0", "0", "1", "3", "4"]],
)
ok("the roll-up is refused", technologies.detect(rollup) is None)
# And it must not be picked ahead of the real sheet when both are present.
both = technologies.read([rollup, table(STACK_COLUMNS, STACK_ROWS, sheet=2)])
ok("the real sheet is found past the roll-up", both is not None and len(both.technologies) == 5,
   None if both is None else len(both.technologies))

print("\n  an unreadable status asserts least")
ok("a blank cell becomes assess", technologies.read_status("") == "assess")
ok("an unknown word becomes assess", technologies.read_status("Approved") == "assess")
ok("a qualified cell becomes assess", technologies.read_status("Adopt (pilot)") == "assess")
ok("case and padding are tolerated", technologies.read_status("  ADOPT ") == "adopt")
ok("every known position round-trips",
   [technologies.read_status(s.title()) for s in technologies.STATUSES]
   == list(technologies.STATUSES))
# The one that matters most: nothing unreadable may become `adopt` or `hold`.
ok("no unreadable value approves anything",
   all(technologies.read_status(v) == "assess"
       for v in ["", None, "n/a", "TBD", "Adopted?", "retire", "Hold/Trial"]))

print("\n  a sheet of mostly-blank statuses is not a stack")
# The failure this guards: a stack whose Status column was never filled is
# indistinguishable from a register, and reading it would silently mark every
# row `assess` and report a stack nobody wrote.
half_blank = table(STACK_COLUMNS, [
    [row[0], row[1], None, *row[3:]] for row in STACK_ROWS
])
ok("an unpopulated status column is refused", technologies.detect(half_blank) is None)

print("\n  duplicate names collapse")
dupes = technologies.read([table(STACK_COLUMNS, STACK_ROWS + [
    ["amazon redshift", "Analytics", "Adopt", "RA3", "duplicate row", "", "", "", "", ""],
])])
assert dupes is not None
ok("a repeated name is kept once", len(dupes.technologies) == 5, len(dupes.technologies))
ok("the first position wins",
   {t.name: t.status for t in dupes.technologies}["Amazon Redshift"] == "hold")

print("\n  too small to be deliberate")
ok("two rows are not a stack",
   technologies.detect(table(STACK_COLUMNS, STACK_ROWS[:2])) is None)

print(f"\n  {passed} passed, {failed} failed\n")
sys.exit(1 if failed else 0)
