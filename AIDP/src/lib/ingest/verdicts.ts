/**
 * Verdict vocabulary and shapes — no database, no server-only imports.
 *
 * Split out from assessment.ts so the client can have it. That module reaches
 * Prisma, which reaches `node:module`, and a client component importing it
 * fails the build with a chunking error that names the component rather than
 * the import that caused it.
 *
 * Anything here must stay pure and dependency-free.
 */

export const VERDICTS = [
  "contradicts",
  "absent",
  "partial",
  "not_assessable",
  "needs_review",
  "covered",
  "not_applicable",
] as const;

export type Verdict = (typeof VERDICTS)[number];

/**
 * Ordered worst-first: the review queue should open on what matters.
 *
 * ## The five things a reviewer means by "not covered"
 *
 * These are not interchangeable, and the engine was using them as though they
 * were. One real run marked a design `absent` on "Dell + VMware Infrastructure"
 * because it runs on Google Cloud, and `covered` on "Approved Platform-Specific
 * Deployments" because it names GKE. Both are category errors, not close calls.
 *
 * | What is actually the case | Status |
 * |---|---|
 * | The clause requires a component or mechanism and the design never engages it | `absent` |
 * | The design engages it, but the evidence needed to judge it is not in the document | `not_assessable` |
 * | The wording is genuinely open to two readings, so no answer is safe | `needs_review` |
 * | The clause's own stated condition excludes this architecture | `not_applicable` |
 * | The subject needs a standard the organisation has not supplied | **not a verdict** |
 *
 * The last row is the one that has no status, deliberately. A requirement the
 * company has never written down cannot be a finding against a design — a
 * finding is always measured against a clause in the indexed framework. Those
 * belong to `run.coverage`, which reports the parts of a design no clause
 * governs and names the standards that would cover them, as a proposal to
 * whoever owns the standards library. See Workers/aidp/coverage.py, whose
 * contract puts it plainly: never a requirement on a design.
 *
 * `not_assessable` is the verdict this vocabulary was missing, and its absence
 * was the engine's worst habit. "The design names GKE but includes no approval
 * record" is not a breach of an approval requirement — it is a document that
 * does not say. Having only `absent` for it, the report called it a gap and
 * `severityOf` called the gap Critical, so a missing page of paperwork arrived
 * beside a real breach and read the same. The two are now different answers:
 * `absent` is the design never engaging the clause's mechanism, which is a real
 * gap; `not_assessable` is the mechanism being there with the evidence needed to
 * judge it missing, which is a question for whoever wrote the document.
 */
export const VERDICT_META: Record<
  Verdict,
  { label: string; tone: "bad" | "warn" | "unknown" | "neutral" | "good"; blurb: string }
> = {
  contradicts: {
    label: "Contradicts",
    tone: "bad",
    blurb: "The design states something the standard forbids.",
  },
  absent: {
    label: "Absent",
    tone: "bad",
    blurb:
      "The design never engages this requirement's mechanism — the thing it asks for is " +
      "not in the architecture, not merely undocumented.",
  },
  partial: {
    label: "Partial",
    tone: "warn",
    blurb: "Addressed, but a requirement is left unmet.",
  },
  not_assessable: {
    label: "Not assessable",
    tone: "unknown",
    blurb:
      "The architecture engages this requirement, but the record needed to judge it — an " +
      "approval, a policy, a stated figure — is not in the document. A question for its author.",
  },
  needs_review: {
    label: "Needs review",
    tone: "unknown",
    blurb:
      "No answer is safe from what is written: the wording is open to two readings, or the " +
      "engine refused a conclusion the source did not support.",
  },
  covered: { label: "Covered", tone: "good", blurb: "Every requirement is met." },
  not_applicable: {
    label: "Not applicable",
    tone: "neutral",
    blurb:
      "A condition the clause itself states excludes this architecture. Never because the " +
      "document is silent — that is Not assessable.",
  },
};

/**
 * How strongly the clause binds, as the finding recorded it.
 *
 * Mirrors `Workers/aidp/obligations.py`. `unstated` is not a synonym for
 * advisory: it means the standard did not establish the obligation, and the
 * engine will not establish one on its behalf.
 */
export const OBLIGATIONS = ["must", "should", "may", "unstated"] as const;

export type Obligation = (typeof OBLIGATIONS)[number];

export const OBLIGATION_META: Record<Obligation, { label: string; blurb: string }> = {
  must: { label: "Mandatory", blurb: "The standard requires this." },
  should: { label: "Recommended", blurb: "The standard recommends this." },
  may: { label: "Optional", blurb: "The standard permits this." },
  /**
   * No label, on purpose.
   *
   * This read "Obligation unstated", which is jargon for a fact the reader
   * cannot act on, and it appeared on every finding from a standard written in
   * declarative prose — which is most of them, since enterprise standards say
   * "All external APIs are exposed through Apigee" rather than "APIs MUST be
   * exposed through Apigee". A badge on every card saying a word nobody uses
   * is noise, and a reader learns to skip the line it sits on.
   *
   * The fact underneath is still worth having, so the sentence stays and the
   * label goes: anywhere the UI shows a label it now shows nothing for this
   * case, and the explanation carries itself. `label: ""` rather than a
   * removed key so every consumer keeps working and none of them has to know
   * which obligations have labels.
   */
  unstated: {
    label: "",
    blurb:
      "This standard states the rule without saying whether it is mandatory, so how serious a breach would be is a judgement for a reviewer.",
  },
};

export function readObligation(value: unknown): Obligation {
  return OBLIGATIONS.includes(value as Obligation) ? (value as Obligation) : "unstated";
}

