/**
 * A reference standard, on one page.
 *
 * What the pipeline read out of a document used to live behind a link, on
 * /dashboard/documents/<id>/parsed. For a submitted design that is right: its
 * page is a report, and the parse is the evidence behind a finding — wanted
 * when a finding looks wrong and never otherwise. For a standard it was one
 * click too many, because the parse *is* the standard as far as this system is
 * concerned. Opening a standard showed a summary and a button.
 *
 * What this proves, against a throwaway organisation:
 *
 *   · a standard's own page carries its outline, its counts and its parse
 *     notes, with the rows that open;
 *   · it no longer offers a second page to go and read them on;
 *   · the old address still works for anyone who kept it, and lands on the
 *     standard rather than on a dead end;
 *   · a design is untouched: its page still links out to the parse, and that
 *     page still renders.
 *
 * Needs the dev server. Run with:
 *   npx tsx --env-file=.env.local scripts/verify-standard-parsed.mts
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { provisionAccount } from "../src/lib/access/provision";
import { OWNER } from "../src/lib/access/roles";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "a-throwaway-password";
const TAG = `zz-stdparsed-${Date.now()}`;

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, extra: unknown = "") => {
  if (condition) {
    pass += 1;
    console.log(`  PASS ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}`, extra);
  }
};

async function workspace(name: string) {
  const slug = `${TAG}-${name}`;
  const org = await prisma.organisation.create({ data: { name: `ZZ ${name}`, slug } });
  const email = `${slug}@test.invalid`;
  const account = await provisionAccount({
    email, name, company: org.name, password: PASSWORD,
  });
  await prisma.membership.create({
    data: { userId: account.userId, organisationId: org.id, role: OWNER },
  });
  await prisma.rosterEntry.create({
    data: { organisationId: org.id, email, status: "active", role: OWNER, userId: account.userId },
  });
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} — is ${BASE} up?`);
  const cookie = (res.headers.getSetCookie() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { org, userId: account.userId, cookie };
}

async function document(organisationId: string, role: string, title: string) {
  return prisma.document.create({
    data: {
      organisationId,
      role,
      title,
      storageKey: `${TAG}/${title}`,
      byteSize: 10,
      sha256: randomUUID(),
      status: "ready",
      summary: `What ${title} sets out to do.`,
    },
    select: { id: true },
  });
}

async function section(documentId: string, ordinal: number, title: string) {
  return prisma.documentSection.create({
    data: {
      documentId,
      ordinal,
      numberText: `${ordinal}.1`,
      title,
      headingPath: title,
      pageStart: ordinal,
      pageEnd: ordinal,
    },
    select: { id: true },
  });
}

/** The page as a signed-in reader gets it, without following a redirect. */
async function visit(cookie: string, path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  const body = res.status === 200 ? await res.text() : "";
  return { status: res.status, location: res.headers.get("location"), body };
}

/**
 * Where a visit ends up.
 *
 * A redirect from a server component that has already begun streaming is sent
 * as a meta refresh in the body rather than as a Location header, so both are
 * worth reading before deciding a page went nowhere.
 */
function lands(visit: { status: number; location: string | null; body: string }) {
  if (visit.location) return visit.location;
  const meta = visit.body.match(/http-equiv="refresh"[^>]*url=([^"'>]+)/i);
  return meta ? meta[1].replace(/&amp;/g, "&") : null;
}

let mine: Awaited<ReturnType<typeof workspace>> | null = null;

try {
  mine = await workspace("mine");

  const standard = await document(mine.org.id, "reference", "Data Standards");
  const retention = await section(standard.id, 8, "Retention");
  await prisma.clause.create({
    data: {
      sectionId: retention.id,
      ordinal: 1,
      title: "Retention",
      statement: "Records are kept for a stated period.",
      requirements: ["Tier 1 data is kept for seven years."],
      origin: "model",
      pageStart: 8,
    },
  });
  await prisma.tableBlock.create({
    data: {
      sectionId: retention.id,
      ordinal: 1,
      caption: "Retention by tier",
      columns: ["Tier", "RPO"],
      rows: [["Tier 3", "90 days"]],
      pageStart: 8,
      confidence: 0.6,
    },
  });
  await prisma.ingestIssue.create({
    data: {
      documentId: standard.id,
      kind: "table_low_confidence",
      severity: "high",
      detail: "A table on page 8 extracted at low confidence.",
      page: 8,
    },
  });

  console.log("\nThe standard's own page, with the parse on it");
  const page = await visit(mine.cookie, `/dashboard/documents/${standard.id}`);
  ok("it renders", page.status === 200, page.status);
  ok("the outline is on it", page.body.includes("Retention"), page.status);
  ok(
    "with the rows that open, not a list of counts",
    page.body.includes("Open a section to see exactly what was taken out of it"),
  );
  ok("the counts are on it too", page.body.includes("Sections") && page.body.includes("Clauses"));
  ok(
    "and what the parse doubted is said here, not a click away",
    page.body.includes("A table on page 8 extracted at low confidence."),
  );
  ok(
    "it no longer sends the reader to a second page for any of it",
    !page.body.includes(`/dashboard/documents/${standard.id}/parsed`),
  );

  console.log("\nThe address that used to hold all this");
  const old = await visit(mine.cookie, `/dashboard/documents/${standard.id}/parsed`);
  ok("still answers", old.status === 200 || old.status === 307, old.status);
  ok(
    "and lands on the standard itself",
    lands(old) === `/dashboard/documents/${standard.id}`,
    lands(old) ?? old.body.slice(0, 200),
  );

  console.log("\nA design is left as it was: its page is a report");
  const design = await document(mine.org.id, "assessed", "LCL Proposal");
  await section(design.id, 16, "Proposed Tools");
  const report = await visit(mine.cookie, `/dashboard/documents/${design.id}`);
  ok("its page renders", report.status === 200, report.status);
  ok(
    "and still offers the parse as its own page",
    report.body.includes(`/dashboard/documents/${design.id}/parsed`),
  );
  const parsed = await visit(mine.cookie, `/dashboard/documents/${design.id}/parsed`);
  ok("which renders", parsed.status === 200, parsed.status);
  ok("with the design's outline on it", parsed.body.includes("Proposed Tools"), parsed.status);
} finally {
  await prisma.organisation.deleteMany({ where: { slug: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await prisma.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
