import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { XLSX_MIME, record } from "@/lib/ingest/intake";
import { REGISTERS, registerByKey, workbookName } from "@/lib/standards-library";

/**
 * Giving an organisation the product's own baseline standards library.
 *
 * A customer who has brought no standards of their own is measured against
 * nothing: `resolveFramework` refuses to start a run with no reference
 * documents, and until now a new organisation had none and no way to get any
 * except an administrator uploading six files by hand.
 *
 * ## It goes through the front door
 *
 * This does not write Document, Section and Clause rows itself. It reads the
 * six workbooks and hands them to `intake.record()` — the same function both
 * upload doors call — so a seeded register is parsed, chunked, embedded,
 * assessed against, edited and deleted by exactly the code paths an uploaded
 * one is. The alternative, copying rows between organisations, would be faster
 * and would create a second kind of reference document that every one of those
 * paths would eventually have to learn about.
 *
 * It is also nearly free. A register is parsed deterministically — the register
 * branch in `parse._parse_workbook` is reached before the model structure pass
 * and never calls a model — so the whole cost of seeding an organisation is
 * chunking and embedding about 145 short clauses.
 *
 * ## Repeating it is safe
 *
 * `record()` is content-addressed on `@@unique([organisationId, sha256])`, so
 * seeding twice resolves to the documents already there rather than paying to
 * ingest them again. That is what makes this safe to call from an onboarding
 * screen somebody might double-click, and safe to call again later to pull back
 * a register the customer deleted.
 */

/** Where the generated workbooks sit, relative to the Next project root.
 *
 *  `next.config.ts` lists this path under `outputFileTracingIncludes`, because
 *  nothing imports these files and the build's tracing would otherwise leave
 *  them out of the deployed bundle — seeding would then fail in production
 *  having worked in every local environment. */
const FILES = path.join(
  // These files are declared explicitly in `outputFileTracingIncludes`, so
  // there is nothing for Turbopack's automatic trace to work out here — and a
  // `process.cwd()` it cannot resolve statically is one of the things that
  // makes it give up and trace the whole project into the bundle.
  //
  // It is already doing that for another reason (`lib/ingest/storage.ts`, via
  // /api/internal/files — the build warning names it). This is here so that
  // fixing that one does not uncover this as the next cause.
  /* turbopackIgnore: true */ process.cwd(),
  "src",
  "lib",
  "standards-library",
  "files",
);

export type SeedOutcome = {
  key: string;
  title: string;
  /** "seeded" — a new document and its parse job were created.
   *  "present" — the same bytes are already in this organisation.
   *  "failed"  — the workbook could not be read or recorded; `problem` says so. */
  state: "seeded" | "present" | "failed";
  documentId?: string;
  problem?: string;
};

export type SeedResult = {
  outcomes: SeedOutcome[];
  seeded: number;
  present: number;
  failed: number;
};

/**
 * Seed some or all of the baseline registers into an organisation.
 *
 * Ids rather than an `Access`, matching `record()` — the caller does the
 * authorisation, because the two callers (a server action and a script) prove
 * who they are in different ways. Every server-side route into this must check
 * `canManageStandards` first: whoever controls the reference documents controls
 * every verdict this customer will ever get.
 *
 * One register failing does not stop the others. A missing workbook is a
 * deployment fault rather than a user error, and leaving five registers
 * unseeded because the sixth could not be read would turn a partial fault into
 * a total one.
 */
export async function seedStandardLibrary(input: {
  organisationId: string;
  userId: string;
  /** Defaults to all of them. Unknown keys are reported rather than ignored,
   *  so a renamed register fails loudly instead of silently seeding less. */
  keys?: string[];
}): Promise<SeedResult> {
  const { organisationId, userId } = input;
  const wanted = input.keys?.length
    ? input.keys.map((key) => ({ key, register: registerByKey(key) }))
    : REGISTERS.map((register) => ({ key: register.key, register }));

  const outcomes: SeedOutcome[] = [];

  for (const { key, register } of wanted) {
    if (!register) {
      outcomes.push({ key, title: key, state: "failed", problem: "No such register." });
      continue;
    }

    const fileName = workbookName(register);
    try {
      const bytes = await readFile(path.join(FILES, fileName));
      const { document, duplicate } = await record({
        organisationId,
        userId,
        role: "reference",
        projectId: null,
        bytes,
        fileName,
        format: { mimeType: XLSX_MIME, extension: "xlsx" },
        suppliedKey: register.key,
      });
      outcomes.push({
        key: register.key,
        title: register.title,
        state: duplicate ? "present" : "seeded",
        documentId: document.id,
      });
    } catch (error) {
      outcomes.push({
        key: register.key,
        title: register.title,
        state: "failed",
        problem: error instanceof Error ? error.message : "Could not be read.",
      });
    }
  }

  return {
    outcomes,
    seeded: outcomes.filter((o) => o.state === "seeded").length,
    present: outcomes.filter((o) => o.state === "present").length,
    failed: outcomes.filter((o) => o.state === "failed").length,
  };
}

export type LibraryStanding = {
  key: string;
  title: string;
  /** The seeded copy, where this organisation still holds one. */
  documentId: string | null;
  status: string | null;
};

/**
 * Which of our registers this organisation currently holds.
 *
 * Reads `Document.suppliedKey` rather than matching on title, because a
 * customer may rename their copy and because they may upload a file of their
 * own called "Security Standards" — which is theirs, and must not be reported
 * as ours.
 */
export async function libraryStanding(organisationId: string): Promise<LibraryStanding[]> {
  const held = await prisma.document.findMany({
    where: { organisationId, suppliedKey: { not: null } },
    select: { id: true, suppliedKey: true, status: true },
  });
  const byKey = new Map(held.map((d) => [d.suppliedKey as string, d]));

  return REGISTERS.map((register) => {
    const copy = byKey.get(register.key);
    return {
      key: register.key,
      title: register.title,
      documentId: copy?.id ?? null,
      status: copy?.status ?? null,
    };
  });
}
