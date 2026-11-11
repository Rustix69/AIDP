/**
 * Editing a finding, and the edit actually counting.
 *
 * A reviewer used to have one move beyond agreeing with the engine: swap the
 * verdict and leave a note. The rationale that reaches the board packet and the
 * obligation that decides the severity were the engine's, take them or leave
 * them. Worse, the one correction they *could* make was read in a single place
 * in the whole application — so overriding `contradicts` to `covered` left the
 * report calling it a critical breach and still routing the submission to a
 * board.
 *
 * Both halves are checked here, because only together are they a feature:
 *
 *   1. `effectiveFinding` resolves the engine's answer and the reviewer's into
 *      the one a reader is shown, and refuses to call agreement a correction.
 *   2. The resolution reaches the things built on top of it — the severity, the
 *      risk matrix, and the rule that decides where a submission goes next.
 *
 * Pure: no database, no model. The write path and its history live in
 * src/lib/ingest/finding-edits.ts, which needs one.
 *
 * Run with:  npx tsx scripts/verify-finding-edit.mts
 */
import {
  effectiveFinding,
  readVerdict,
  type ReviewableFinding,
} from "../src/lib/ingest/verdicts";
import { planEdit, type FindingRow } from "../src/lib/ingest/finding-edit-plan";
import { buildRisk, type RiskFinding } from "../src/lib/ingest/risk";
import { nextStep } from "../src/lib/ingest/next-step";
import type { AdviceView } from "../src/lib/ingest/advice";

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

/** A finding as the engine left it, before anyone touched it. */
const engine = (
  verdict: string,
  obligation = "unstated",
  rationale = "The design never engages this.",
): ReviewableFinding => ({ verdict, obligation, rationale });

// ---------------------------------------------------------------------------
console.log("\nWith nobody having touched it, the engine's answer stands");

const untouched = effectiveFinding(engine("contradicts", "must"));
ok("the verdict is the engine's", untouched.verdict === "contradicts");
ok("the obligation is the engine's", untouched.obligation === "must");
ok("a mandatory breach is Critical", untouched.severity === "critical", untouched.severity);
ok("and nothing reads as corrected", !untouched.edited, untouched.corrected);

// ---------------------------------------------------------------------------
console.log("\nA correction is what a reader sees");

const overturned = effectiveFinding({
  ...engine("contradicts", "must"),
  reviewerVerdict: "covered",
});
ok("the reviewer's verdict wins", overturned.verdict === "covered");
ok("a covered clause has no severity to act on", overturned.severity === null);
ok("the verdict reads as corrected", overturned.corrected.verdict && overturned.edited);
ok(
  "and the engine's own answer is still there to show",
  overturned.engine.verdict === "contradicts",
  overturned.engine,
);

const reworded = effectiveFinding({
  ...engine("partial", "should"),
  reviewerRationale: "Retries are specified; there is no dead-letter path.",
});
ok(
  "a rewritten rationale is the one shown",
  reworded.rationale === "Retries are specified; there is no dead-letter path.",
);
ok("and the engine's wording is kept", reworded.engine.rationale === "The design never engages this.");
ok("the verdict is untouched by it", !reworded.corrected.verdict && reworded.corrected.rationale);

// ---------------------------------------------------------------------------
console.log("\nThe obligation is why this exists");

// An enterprise standard written in declarative prose — "All external APIs are
// exposed through Apigee" — parses as `unstated`, and severityOf will not
// invent an obligation on the standard's behalf. So a real breach of a real
// rule caps at Check until a person says otherwise.
const unstated = effectiveFinding(engine("absent", "unstated"));
ok("an unstated obligation caps an absence at Check", unstated.severity === "check", unstated.severity);

const established = effectiveFinding({
  ...engine("absent", "unstated"),
  reviewerObligation: "must",
});
ok(
  "a reviewer establishing it as mandatory makes the same finding Critical",
  established.severity === "critical",
  established.severity,
);
ok("and it says who moved it", established.corrected.obligation);
ok(
  "it reports as Critical on the brief's four tiers too, and settled",
  established.brief?.tier === "critical" && established.brief.settled,
  established.brief,
);

// ---------------------------------------------------------------------------
console.log("\nWhat does not count as a correction");

const agreed = effectiveFinding({ ...engine("partial"), reviewerVerdict: null });
ok("confirming writes no verdict, so nothing is corrected", !agreed.edited);

const same = effectiveFinding({ ...engine("partial"), reviewerVerdict: "partial" });
ok("choosing the engine's own answer is not a correction", !same.corrected.verdict);

const blank = effectiveFinding({ ...engine("partial"), reviewerRationale: "   " });
ok("a blank rationale falls back to the engine's", blank.rationale === "The design never engages this.");

const nonsense = effectiveFinding({ ...engine("partial"), reviewerVerdict: "quite bad" });
ok("a verdict outside the vocabulary is refused", nonsense.verdict === "partial", nonsense.verdict);

