/**
 * Generate the baseline standards library's workbooks from their source rows.
 *
 *   npx tsx scripts/build-standards-library.mts
 *   npx tsx scripts/build-standards-library.mts --check
 *
 * The rows live in `src/lib/standards-library/source/*.ts`; this writes the
 * `.xlsx` files that `seedStandardLibrary` feeds to `intake.record()`. Both are
 * committed — the source because a spreadsheet in a diff is unreviewable, the
 * workbook because the seeding path must not depend on a build step having been
 * run in whatever environment it is deployed to.
 *
 * `--check` regenerates into memory and fails if a committed workbook is out of
 * date — run it after editing anything under `source/`, and before committing.
 *
 * Deliberately **not** wired into `prebuild`. Both npm scripts need `tsx` to
 * resolve the TypeScript sources, and making a deployment depend on fetching
 * `tsx` to validate files that are already committed trades a rare developer
 * mistake for a new way for the build to fail. The committed workbook is what
 * ships; nothing at build or run time regenerates it.
 *
 * It is a generator second and a linter first: everything below `verify()` is a
 * property the engine depends on and that a person editing a register will
 * eventually get wrong.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

import { REGISTERS, workbookName } from "../src/lib/standards-library";
import { identifier, type RegisterSource } from "../src/lib/standards-library/source/types";

const FILES = path.resolve(process.cwd(), "src", "lib", "standards-library", "files");
const check = process.argv.includes("--check");

/** The eight columns `registers.py` binds, plus Requirements.
 *
 *  The names are the first entry of each tuple in `registers._ID_COLUMNS` and
 *  its siblings, so they bind on the exact-match pass rather than on the
 *  word-boundary fallback. Renaming one here moves it to the fuzzy pass, where
 *  "Standard Statement" and "Statement of Applicability" could both match. */
const COLUMNS = [
  { header: "Standard ID", width: 12 },
  { header: "Category", width: 24 },
  { header: "Standard Name", width: 34 },
  { header: "Status", width: 14 },
  { header: "Standard Statement", width: 70 },
  { header: "Rationale", width: 58 },
  { header: "Requirements", width: 58 },
  { header: "Owner", width: 26 },
  { header: "Notes", width: 34 },
];

const problems: string[] = [];
const fail = (register: RegisterSource, row: number, message: string) =>
  problems.push(`${register.key} row ${row}: ${message}`);

/**
 * Everything that has to be true of a register before it is worth generating.
 *
 * Structural only: a row that is missing a field, duplicated, or carries a
 * status outside the two the column permits. Nothing here reads the *wording*
 * of a statement or has an opinion about it.
 */
function verify(register: RegisterSource): void {
  const seenNames = new Set<string>();

  if (!/^[A-Z]{2,8}$/.test(register.prefix)) {
    problems.push(`${register.key}: prefix "${register.prefix}" is not 2-8 upper-case letters`);
  }

  register.rows.forEach((row, index) => {
    const n = index + 1;

    for (const [field, value] of [
      ["category", row.category],
      ["name", row.name],
      ["statement", row.statement],
      ["rationale", row.rationale],
      ["owner", row.owner],
    ] as const) {
      if (!value?.trim()) fail(register, n, `${field} is empty`);
    }

    // A duplicate name makes two clauses indistinguishable in the library and
    // in a finding, which both show the title rather than the identifier.
    const key = row.name.trim().toLowerCase();
    if (seenNames.has(key)) fail(register, n, `duplicate name "${row.name}"`);
    seenNames.add(key);

    if (row.status !== "Mandatory" && row.status !== "Recommended") {
      fail(register, n, `status "${row.status}" is neither Mandatory nor Recommended`);
    }

    // `parse.py:1266` raises a medium ingest issue for a register with no
    // Requirements column and names the rows that state none. Ours states them
    // everywhere, and this is what keeps that true.
    if (row.requirements.length < 2) {
      fail(register, n, `only ${row.requirements.length} requirement(s) — state at least two`);
    }
    row.requirements.forEach((requirement, r) => {
      if (!requirement.trim()) fail(register, n, `requirement ${r + 1} is empty`);
      // `registers._cell_lines` splits the cell on its line breaks, so a
      // newline inside one obligation would silently become two.
      if (requirement.includes("\n")) {
        fail(register, n, `requirement ${r + 1} contains a line break`);
      }
    });
  });
}

/** Category → how many of each obligation. The roll-up sheet, and a useful
 *  thing to print: a category that is all Recommended measures nothing. */
function rollUp(register: RegisterSource) {
  const out = new Map<string, { mandatory: number; recommended: number }>();
  for (const row of register.rows) {
    const bucket = out.get(row.category) ?? { mandatory: 0, recommended: 0 };
    if (row.status === "Mandatory") bucket.mandatory += 1;
    else bucket.recommended += 1;
    out.set(row.category, bucket);
  }
  return out;
}

