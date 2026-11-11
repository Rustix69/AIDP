/**
 * The shape of a register in source form.
 *
 * These rows are the product's own baseline library — what a customer who has
 * brought no standards of their own is measured against. They are kept as
 * TypeScript rather than only as the `.xlsx` the parser eats because a
 * spreadsheet in a diff is unreviewable, and these particular sentences decide
 * whether somebody's design is told it is non-compliant. The workbook is
 * generated from here by `scripts/build-standards-library.mts`; both are
 * committed, and this is the half that review reads.
 *
 * Nothing here is any customer's wording. `docs/product.md:38-40` describes the
 * baseline as "unfilled, generic, and applicable to any customer", and
 * `docs/product.md:32-33` makes the reason binding: "One customer's
 * Internal-Use standards must never surface in another's assessment."
 */

/**
 * Whether the standard binds or advises.
 *
 * The column the client's own six registers ship blank in all 170 rows. Ours
 * states it on every row, and the generated workbooks carry the same
 * `Mandatory,Recommended` dropdown the client's do.
 *
 * **Nothing reads it yet.** `registers.py:285` stores the cell at
 * `sourceRefs.register.status`, and `obligations.of` does not consult it: a
 * clause's obligation comes from the modal verb in its statement. Making the
 * engine prefer this column is Fix 4c, which is not built. So this is a
 * declaration for the people who read and edit the register, and correct data
 * waiting for the day the engine does read it — not something in force today.
 */
export type Obligation = "Mandatory" | "Recommended";

export type StandardRow = {
  /** Groups the clause on the library screen and in `headingPath`. */
  category: string;
  /** The short name. Becomes `Clause.title` and the section heading. */
  name: string;
  status: Obligation;
  /** The rule itself, as one sentence a design can be measured against. */
  statement: string;
  /** Why the rule exists. Shown to a reviewer and to the judge as context. */
  rationale: string;
  /**
   * The testable obligations under the statement, one per line in the cell.
   *
   * This is the field that decides how sharp a finding is. `parse.py:1256-1259`
   * puts it plainly: "The engine judges a design against a clause's
   * *requirements*… a run against statement-only clauses returns mostly
   * 'partial'." A register with no Requirements column raises a **medium**
   * ingest issue on every ingest, and the client's six registers have none,
   * which is a large part of why their findings read broad.
   *
   * Each line is one thing a reviewer could tick or fail on its own. A line
   * that restates the statement in other words adds nothing; a line that needs
   * a second clause to be understood belongs in that clause.
   */
  requirements: string[];
  /** The accountable role — never a customer's team name. */
  owner: string;
  notes?: string;
};

export type RegisterSource = {
  /** Stable key. Also the `Document.suppliedKey` of every seeded copy. */
  key: string;
  /** Identifier prefix: `SEC-001`, `DAT-014`. Two to four upper-case letters,
   *  because `registers._ID_VALUE` matches `^[A-Za-z]{2,8}[-_ ]?\d{1,4}$` and
   *  a register is only detected when enough rows carry one. */
  prefix: string;
  /** The document title a customer sees in their library. */
  title: string;
  /** One line on what the register covers, written into its Assumptions sheet. */
  scope: string;
  rows: StandardRow[];
};

/** `SEC-001` … `SEC-036`. Positional, so inserting a row mid-file renumbers
 *  everything after it — see the note in `index.ts` about why that is safe
 *  before a release and not after one. */
export function identifier(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}