const badObligation = effectiveFinding({
  ...engine("absent", "must"),
  reviewerObligation: "mandatory-ish",
});
ok("so is an obligation outside it", badObligation.obligation === "must", badObligation.obligation);

// ---------------------------------------------------------------------------
console.log("\nA verdict this build has never heard of");

// Written by a newer engine, or by an older one whose vocabulary has moved.
// Reported as itself rather than renamed: coercing it to `needs_review` here
// would have it counted as a real one everywhere downstream.
const unknown = effectiveFinding(engine("gravely_concerning", "must"));
ok("is reported as itself", unknown.verdict === "gravely_concerning", unknown.verdict);
ok("and graded as 'a person has to look'", unknown.severity === "check", unknown.severity);
ok("readVerdict is the opt-in coercion, for the places that need one", readVerdict("gravely_concerning") === "needs_review");
ok("and it leaves a known verdict alone", readVerdict("contradicts") === "contradicts");

// ---------------------------------------------------------------------------
console.log("\nSeverity is its own lever, and it cannot move the verdict");

// The rule this whole column exists under. A reviewer grading a finding is
// setting a priority, not reclassifying it: a severity control that quietly
// turned a contradiction into something else would let somebody retire a breach
// out of the register by adjusting how urgent it looks.
const graded = effectiveFinding({
  ...engine("contradicts", "must"),
  reviewerSeverity: "moderate",
});
ok("a graded contradiction is still a contradiction", graded.verdict === "contradicts");
ok("the grade is the reviewer's", graded.severity === "moderate", graded.severity);
ok("and it reports as High, not Critical", graded.brief?.tier === "high", graded.brief);
ok("the verdict does not read as corrected", !graded.corrected.verdict, graded.corrected);
ok("the severity does", graded.corrected.severity);

const raised = effectiveFinding({ ...engine("partial", "may"), reviewerSeverity: "critical" });
ok("a partial raised to Critical is still partial", raised.verdict === "partial");
ok("and grades Critical", raised.severity === "critical" && raised.brief?.tier === "critical");

// The other direction a grading must not reach: an unstated obligation caps the
// *derived* severity, and a reviewer can lift that without touching the clause.
const liftedDirectly = effectiveFinding({
  ...engine("absent", "unstated"),
  reviewerSeverity: "critical",
});
ok(
  "grading lifts a severity the standard's silence had capped",
  liftedDirectly.severity === "critical",
  liftedDirectly.severity,
);
ok(
  "without claiming the standard said anything it did not",
  liftedDirectly.obligation === "unstated" && !liftedDirectly.corrected.obligation,
);

// Nothing to act on means nothing to grade, whatever is stored.
const covered = effectiveFinding({ ...engine("covered"), reviewerSeverity: "critical" });
ok("a covered finding has no severity, whatever is on it", covered.severity === null, covered.severity);
ok("and nothing reads as graded", !covered.corrected.severity);

const settled = effectiveFinding({ ...engine("absent", "unstated") });
ok("left alone, an unstated absence is still unsettled at the bottom tier",
  settled.brief?.tier === "low" && settled.brief.settled === false, settled.brief);
const nowSettled = effectiveFinding({
  ...engine("absent", "unstated"),
  reviewerSeverity: "moderate",
});
ok(
  "a person grading it makes the tier a settled one",
  nowSettled.brief?.settled === true,
  nowSettled.brief,
);

const redundant = effectiveFinding({
  ...engine("contradicts", "must"),
  reviewerSeverity: "critical",
});
ok(
  "choosing the grade it already derives is not a correction",
  !redundant.corrected.severity && redundant.severity === "critical",
  redundant.corrected,
);

const bogus = effectiveFinding({ ...engine("contradicts", "must"), reviewerSeverity: "urgent" });
ok("a severity outside the vocabulary is refused", bogus.severity === "critical", bogus.severity);

// ---------------------------------------------------------------------------
console.log("\nThe correction reaches the risk matrix");

const advice = {
  suggestions: [{ category: "security", priority: "high", clauses: ["§3.2"] }],
} as unknown as AdviceView;

const breach: RiskFinding = { clauseRef: "§3.2", verdict: "contradicts", obligation: "must" };
const securityOf = (finding: RiskFinding) =>
  buildRisk([finding], advice, null).rows.find((r) => r.dimension === "security")!;

ok("a mandatory breach grades security Critical", securityOf(breach).severity === "critical", securityOf(breach).severity);
ok(
  "overturning it takes the dimension off Critical",
  securityOf({ ...breach, reviewerVerdict: "covered" }).severity !== "critical",
  securityOf({ ...breach, reviewerVerdict: "covered" }).severity,
);
ok(
  "and softening the obligation moves it down rather than off",
  securityOf({ ...breach, reviewerObligation: "should" }).severity === "high",
  securityOf({ ...breach, reviewerObligation: "should" }).severity,
);

// ---------------------------------------------------------------------------
console.log("\nAnd the correction reaches where the submission goes next");

// The failure this whole change exists to fix: before it, a reviewer could
// overturn every breach in a report and the submission would still be routed to
// an architecture review board on the strength of findings nobody stood behind.
const counts = (critical: number) => ({ critical, high: 0, medium: 0, low: 0 });