/**
 * A verdict this engine knows, or `needs_review` for one it does not.
 *
 * For the places that need a `Verdict` to index a label or seed a form. It is
 * deliberately *not* what `effectiveFinding` does to a verdict it does not
 * recognise: coercing there would rename the finding rather than describe it,
 * and a stored verdict from a future engine would start reporting as a real
 * `needs_review` and be counted as one. Severity needs no coercion at all —
 * `severityOf` already answers "a person has to look" for anything it has not
 * been taught.
 */
export function readVerdict(value: unknown): Verdict {
  return (VERDICTS as readonly string[]).includes(value as string)
    ? (value as Verdict)
    : "needs_review";
}

/**
 * How much a finding should worry the person reading it.
 *
 * Distinct from the verdict, and the distinction is the point. The verdict says
 * what the engine concluded; this says where to start. A reviewer with eighty
 * findings open is not asking "what category is this" — they are asking "which
 * of these do I have to deal with before the design ships".
 *
 * It replaced the model's confidence percentage on the row. That number was
 * answering a question nobody had: it is the model's opinion of itself, it does
 * not mean the gap is serious, and 87% next to "Contradicts" invited a reader
 * to treat a breach as 13% fine. The confidence is still there, inside the
 * finding, where somebody doubting a verdict will look for it.
 */
export const SEVERITIES = ["critical", "moderate", "check"] as const;

export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_META: Record<
  Severity,
  { label: string; tone: "bad" | "warn" | "unknown"; blurb: string }
> = {
  critical: {
    label: "Critical",
    tone: "bad",
    blurb: "A mandatory requirement is breached or unaddressed. Fix before this ships.",
  },
  moderate: {
    label: "Moderate",
    tone: "warn",
    blurb: "Worth resolving, but it does not have to block the design.",
  },
  check: {
    label: "Check",
    tone: "unknown",
    blurb: "Severity cannot be settled from the document. A person has to look.",
  },
};

/**
 * How serious this finding is, from what the finding already carries.
 *
 * Null for `covered` — there is nothing to act on, and a row that says
 * "Covered · Low" reads as a problem when it is the opposite.
 *
 * `contradicts` is never softened by confidence. The analyse stage is already
 * asymmetric about it: a contradiction with no evidence behind it is demoted
 * rather than reported, so one that reaches a screen has been through a
 * stricter gate than any other verdict, and the design actively stating
 * something the standard forbids is the worst thing this tool can find.
 */
export function severityOf(
  verdict: string,
  obligation: Obligation = "unstated",
): Severity | null {
  // Nothing to act on. A row reading "Covered · Low" reads as a problem when it
  // is the opposite, and the same is true of a clause that does not apply.
  if (verdict === "covered" || verdict === "not_applicable") return null;

  // An evidence gap is never Critical, whatever the obligation. The document
  // does not say; that is a question for its author, not a defect in the
  // architecture, and this is the single rule the brief is most insistent on.
  // A mandatory clause still earns priority over an advisory one, so the gaps
  // worth chasing first are the ones that block a mandatory judgement.
  if (verdict === "not_assessable") return obligation === "must" ? "moderate" : "check";

  // A breach is a breach. Softened only where the standard itself is explicit
  // that the rule is advisory — and never on `unstated`, because treating an
  // unclassified clause as advisory would be inventing permission.
  if (verdict === "contradicts") {
    return obligation === "should" || obligation === "may" ? "moderate" : "critical";
  }

  if (verdict === "absent") {
    // Critical needs two things: the design does not engage the mechanism, and
    // the standard says it has to. Without a stated obligation the impact
    // cannot be established, so this says so rather than inventing a level —
    // which is also what stops a missing section from outranking a real breach.
    if (obligation === "must") return "critical";
    if (obligation === "should" || obligation === "may") return "moderate";
    return "check";
  }

  if (verdict === "partial") return obligation === "may" ? "check" : "moderate";

  // needs_review, and anything a future engine adds that this has not been
  // taught: "a person has to look" is the safe answer, never "critical".
  return "check";
}

/**
 * The same finding on the brief's four-tier scale, which is not this engine's.
 *
 * FR-03 requires every finding to carry Critical / High / Medium / Low. This
 * engine grades on three, and the third is the whole reason: `check` says the
 * document does not settle how serious this is and a person has to look. Four
 * tiers have no slot for that, and folding it into "Low" would turn "nobody has
 * established the impact" into "the impact is small" — the one reading the
 * evidence does not support, and the exact mistake the three-tier scale was
 * introduced to stop.
 *
 * So both are kept and this is a translation, not a replacement. `SEVERITIES`
 * stays the engine's answer and stays what the reviewer works from; this is
 * what the report says to a reader who grades on four, with `settled` carrying
 * the part the fourth tier cannot say by itself.
 *
 * Derived from `severityOf` rather than read off the verdict a second time,
 * deliberately: two independent readings of the same two facts will eventually
 * disagree, and a finding labelled "Moderate" in one place and "Critical" in
 * another is worse than either label on its own.
 */
export const BRIEF_SEVERITIES = ["critical", "high", "medium", "low"] as const;

export type BriefSeverity = (typeof BRIEF_SEVERITIES)[number];

export const BRIEF_SEVERITY_LABEL: Record<BriefSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function briefSeverityOf(
  verdict: string,
  obligation: Obligation = "unstated",
): { tier: BriefSeverity; settled: boolean } | null {
  return briefFromSeverity(severityOf(verdict, obligation), verdict);
}

/**
 * The three-tier severity on the brief's four, given the verdict it belongs to.
 *
 * Split out of `briefSeverityOf` so that a severity a *reviewer* set maps to
 * the four tiers exactly as a derived one does. Two routes to the same scale
 * would eventually disagree, and a finding labelled High on the report and
 * Medium in the export is worse than either label alone — the same reasoning
 * that made `briefSeverityOf` derive from `severityOf` rather than read the
 * verdict a second time.
 *
 * `verdict` is still a parameter because the `moderate` tier splits on it, and
 * that split is about what the design did rather than how serious it is. It is
 * read here and never written: grading a finding cannot change what it is.
 */
