/**
 * The product's own baseline standards library.
 *
 * What a customer who has brought no standards of their own is measured
 * against. `docs/product.md:38-40` calls it "the consultancy's baseline
 * framework: unfilled, generic, and applicable to any customer", and
 * `docs/product.md:32-33` is why it had to be written rather than borrowed:
 * "One customer's Internal-Use standards must never surface in another's
 * assessment."
 *
 * The rows live in `source/`; the workbooks in `files/` are generated from them
 * by `scripts/build-standards-library.mts`. Both are committed. A seeded copy
 * goes through the same `intake.record()` an administrator's upload goes
 * through, so there is no second ingestion path to keep in step — a seeded
 * register and an uploaded one differ only by `Document.suppliedKey`.
 */
import { data } from "./source/data";
import { enterprise } from "./source/enterprise";
import { infrastructure } from "./source/infrastructure";
import { integration } from "./source/integration";
import { security } from "./source/security";
import { solution } from "./source/solution";
import type { RegisterSource } from "./source/types";

export type { RegisterSource, StandardRow, Obligation } from "./source/types";

/**
 * In the order a customer meets them.
 *
 * Not alphabetical: Enterprise Architecture sets the shape everything else sits
 * inside, and Security is the one a reviewer reaches for first. The order is
 * carried into `FrameworkDocument.sortOrder` by the seed, which is what decides
 * the order clauses are judged in — see `analyse._framework_clauses`.
 */
export const REGISTERS: RegisterSource[] = [
  enterprise,
  solution,
  security,
  data,
  integration,
  infrastructure,
];

export const REGISTER_KEYS = REGISTERS.map((r) => r.key);

export function registerByKey(key: string): RegisterSource | undefined {
  return REGISTERS.find((r) => r.key === key);
}

/**
 * The file a register's workbook is generated to and seeded from.
 *
 * One place, because the generator writes it and the seeder reads it, and a
 * name that drifted between the two would fail at run time in a deployed
 * environment rather than in the build.
 */
export function workbookName(register: RegisterSource): string {
  return `${register.title.replace(/\s+/g, "_")}.xlsx`;
}

/**
 * Identifiers are positional — `SEC-001` is simply the first row of
 * `security.rows`. That is safe while the library is unreleased and unsafe
 * afterwards: a customer's findings and decisions cite these strings, and
 * inserting a row in the middle would silently renumber every standard below
 * it so that old citations point at new rules.
 *
 * So once this library has shipped, a new standard is **appended**, and a
 * withdrawn one leaves its row in place with its status changed rather than
 * being deleted. `scripts/build-standards-library.mts` fails the build if an
 * identifier that existed in the committed workbook has moved to a different
 * statement.
 */
export const IDENTIFIERS_ARE_POSITIONAL = true;
