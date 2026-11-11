/**
 * How an approved standard may be put into the library.
 *
 * A proposal drafted from a finding had exactly one outcome: the clause gained
 * the new requirement lines as a new version of itself and the old version was
 * superseded. That is right for a `partial` — a partial *means* the clause
 * could not be judged as written, so the clause is the thing at fault and the
 * clause is the thing that changes.
 *
 * It is wrong for a `contradicts`. The design stated something the standard
 * forbids, and what the breach often shows is that a *second* rule was missing,
 * not that the broken one was vague. "All external APIs are exposed through
 * Apigee" is not improved by bolting "applications must not connect directly to
 * another application's database" onto it: two rules about two things, and a
 * clause carrying both is harder to judge than either, so every later design
 * comes back `partial` against it.
 *
 * So a contradiction may be published either way and a partial only as a
 * sharpening. This checks the rule that decides it — pure, no database.
 *
 * Run with:  npx tsx scripts/verify-publish-mode.mts
 */
import {
  PUBLISH_MODES,
  PUBLISH_MODE_META,
  mayPublishSeparately,
  readPublishMode,
  readSourceVerdict,
} from "../src/lib/ingest/standards-vocabulary";

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

console.log("\nWho gets the choice");

ok("a contradiction may produce a rule of its own", mayPublishSeparately("contradicts"));
ok("a partial may not", !mayPublishSeparately("partial"));

// Drafts written before the column existed carry an empty verdict. They were
// all partials, because a partial was the only verdict a draft could be asked
// for, and they must not quietly gain a power they never had.
ok("a draft from before the column existed reads as a partial", readSourceVerdict("") === "partial");
ok("and so may not either", !mayPublishSeparately(""));
ok("nor may a verdict nobody recognises", !mayPublishSeparately("gravely_concerning"));

console.log("\nWhat the mode resolves to");

ok(
  "a contradiction asking to stand beside the original gets that",
  readPublishMode("separate", "contradicts") === "separate",
);
ok(
  "a partial asking for the same is given the sharpening instead",
  readPublishMode("separate", "partial") === "sharpen",
  readPublishMode("separate", "partial"),
);
ok("asking for nothing sharpens", readPublishMode(undefined, "contradicts") === "sharpen");
ok("so does asking for a mode that does not exist", readPublishMode("merge", "contradicts") === "sharpen");
ok("and so does a non-string", readPublishMode({ mode: "separate" }, "contradicts") === "sharpen");

// The default matters as much as the choice. Every proposal before this
// sharpened, and a default that quietly added rules to the library instead
// would be the wrong way round — a library grows by decision, not by omission.
ok("sharpening is the default in every case", PUBLISH_MODES[0] === "sharpen");

console.log("\nWhat each one tells the approver");

for (const mode of PUBLISH_MODES) {
  const meta = PUBLISH_MODE_META[mode];
  ok(`${mode} has a label, a blurb and an "after"`, Boolean(meta.label && meta.blurb && meta.after));
}
ok(
  "and the two say opposite things about the original",
  PUBLISH_MODE_META.sharpen.after.includes("superseded") &&
    PUBLISH_MODE_META.separate.after.includes("original"),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