export function briefFromSeverity(
  severity: Severity | null,
  verdict: string,
): { tier: BriefSeverity; settled: boolean } | null {
  // Nothing to act on, so nothing to grade — same answer, same reason.
  if (!severity) return null;

  if (severity === "critical") return { tier: "critical", settled: true };

  // The one this scale cannot express. Placed at the bottom tier because an
  // unquantified finding has to sit somewhere in a ranked list, and flagged
  // unsettled so a reader does not take the placement for a measurement.
  if (severity === "check") return { tier: "low", settled: false };

  // `moderate` covers two different things, and four tiers can tell them apart.
  // A shortfall is the design falling short of a clause it engaged: meeting a
  // requirement only in part, or stating something the standard advises
  // against. The rest of what lands here is a question rather than a
  // shortfall — an advisory clause the design never engages, or a mandatory one
  // the document leaves unevidenced, which is a matter for the author.
  const shortfall = verdict === "partial" || verdict === "contradicts";
  return { tier: shortfall ? "high" : "medium", settled: true };
}

/**
 * The engine's answer and the reviewer's, resolved into the one a reader sees.
 *
 * This is the only place that resolution happens, and it exists because for a
 * long time it happened nowhere. A reviewer could correct a verdict, the
 * correction was stored on `reviewerVerdict`, and the application read that
 * column in exactly one place — the decision promoter. Every severity, every
 * verdict count, the risk matrix, the report scorecard, the .docx export and
 * `nextStep`, which decides whether a submission goes to the board, all read
 * the engine's raw `verdict` and `obligation`. Overriding `contradicts` to
 * `covered` left the report calling it a critical breach and still routing the
 * submission to the board.
 *
 * So the rule is: nothing computes a severity from a bare verdict any more.
 * Callers pass the finding and take `severity` and `brief` from the result.
 *
 * ## Why the engine's answer is still in the row
 *
 * It is never overwritten, here or in the database. The disagreement between
 * what the model said and what a person decided is the only evaluation data
 * this product will ever have — it is what tells us how well the engine is
 * actually doing — and resolving the pair at read time keeps both. Every field
 * the result carries has its original beside it, and `corrected` says which
 * ones a person moved, so a screen can show the change rather than quietly
 * presenting a human judgement as the machine's.
 *
 * ## What counts as corrected
 *
 * A reviewer value that is absent, blank, or identical to the engine's is not a
 * correction. Confirming a verdict writes `reviewerVerdict = null` — agreement
 * is not a correction either, and the badge that says "corrected" has to mean
 * something or reviewers stop reading it.
 *
 * Pure, like everything else in this file: rows in, a view out, no database and
 * nothing server-only, so a client component can call it on the row it was
 * handed.
 */
export type ReviewableFinding = {
  /** The engine's verdict. */
  verdict: string;
  /** The engine's obligation. Typed loosely because the callers range from a
   *  Prisma row to a structural test fixture; `readObligation` refuses anything
   *  that is not one of the four. */
  obligation?: unknown;
  /** The engine's rationale. */
  rationale?: string | null;
  reviewerVerdict?: string | null;
  reviewerObligation?: string | null;
  /** A severity a reviewer put on this directly, overriding the derived one. */
  reviewerSeverity?: string | null;
  reviewerRationale?: string | null;
};

export type Corrections = {
  verdict: boolean;
  obligation: boolean;
  severity: boolean;
  rationale: boolean;
};

export type EffectiveFinding = {
  /**
   * What this finding says now, after any correction.
   *
   * Typed as a string rather than a `Verdict`, because a row may hold one this
   * build has never heard of — written by a newer engine, or by an older one
   * whose vocabulary has since changed. Narrowing it here would mean quietly
   * renaming that finding to `needs_review` everywhere it is read, which is how
   * a verdict nobody recognises ends up counted as one everybody does. Callers
   * that need a `Verdict` say so with `readVerdict`; callers that need a label
   * fall back to one.
   */
  verdict: string;
  obligation: Obligation;
  rationale: string;
  /**
   * Severity on the engine's three-tier scale: what a reviewer put there, or
   * what the verdict and obligation come to.
   *
   * Null where the verdict carries nothing to act on — `covered` and
   * `not_applicable` — whatever a reviewer may have stored. "Covered ·
   * Critical" is a row that reads as a problem when it is the opposite.
   */
  severity: Severity | null;
  /** The same finding on the brief's four tiers. */
  brief: { tier: BriefSeverity; settled: boolean } | null;
  /** Which of the three a person moved. */
  corrected: Corrections;
  /** True where any of them was. */
  edited: boolean;
  /** What the engine itself said, kept so a screen can show the change. */
  engine: {
    verdict: string;
    obligation: Obligation;
    rationale: string;
    /** The severity the verdict and obligation come to on their own. */
    severity: Severity | null;
  };
};

/** A reviewer value that is present, valid, and actually different. */
function correction<T extends string>(
  reviewer: string | null | undefined,
  engine: T,
  // Takes the trimmed string, never `unknown`: the value has already been
  // checked against the field's vocabulary by `allowed` on the line below.
  read: (value: string) => T,
  allowed: (value: string) => boolean,
): T | null {
  if (typeof reviewer !== "string") return null;
  const trimmed = reviewer.trim();
  if (!trimmed || !allowed(trimmed)) return null;
  const value = read(trimmed);
  return value === engine ? null : value;
}