const before = nextStep({
  significance: "not_significant",
  counts: counts(1),
  unsettled: 0,
  unreviewed: 0,
});
ok("one critical finding routes a submission away from the fast path", before.route !== "auto_approve", before.route);

const after = nextStep({
  significance: "not_significant",
  counts: counts(0),
  unsettled: 0,
  unreviewed: 0,
});
ok(
  "with it overturned, an insignificant submission can take the fast path",
  after.route === "auto_approve",
  after.route,
);

// ---------------------------------------------------------------------------
console.log("\nWhat a save decides, before it touches the database");

const row = (over: Partial<FindingRow> = {}): FindingRow => ({
  verdict: "contradicts",
  obligation: "unstated",
  rationale: "The design never engages this.",
  reviewerVerdict: null,
  reviewerObligation: null,
  reviewerSeverity: null,
  reviewerRationale: null,
  reviewerNote: null,
  reviewerState: "pending",
  ...over,
});

// The regression this split exists to catch. Confirming a pending finding means
// agreeing with the engine, which writes null over a null — so a rule keyed on
// "did the column change?" leaves it pending for ever, and the most common
// action in the product silently does nothing.
const confirmed = planEdit(row(), { verdict: null });
ok(
  "confirming a pending finding records it as confirmed",
  confirmed.data.reviewerState === "confirmed" && confirmed.state?.to === "confirmed",
  confirmed,
);
ok("and stamps it reviewed", confirmed.reviewed);
ok("the history gains the state move", confirmed.events.some((e) => e.field === "state"));
ok(
  "but not a verdict row, because the verdict did not move",
  !confirmed.events.some((e) => e.field === "verdict"),
  confirmed.events,
);

const overrode = planEdit(row(), { verdict: "covered" });
ok("correcting the verdict records an override", overrode.data.reviewerState === "overridden");
ok(
  "and the history says what it moved between",
  overrode.events.some(
    (e) => e.field === "verdict" && e.before === "contradicts" && e.after === "covered",
  ),
  overrode.events,
);

const reverted = planEdit(
  row({ reviewerVerdict: "covered", reviewerState: "overridden" }),
  { verdict: "contradicts" },
);
ok(
  "coming back to the engine's answer clears the override and confirms",
  reverted.data.reviewerVerdict === null && reverted.data.reviewerState === "confirmed",
  reverted.data,
);

// A finding can be unreviewed and better explained. Marking it reviewed because
// somebody tidied its wording would make the register's "Unreviewed" a lie.
const tidied = planEdit(row(), { rationale: "Session state is held in memory." });
ok("rewording alone does not adjudicate the finding", tidied.state === null && !tidied.reviewed);
ok("but it is still recorded", tidied.events.some((e) => e.field === "rationale"), tidied.events);

const sharpened = planEdit(row(), { obligation: "must" });
ok(
  "nor does sharpening the obligation",
  sharpened.state === null && sharpened.data.reviewerObligation === "must",
  sharpened.data,
);

const gradedPlan = planEdit(row(), { severity: "moderate" });
ok(
  "grading writes only the severity column",
  gradedPlan.data.reviewerSeverity === "moderate" &&
    gradedPlan.data.reviewerVerdict === undefined,
  gradedPlan.data,
);
ok("and does not adjudicate the finding", gradedPlan.state === null && !gradedPlan.reviewed);
ok(
  "the history says what the grade moved between",
  gradedPlan.events.some(
    (e) => e.field === "severity" && e.before === "critical" && e.after === "moderate",
  ),
  gradedPlan.events,
);

// Derived from where the save lands, not where it started: sharpening the
// obligation and grading to what that now produces stores no override at all.
const together = planEdit(
  row({ verdict: "absent", obligation: "unstated" }),
  { obligation: "must", severity: "critical" },
);
ok(
  "a grade equal to what this save now derives stores nothing",
  together.data.reviewerSeverity === undefined &&
    !together.events.some((e) => e.field === "severity"),
  together.data,
);

const ungraded = planEdit(
  row({ reviewerSeverity: "check" }),
  { severity: null },
);
ok("clearing a grade puts it back to derived", ungraded.data.reviewerSeverity === null, ungraded.data);

let badGrade = false;
try {
  planEdit(row(), { severity: "urgent" });
} catch {
  badGrade = true;
}
ok("a severity outside the vocabulary is refused outright", badGrade);

const nothing = planEdit(row({ reviewerNote: "Agreed." }), { note: "Agreed." });
ok("a save that moves nothing plans nothing", nothing.events.length === 0, nothing);

const backToEngine = planEdit(row(), { obligation: "unstated" });
ok(
  "choosing the engine's own obligation stores no override",
  backToEngine.events.length === 0,
  backToEngine.events,
);

let refused = false;
try {
  planEdit(row(), { verdict: "quite bad" });
} catch {
  refused = true;
}
ok("a verdict outside the vocabulary is refused outright", refused);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