async function build(register: RegisterSource): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AIDP baseline standards library";

  // --- the register itself, which must be the FIRST grid in the book.
  // `registers.read` returns the first register-shaped table it finds, so a
  // roll-up sheet placed ahead of this one would be examined first. It has no
  // identifier column so it could not win, but the ordering should not be the
  // thing standing between us and a wrong answer.
  // Excel caps a sheet name at 31 characters and ExcelJS truncates silently
  // past it — "Enterprise Architecture Standards" would land as
  // "Enterprise Architecture Standar". The domain alone is inside the limit for
  // all six and reads better; the full title is the document's, carried by the
  // file name and by `Document.title`.
  const ws = wb.addWorksheet(register.title.replace(/ Standards$/, ""));
  ws.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  register.rows.forEach((row, index) => {
    const added = ws.addRow([
      identifier(register.prefix, index),
      row.category,
      row.name,
      row.status,
      row.statement,
      row.rationale,
      row.requirements.join("\n"),
      row.owner,
      row.notes ?? "",
    ]);
    added.alignment = { vertical: "top", wrapText: true };
  });

  // The same data-validation dropdown the client's own registers carry on this
  // column — theirs reads exactly "Mandatory,Recommended", which is what
  // settles that this column is the obligation and not a lifecycle.
  //
  // Worth carrying because these workbooks are meant to be edited: a customer
  // adding a row to our Security register should be offered the two words the
  // engine can read, rather than typing a third that `obligations.of` will
  // ignore and Fix 4c will one day fall through on.
  //
  // Reached through a cast: ExcelJS carries `dataValidations` on a worksheet at
  // run time but does not declare it on the `Worksheet` type, so this is the
  // library's own gap rather than a shortcut around one of ours.
  (
    ws as unknown as {
      dataValidations: { add: (range: string, rule: Record<string, unknown>) => void };
    }
  ).dataValidations.add(`D2:D${register.rows.length + 200}`, {
    type: "list",
    allowBlank: false,
    showErrorMessage: true,
    errorTitle: "Mandatory or Recommended",
    error: "A standard either binds a design or advises it. Pick one.",
    formulae: ['"Mandatory,Recommended"'],
  });

  // --- Categories: a reader's roll-up, and deliberately not register-shaped.
  const categories = wb.addWorksheet("Categories");
  categories.columns = [
    { header: "Category", width: 30 },
    { header: "Mandatory", width: 12 },
    { header: "Recommended", width: 14 },
    { header: "Total", width: 10 },
  ];
  categories.getRow(1).font = { bold: true };
  for (const [name, counts] of rollUp(register)) {
    categories.addRow([name, counts.mandatory, counts.recommended, counts.mandatory + counts.recommended]);
  }

  // --- Assumptions: where these rows came from, in the book itself.
  // `registers.source_lines` emits the other sheets as readable sections, so
  // this is visible on the parsed-content screen rather than only in git.
  const assumptions = wb.addWorksheet("Assumptions");
  assumptions.columns = [{ header: "Scenario and assumptions behind this register", width: 110 }];
  assumptions.getRow(1).font = { bold: true };
  for (const line of [
    register.scope,
    "Source: written for this product as a generic baseline. It contains no customer's standards, and is intended to apply to any organisation that has not brought its own.",
    "Status is Mandatory (a design must comply) or Recommended (a design should comply, and a deviation is a judgement rather than a breach). Every row states one.",
    "Requirements hold the testable obligations under the statement, one per line. A design is judged against these rather than against the statement alone.",
    "Owner names an accountable role, not a team in any particular organisation. Replace it with your own role names when you adopt this register.",
    "Identifiers are positional and stable: a new standard is appended rather than inserted, so that identifiers already cited in findings and decisions keep pointing at the same rule.",
    "Generated from src/lib/standards-library/source by scripts/build-standards-library.mts. Edit the source, not this workbook.",
  ]) {
    assumptions.addRow([line]).alignment = { wrapText: true, vertical: "top" };
  }

  // ExcelJS declares its own `Buffer` interface, which does not structurally
  // overlap Node's. The bytes are a Node Buffer at run time.
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

// ---------------------------------------------------------------------------

for (const register of REGISTERS) verify(register);

if (problems.length) {
  console.error(`\n  ${problems.length} problem(s) in the register sources:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error("");
  process.exit(1);
}

let stale = 0;
let total = 0;

for (const register of REGISTERS) {
  const target = path.join(FILES, workbookName(register));
  const built = await build(register);
  total += register.rows.length;

  const mandatory = register.rows.filter((r) => r.status === "Mandatory").length;
  const obligations = register.rows.reduce((n, r) => n + r.requirements.length, 0);
  const span = `${identifier(register.prefix, 0)}–${identifier(register.prefix, register.rows.length - 1)}`;

  if (check) {
    // A workbook carries creation timestamps, so the bytes of two builds of
    // the same rows differ. Compare what the parser will actually read instead.
    const existing = await readFile(target).catch(() => null);
    const same = existing ? await sameRows(existing, built) : false;
    if (!same) {
      stale += 1;
      console.error(`  ✗ ${workbookName(register)} is out of date — run without --check`);
      continue;
    }
    console.log(`  ✓ ${workbookName(register)}  ${register.rows.length} standards (${span})`);
  } else {
    await writeFile(target, built);
    console.log(
      `  ${workbookName(register).padEnd(42)} ${String(register.rows.length).padStart(3)} standards  ` +
        `${span}  ${mandatory} mandatory, ${register.rows.length - mandatory} recommended, ` +
        `${obligations} obligations`,
    );
  }
}

/** Whether two workbooks hold the same register rows, ignoring the metadata a
 *  rebuild changes. */
async function sameRows(a: Buffer, b: Buffer): Promise<boolean> {
  const digest = async (bytes: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    const rows: string[] = [];
    sheet.eachRow((row) => {
      rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? "")).join("\u0001"));
    });
    return createHash("sha256").update(rows.join("\u0002")).digest("hex");
  };
  return (await digest(a)) === (await digest(b));
}

if (stale) {
  console.error(`\n  ${stale} workbook(s) out of date.\n`);
  process.exit(1);
}

console.log(`\n  ${REGISTERS.length} registers, ${total} standards.\n`);