export function effectiveFinding(finding: ReviewableFinding): EffectiveFinding {
  // Taken as it is. See the note on `verdict` above: a verdict this build does
  // not recognise is reported as itself, and `severityOf` grades it as "check".
  const engineVerdict = finding.verdict;
  const engineObligation = readObligation(finding.obligation);
  const engineRationale = finding.rationale ?? "";

  const verdict =
    correction<string>(
      finding.reviewerVerdict,
      engineVerdict,
      (value) => value,
      // A *correction* is held to the known vocabulary even though the engine's
      // own answer is not: nobody should be able to type a verdict into the
      // record that no screen can label and no severity rule has been taught.
      (value) => (VERDICTS as readonly string[]).includes(value),
    ) ?? engineVerdict;

  const obligation =
    correction<Obligation>(
      finding.reviewerObligation,
      engineObligation,
      readObligation,
      (value) => (OBLIGATIONS as readonly string[]).includes(value),
    ) ?? engineObligation;

  // Prose, so it cannot be validated against a vocabulary — only against being
  // blank, and against being what the engine already said.
  const written = finding.reviewerRationale?.trim() ?? "";
  const rationale = written && written !== engineRationale.trim() ? written : engineRationale;

  /**
   * Severity: what a reviewer put there, else what the two above come to.
   *
   * Read from its own field rather than inferred, and it is deliberately the
   * *last* thing resolved — it depends on the corrected verdict and obligation
   * and nothing depends on it. That ordering is what guarantees the property
   * the column exists to have: grading a finding cannot reclassify it. A
   * `contradicts` graded Moderate is still a contradiction, counted as one,
   * exported as one, and still a breach in the register. The severity control
   * is a priority, never a reclassification.
   *
   * The override is ignored outright where the verdict carries no severity, so
   * a grading left behind on a finding later corrected to `covered` cannot
   * resurface as "Covered · Critical".
   */
  const derived = severityOf(verdict, obligation);
  const severity =
    derived === null
      ? // Nothing to act on, so nothing to grade — and nothing a stored grading
        // can do about it.
        null
      : // Compared against the derived grade, so choosing the one it already has
        // stores no override: the same rule the other three fields follow.
        (correction<Severity>(
          finding.reviewerSeverity,
          derived,
          (value) => value as Severity,
          (value) => (SEVERITIES as readonly string[]).includes(value),
        ) ?? derived);

  const corrected: Corrections = {
    verdict: verdict !== engineVerdict,
    obligation: obligation !== engineObligation,
    severity: severity !== null && severity !== derived,
    rationale: rationale !== engineRationale,
  };

  return {
    verdict,
    obligation,
    rationale,
    severity,
    brief: briefFromSeverity(severity, verdict),
    corrected,
    edited:
      corrected.verdict || corrected.obligation || corrected.severity || corrected.rationale,
    engine: {
      verdict: engineVerdict,
      obligation: engineObligation,
      rationale: engineRationale,
      severity: severityOf(engineVerdict, engineObligation),
    },
  };
}

/**
 * The fields a reviewer may change, and what each one is called on screen.
 *
 * One list, so the edit form, the server action that validates a save and the
 * history panel that labels a past change cannot drift apart — the same
 * reasoning as `ROLES` in src/lib/access/roles.ts. Adding a field here is what
 * makes it editable; nothing else has a list of its own.
 *
 * `state` is in the vocabulary but not in the form: it is what the confirm and
 * override buttons move, and the history records it alongside the rest so a
 * reader sees one sequence of events rather than two.
 */
export const EDITABLE_FIELDS = [
  "verdict",
  "obligation",
  "severity",
  "rationale",
  "note",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const EDIT_FIELD_LABEL: Record<EditableField | "state", string> = {
  verdict: "Verdict",
  obligation: "Obligation",
  severity: "Severity",
  rationale: "Rationale",
  note: "Note",
  state: "Review",
};

export type VerdictCounts = Record<Verdict, number>;

/**
 * Which findings a report is showing.
 *
 * "attention" is what a report opens on: everything except covered. A covered
 * finding is the evidence that a clause was checked and passed — an audit asks
 * for exactly that, and a wrong one is the most expensive mistake this tool can
 * make, so they are folded rather than dropped and the count stays on screen.
 */
export type Lens = Verdict | "attention" | "all";

/**
 * Apply a lens. Pure, and separate from the component, so the rule can be
 * tested as a rule — the component is a Client Component, and every finding
 * reaches the browser in its props whether or not it is drawn, which makes
 * "is it on the page?" unanswerable from the HTML.
 */
export function applyLens<T extends { verdict: string }>(findings: T[], lens: Lens): T[] {
  if (lens === "all") return findings;
  // Covered and not-applicable are both "nothing to do here", and a review
  // queue that opens on them buries the findings that need a decision. Both
  // stay counted and both stay reachable by their own lens.
  if (lens === "attention") {
    return findings.filter(
      (finding) => finding.verdict !== "covered" && finding.verdict !== "not_applicable",
    );
  }
  return findings.filter((finding) => finding.verdict === lens);
}

export function emptyCounts(): VerdictCounts {
  return Object.fromEntries(VERDICTS.map((v) => [v, 0])) as VerdictCounts;
}

export type EvidenceItem = {
  chunkId: string;
  headingPath: string;
  page: number | null;
  excerpt: string;
  /** "clause" | "table_row" | "figure" | … — where the passage came from. */
  sourceKind: string;
  /**
   * Set only when the passage is a model's reading of a diagram. The finding
   * renders the diagram beside it, so the claim can be checked against the
   * thing it was made about.
   */
  figureId: string | null;
  /**
   * Which design the passage is from, on a run over a whole project. A page
   * number is not an address when four designs each have a page 12, so the
   * finding names the file. Empty on a design run, and on findings from before
   * projects could be assessed.
   */
  documentId: string;
  documentTitle: string;
  /**
   * The design's own words that a contradiction rests on, where the judge
   * named them and the worker verified them against the text the model was
   * shown. Null on every other passage, and on every finding assessed before
   * the judge was asked for it — the comparison is simply not drawn then,
   * rather than drawn around a guess.
   */
  breachQuote: string | null;
};

/**
 * The rationale with the model's extract ids taken out of it.
 *
 * The clause prompt makes a verdict cite the extracts it rests on, and the ids
 * it returns in `evidence` are what the finding's evidence cards are built
 * from. The model writes them into its prose as well — "lacks documented or
 * approved modular design exception (extracts cmvb8kzz94ba8da8bc2704870,
 * cmvb8l0404df309f3719faaf6)" — and a reviewer can do nothing with that. It is
 * an internal key, in the first sentence they read, on 58 of the 1,157
 * findings in this workspace.
 *
 * Stripped at read rather than at write, so the reports already stored lose
 * them too. The citation itself is not lost: it is the cards below the prose.
 */
export function withoutExtractIds(rationale: string): string {
  return (
    rationale
      // A bracket holding ids and nothing else but the words joining them:
      // "(extracts a, b)", "(extract a)", and the bare "(a, b)".
      .replace(ID_BRACKET, "")
      // An id the model ran into its own sentence, with the label it gave it.
      .replace(LABELLED_ID, "")
      // The phrase that introduced the reference, left pointing at nothing.
      // "...to avoid point-to-point silos, as shown in extracts a, b and c."
      // loses its object with the ids, and "as shown in." is not a sentence.
      // Only ever immediately before the punctuation that ended it, so a
      // "shown in" with something real after it is untouched.
      .replace(
        /[,;]?\s*\b(?:as\s+)?(?:shown|seen|described|evidenced|documented|listed)\s+(?:in|at|by)\s*(?=[.,;:)]|$)/gi,
        "",
      )
      .replace(/[,;]?\s*\bsee\s*(?=[.,;:)]|$)/gi, "")
      // Whatever the removal left behind: a doubled space, or a space pushed
      // up against the punctuation that followed the bracket.
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:)])/g, "$1")
      .replace(/\(\s*\)/g, "")
      .trim()
  );
}

/**
 * A cuid as Prisma writes one: `c` and 24 more, at least one of them a digit.
 *
 * The length is a range rather than the exact 25 every id in the database
 * actually has, because the model does not always copy one correctly. It
 * writes "cmuxvob4a36660c2633538f6" — 24 characters, an id that matches no
 * chunk — beside three that are real. A miscopied id is still an internal key
 * in a reviewer's sentence, and leaving it there because it is malformed
 * would show them the one reference they definitely cannot follow.
 *
 * The digit is what keeps this off English. A 21-letter lowercase word is not
 * something these rationales contain, but "c" plus twenty letters is a shape a
 * regex can find in a long compound noun, and a rationale with a word silently
 * removed is worse than one with an id left in.
 */
const EXTRACT_ID = String.raw`\bc(?=[a-z0-9]{20,28}\b)(?=[a-z0-9]*\d)[a-z0-9]{20,28}\b`;

const ID_BRACKET = new RegExp(
  String.raw`\s*\((?:\s*(?:extracts?|see|ids?)\b[:\s]*)?` +
    EXTRACT_ID +
    String.raw`(?:[\s,;]*(?:and\s+)?` +
    EXTRACT_ID +
    String.raw`)*\s*\)`,
  "gi",
);

const LABELLED_ID = new RegExp(
  String.raw`\s*\b(?:extracts?|ids?)\b[:\s]+` + EXTRACT_ID + String.raw`(?:[\s,;]*(?:and\s+)?` + EXTRACT_ID + String.raw`)*`,
  "gi",
);

// ------------------------------------------------- the rationale's shape
//
// Pure, and about the vocabulary of a verdict, so it lives here rather
// than in the component that used to own it — which also lets it be run
// against the stored findings without a JSX toolchain.

export const RATIONALE_PARTS = ["Gap", "Impact", "Fix"] as const;

/**
 * The same three sentences, named for a clause that passed.
 *
 * A covered finding has no gap and nothing to fix, so labelling its three
 * sentences "Gap / Impact / Fix" tells the reader the opposite of the verdict
 * directly above them. The judge writes the same shape either way — what the
 * clause wanted, what the design does about it, why that satisfies it — so only
 * the labels change.
 */
export const RATIONALE_PARTS_COVERED = ["Requirement", "Evidence", "Alignment"] as const;

/**
 * A fact the judge added after the three it was asked for.
 *
 * Nearly always a second design doing the same thing wrong, on a run that
 * judges a clause against a project rather than a document. It is not part of
 * the gap and not part of the impact, so it is named rather than absorbed.
 */
export const RATIONALE_PART_ALSO = "Also";

/**
 * The same three sentences, named for a clause nothing could be decided about.
 *
 * `not_assessable` is the one verdict where "Gap / Impact / Fix" is not merely
 * unhelpful but wrong. The verdict means the architecture *does* engage the
 * requirement and the record needed to judge it — an approval, a policy, a
 * stated figure — is not in the document. There is no gap in the design to
 * report and nothing in the design to fix: the action is to go and ask the
 * document's author for the missing record.
 *
 * The stored findings write that shape with unusual consistency — "the design
 * engages X but does not provide evidence of Y", "without these records,
 * compliance cannot be confirmed", "obtain and document Y to satisfy the
 * clause" — so these three name what is actually in the three sentences. 131
 * of this workspace's 155 not-assessable findings were labelled "Gap" and
 * "Fix" before this, telling a reviewer to go and change an architecture that
 * may well be correct.
 */
export const RATIONALE_PARTS_UNASSESSABLE = ["Missing", "Why it blocks", "To resolve"] as const;

/** Labels for a verdict: a passing clause is described, not remediated. */
export function rationaleLabels(verdict: string): readonly string[] {
  if (verdict === "covered" || verdict === "not_applicable") return RATIONALE_PARTS_COVERED;
  // Not a gap in the design — a gap in the record. See the constant above.
  if (verdict === "not_assessable") return RATIONALE_PARTS_UNASSESSABLE;
  return RATIONALE_PARTS;
}

/**
 * The marker the analyse stage leaves when a clause was never actually judged.
 *
 * `Workers/aidp/stages/analyse.py` records a failed model call as a
 * `needs_review` finding whose rationale says so. That is the right record to
 * keep — the clause genuinely has no verdict and the report must not pretend
 * otherwise — but it is not a judgement, and rendering it as one puts an API
 * failure in a compliance report in the voice of a reviewer.
 *
 * Worse, until the fix alongside this one that line interpolated the raw
 * provider payload, so 596 of this workspace's findings currently end in
 * `(400: {"error":{"message":"Provider returned error",...}}`. The worker no
 * longer writes that, but the stored findings still carry it and will until
 * they are re-run, so the tail is stripped on the way to the screen rather
 * than only at the source.
 *
 * Returns the clean sentence a reader can act on, or null when the rationale
 * is an ordinary judgement.
 */
const NOT_JUDGED_MARKERS = [
  // The current message, from `_judge_with_readings` in analyse.py.
  "This clause was not judged:",
  // An older one, no longer written but still stored on 14 findings here.
  "The model could not be reached for this clause",
];

/**
 * Where the human sentence ends and the machine's complaint begins.
 *
 * Three shapes appear in the stored findings, and the diagnostic always opens
 * with one of them: a parenthesis — `(400: {…}`, `(the platform's model key
 * was rejected by the provider (401): {…}` — a bare status code after a colon,
 * or the payload itself. Matching whichever comes first is safe here because
 * this is only ever applied to a machine-written template whose own prose
 * contains none of the three.
 */
const DIAGNOSTIC_TAIL = /\s*(?:\(|:\s*\d{3}\b|\{")[\s\S]*$/;

export function notJudged(rationale: string): string | null {
  const trimmed = rationale.trim();
  if (!NOT_JUDGED_MARKERS.some((marker) => trimmed.startsWith(marker))) return null;
  // Strip the diagnostic, then any unbalanced remnant of one: a payload cut to
  // a fixed width can leave an opening parenthesis with nothing to close it.
  let clean = trimmed.replace(DIAGNOSTIC_TAIL, "").replace(/\s*\($/, "").trim();
  if (!clean) return trimmed;
  if (!/[.!?]$/.test(clean)) clean += ".";
  return clean;
}

/**
 * A rationale split into gap, impact and fix.
 *
 * The judge is now told to write exactly those three, in that order, for any
 * verdict that is not "covered" (rules 8 and 11 in Workers/aidp/ai/llm.py). Run
 * together as one paragraph they read as the wall of text the whole change was
 * meant to remove — the three facts are there but the reader has to find the
 * boundaries, which is most of the work of skimming eighty findings.
 *
 * Split on sentence ends rather than on a delimiter the model was asked to
 * emit: a format token is one more instruction to disobey, and the sentences
 * are what the prompt actually constrains. Exactly three sentences is the
 * shape being labelled, so anything else — a one-line "covered", an older
 * finding written before the rule, a model that ignored it — is returned
 * unsplit and rendered as the paragraph it is. That is the honest fallback:
 * labelling two sentences "Gap" and "Impact" would promise a fix that was
 * never written.
 */
export function rationaleParts(rationale: string): string[] | null {
  const trimmed = rationale.trim();
  // A decimal or an abbreviation would split a sentence in the wrong place, so
  // require a space and a capital after the stop.
  const sentences = trimmed
    // A stop ends a sentence only when a space and a capital follow, which
    // keeps "TLS 1.2", "1.0" and "section 4.2" intact.
    //
    // The lookbehind then excludes the abbreviations that *do* take a capital
    // after them — "e.g. Kafka", "i.e. Apigee", "Acme Inc. Payments" — because
    // the budget is now 600 characters rather than 280, and a sentence with
    // room for an aside will contain one. Each is listed with its trailing dot,
    // since the split point sits after that dot and that is what the lookbehind
    // sees. A rationale that splits wrongly loses its labels and renders as a
    // paragraph, so this is worth being exact about.
    //
    // "etc." is deliberately absent: it ends a sentence at least as often as it
    // sits inside one, and guarding it broke the commoner case.
    .split(
      /(?<!\be\.g\.|\bi\.e\.|\bvs\.|\bcf\.|\bapprox\.|\bno\.|\bfig\.|\bincl\.|\bInc\.|\bLtd\.|\bDept\.)(?<=[.!?])\s+(?=[A-Z0-9"“'])/,
    )
    .map((part) => part.trim())
    .filter(Boolean);
  return sentences.length === RATIONALE_PARTS.length ? sentences : null;
}

/** The sentences of a rationale, by the rule `rationaleParts` splits on. */
function splitSentences(rationale: string): string[] {
  return (
    rationale
      .trim()
      .split(
        /(?<!\be\.g\.|\bi\.e\.|\bvs\.|\bcf\.|\bapprox\.|\bno\.|\bfig\.|\bincl\.|\bInc\.|\bLtd\.|\bDept\.)(?<=[.!?])\s+(?=[A-Z0-9"\u201C'])/,
      )
      .map((part) => part.trim())
      .filter(Boolean)
  );
}

/**
 * A sentence that tells the reviewer what to do, rather than what is wrong.
 *
 * Where the judge writes two sentences instead of three it is almost always
 * the impact it dropped, not the fix: "No extract addresses naming
 * conventions… The design must specify naming conventions for tables,
 * columns, keys, indexes, and views as per the clause." Labelling that second
 * sentence "Fix" is right, and labelling a second sentence that merely goes on
 * describing the gap "Fix" is a lie about what the reviewer is reading — so
 * the label is offered only to a sentence shaped like a remedy.
 *
 * Two shapes of remedy, because the judge writes it both ways. Most open with
 * the verb — "Replace direct SQL with governed APIs…" — and some name it
 * first: "The fix is to replace direct DB queries with well-defined APIs or
 * event-driven integration." Only the first was recognised, and the second
 * reads as a remedy to any reader, so both are.
 *
 * Worth being plain about the size of it: across 1,569 findings on verdicts
 * that ask for three parts, this names the fix on four that were unlabelled
 * before. It earns its place by being true rather than by the count — one of
 * the four is a breach a customer is reading right now.
 */
const FIX_OPENING =
  /^(?:to\s+(?:satisfy|comply|close|remediate|address)\b|(?:the\s+)?(?:fix|remedy|resolution|remediation)\s+(?:is|would\s+be|here\s+is)\b|(?:the\s+)?(?:design|document|team|project)\s+(?:must|should|needs\s+to|will\s+need)\b|(?:add|define|document|specify|implement|provide|establish|include|record|align|obtain|introduce|apply|create|update|replace|restrict|migrate|remediate|remove|enable|configure|capture|publish|approve|extend)\b)/i;

function looksLikeFix(sentence: string): boolean {
  return FIX_OPENING.test(sentence.trim());
}

/**
 * The rationale as labelled sections, or null when it cannot be labelled.
 *
 * Rule 8 of the clause prompt asks for GAP, IMPACT and FIX as three sentences
 * on a breach, and rule 7 asks for one sentence everywhere else — so a single
 * sentence is usually the judge doing as it was told, not a failure. What the
 * stored findings show is that the three-part shape mostly does not arrive:
 * of 851 findings on verdicts that ask for it, 69 have three sentences. The
 * rest are one or two, and no amount of splitting invents an impact the judge
 * never wrote.
 *
 * So this labels what is genuinely there and refuses to guess at the rest.
 * Nothing is dropped either way: a rationale with no labels is rendered as the
 * paragraph it is.
 */
export function rationaleSections(
  rationale: string,
  verdict: string,
): { label: string; text: string }[] | null {
  // Never labelled: this is a record of a failed call, not an argument, and
  // "Gap"/"Fix" over an API error is the engine speaking in a reviewer's voice.
  if (notJudged(rationale)) return null;

  const sentences = splitSentences(rationale);
  const labels = rationaleLabels(verdict);
  const [gap, impact, fix] = labels;

  if (sentences.length === 3) {
    return sentences.map((text, i) => ({ label: labels[i], text }));
  }

  // A passing clause is described rather than remediated, so its labels name
  // parts of an argument that only reads in order. Two of those three, or five
  // of them, is not that argument, and guessing which two would misdescribe it.
  if (verdict === "covered" || verdict === "not_applicable") return null;

  // More than three: the judge overran its sentence budget rather than
  // changing shape. The first is still the gap and the last is still the fix,
  // and what sits between them is the impact however many sentences it took.
  if (sentences.length > 3 && looksLikeFix(sentences[sentences.length - 1])) {
    return [
      { label: gap, text: sentences[0] },
      { label: impact, text: sentences.slice(1, -1).join(" ") },
      { label: fix, text: sentences[sentences.length - 1] },
    ];
  }

  // Four, with the fix third and something after it.
  //
  // This is the judge answering the clause and then adding a second design:
  // "...to enforce modular and loosely coupled architecture. Similarly, the
  // Rapid Campaign Launch Portal has two applications manipulating shared
  // tables, which breaches the clause." The three parts are all there, in
  // order, with a fourth fact following them — and because the last sentence
  // is not the fix, every branch above declined it and the reader was handed
  // the four-sentence paragraph the labels exist to break up. Two of this
  // workspace's seven contradictions read that way, both of them the breaches
  // that name two designs at once.
  //
  // The remark is labelled rather than folded into the impact or dropped: it
  // is a claim about a different design, which is exactly the thing a reader
  // must not have blurred into the finding's own subject.
  if (sentences.length === 4 && looksLikeFix(sentences[2])) {
    return [
      { label: gap, text: sentences[0] },
      { label: impact, text: sentences[1] },
      { label: fix, text: sentences[2] },
      { label: RATIONALE_PART_ALSO, text: sentences[3] },
    ];
  }

  // Two: the impact is the part that goes missing, so this is a gap and a
  // remedy — but only when the second sentence actually reads as one.
  if (sentences.length === 2 && looksLikeFix(sentences[1])) {
    return [
      { label: gap, text: sentences[0] },
      { label: fix, text: sentences[1] },
    ];
  }

  return null;
}

/**
 * A clause's citation with the part the title is about to say removed.
 *
 * `clauseRef` is the clause's address and `clauseTitle` is its name, and both
 * are printed side by side on every row and at the head of every finding. On
 * 415 of this workspace's 1,828 findings the address ends with the name, so the
 * two together read:
 *
 *   Design Guidelines Application (1) › APPLICATION POLICIES › Policy 5 – No
 *   Direct Database-to-Database Coupling Between Applications
 *   Policy 5 – No Direct Database-to-Database Coupling Between Applications
 *
 * All seven contradictions in the run a customer is reading are that shape,
 * with addresses of 71 to 130 characters. The row has one line: the address is
 * set in mono and never truncated, the title truncates, and the finding's own
 * sentence — the only part that says what is wrong — is what the ellipsis eats.
 * So the reader is given the location twice and the problem not at all.
 *
 * The same mistake as the evidence cards that opened with their own heading
 * path, and the same answer: say it once. The address keeps everything that
 * locates the clause, including a trailing number, because that is what an
 * auditor cites — "… › APPLICATION POLICIES", "… › Core Integration Principles
 * › 3." Only the duplicated name goes.
 *
 * Returns the address unchanged when the title is not its tail, when the title
 * is too short to be worth matching, and when removing it would leave nothing:
 * a clause whose whole reference is its name has no other address to give.
 */
export function clauseAddress(clauseRef: string, clauseTitle: string): string {
  const ref = clauseRef.trim();
  const title = clauseTitle.trim();
  // Two characters match too easily, and a numeric ref like "3.5" is the whole
  // address rather than a prefix to trim.
  if (title.length < 3 || !ref.toLowerCase().endsWith(title.toLowerCase())) return ref;
  const head = ref
    .slice(0, ref.length - title.length)
    .replace(/[\s›»>|:–—-]+$/, "")
    .trim();
  return head || ref;
}

/** `evidence` is Json in the schema; narrow it before rendering. */
/**
 * A quoted passage with the parts that are not the quote taken off it.
 *
 * Two things were printed on every evidence card that the card already said.
 *
 * A chunk's text begins with its own heading path, because that is what gets
 * embedded — "Workforce Analytics Hub (WAH) › 5 Integration design ILLUSTRATIVE
 * DESIGN | Based on…". The card prints the design and the heading above the
 * excerpt, so the reader is given the address, and then the address again as
 * the opening words of the evidence. On this workspace that is 6,068 of 6,099
 * cards and 462,000 characters of repetition, and it is the first thing a
 * reviewer's eye hits on every finding.
 *
 * And a passage cut to length was cut at the character — `body[:700]` — so half
 * of them end inside a word: "replace with gov…", "without demonstrated
 * gatew…". The worker now cuts at a space (see `Candidate.excerpt` in
 * retrieval.py); this trims the stump off the ones already stored, which is
 * every finding written before today.
 *
 * Done at read, like `withoutExtractIds`, so reports already written are fixed
 * by being opened rather than by being run again. Nothing is lost that was
 * information: the heading is still on the card, and the half-word was never
 * readable.
 */
export function readableExcerpt(excerpt: string, headingPath: string): string {
  let text = excerpt;

  const path = headingPath.trim();
  if (path && text.startsWith(path)) {
    text = text.slice(path.length).replace(/^[\s›|:–—-]+/, "");
    // The last part of the path often follows it a second time, on its own
    // line, because the chunk carries the section's title as well as its path.
    const leaf = path.split("›").pop()?.trim();
    if (leaf && text.startsWith(leaf)) {
      text = text.slice(leaf.length).replace(/^[\s›|:–—-]+/, "");
    }
  }

  // A trailing partial word, left by a cut at the character. Only where the
  // ellipsis says the passage was cut — a document may legitimately end mid
  // word if that is what it says.
  if (text.endsWith("…")) {
    const body = text.slice(0, -1).trimEnd();
    const lastSpace = body.lastIndexOf(" ");
    // Not if it would leave almost nothing: a short passage that is one long
    // token is better shown whole than reduced to an ellipsis.
    if (lastSpace > 40) text = `${body.slice(0, lastSpace).trimEnd()}…`;
  }

  return text.trim();
}

export function readEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.chunkId !== "string") return [];
    const headingPath = typeof row.headingPath === "string" ? row.headingPath : "";
    return [
      {
        chunkId: row.chunkId,
        headingPath,
        page: typeof row.page === "number" ? row.page : null,
        excerpt: readableExcerpt(
          typeof row.excerpt === "string" ? row.excerpt : "",
          headingPath,
        ),
        sourceKind: typeof row.sourceKind === "string" ? row.sourceKind : "clause",
        figureId: typeof row.figureId === "string" ? row.figureId : null,
        documentId: typeof row.documentId === "string" ? row.documentId : "",
        documentTitle: typeof row.documentTitle === "string" ? row.documentTitle : "",
        breachQuote:
          typeof row.breachQuote === "string" && row.breachQuote.trim()
            ? row.breachQuote.trim()
            : null,
      },
    ];
  });
}

/** A reading that disagreed with the verdict that was stored. */
export type Dissent = { verdict: string; rationale: string };

/**
 * How the readings of one clause voted, as a reviewer should be told it.
 *
 * The engine judges each clause more than once and keeps what most readings
 * said, because a model does not answer the same question the same way twice
 * and an assessment that moves between Tuesday and Thursday is not one an
 * architecture board can be shown. See `_vote` in
 * Workers/aidp/stages/analyse.py.
 *
 * Having done that, the report has to say so. "Three of three readings agreed"
 * and "two of three" are different claims about how settled a finding is, and
 * a reviewer deciding what to look at first is entitled to the difference —
 * it is a better guide to where their attention is worth spending than any
 * confidence number the model reports about itself.
 *
 * Null when there was nothing to vote on: one reading, or a finding written
 * before the engine took more than one, which is the same thing and reads the
 * same way.
 */
export function agreementOf(
  readings: number,
  agreed: number,
): { label: string; unanimous: boolean } | null {
  if (!Number.isFinite(readings) || readings <= 1) return null;
  const unanimous = agreed >= readings;
  return {
    label: unanimous
      ? `All ${readings} readings of this clause agreed.`
      : `${agreed} of ${readings} readings reached this verdict.`,
    unanimous,
  };
}

/** The readings that disagreed, in the shape they were stored. */
export function dissentOf(value: unknown): Dissent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.verdict !== "string" || !row.verdict) return [];
    return [
      {
        verdict: row.verdict,
        rationale: typeof row.rationale === "string" ? row.rationale : "",
      },
    ];
  });
}
