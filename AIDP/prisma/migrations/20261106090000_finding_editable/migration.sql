-- A finding is editable, and the edit is what the report says.
--
-- Two halves, and they only work together.
--
-- The first: a reviewer could record a corrected *verdict* and nothing else.
-- The rationale — the sentence that reaches the board packet and the exported
-- report — was the engine's wording, take it or leave it, and the obligation
-- that decides how serious the finding is could not be touched at all. That
-- last one is the sharp edge: an enterprise standard written in declarative
-- prose ("All external APIs are exposed through Apigee") parses as 'unstated',
-- and severityOf deliberately refuses to invent an obligation, so a real breach
-- of a real rule was capped at Check. The reviewer who knows it is mandatory
-- now says so.
--
-- The second: the correction has to count. "reviewerVerdict" was written by the
-- review dialog and read in exactly one place in the application — the decision
-- promoter. Every severity, every verdict count, the risk matrix, the report
-- scorecard, the .docx export and the rule that routes a submission to the
-- board all read the engine's raw verdict and obligation. Overriding
-- 'contradicts' to 'covered' left the report calling it a critical breach and
-- still sending the submission to the board, which is a tool telling its own
-- reviewer that their judgement does not matter. Resolving the two is now
-- `effectiveFinding` in src/lib/ingest/verdicts.ts, and nothing computes a
-- severity without going through it.
--
-- Nothing the engine wrote is overwritten anywhere here. Every column added to
-- "finding" sits *beside* the engine's answer, exactly as "reviewerVerdict"
-- sits beside "verdict", because the disagreement between the two is the only
-- evaluation data this product will ever have and overwriting the model's
-- answer destroys it.
--
-- No Python worker reads or writes any of this. The workers address the
-- finding table by name and write the engine's own columns; these are the
-- application's, and the analyse stage is unaware of them.

-- How strongly the reviewer says the clause binds, where they disagree. NULL is
-- the normal state and means the engine's "obligation" stands — which is every
-- row that exists today, so there is nothing to backfill and nothing that
-- changes meaning. Not constrained to the four values in the database: the
-- vocabulary lives in OBLIGATIONS in src/lib/ingest/verdicts.ts and readObligation
-- already refuses anything that is not one of them, which is the same
-- arrangement every other vocabulary column in this schema has.
ALTER TABLE "finding" ADD COLUMN "reviewerObligation" TEXT;

-- The reviewer's own wording of why. NULL means the engine's "rationale"
-- stands.
ALTER TABLE "finding" ADD COLUMN "reviewerRationale" TEXT;

-- Who last touched this, and when. The current position only; the history is
-- "finding_edit" below. Denormalised name beside the id for the reason every
-- other person-reference in this schema gives: the report has to keep
-- attributing the correction after the account is deleted.
ALTER TABLE "finding" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "finding" ADD COLUMN "editedById" TEXT;
ALTER TABLE "finding" ADD COLUMN "editedByName" TEXT NOT NULL DEFAULT '';

-- One row per field changed, append-only.
--
-- A table rather than more columns on "finding", because a finding carries its
-- current position and this carries how it got there. "Who changed this verdict,
-- when, and what did they say about it" is what a governance audit asks, and a
-- column overwritten four times cannot answer it.
CREATE TABLE "finding_edit" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    -- Ties the rows written by one save together, so the panel reads as one
    -- event rather than as three a millisecond apart.
    "batch" TEXT NOT NULL,
    -- 'verdict' | 'obligation' | 'rationale' | 'note' | 'state'
    "field" TEXT NOT NULL,
    -- Text, not jsonb: every field recorded here is a short string or a
    -- paragraph, and a column an auditor can read with a plain SELECT beats one
    -- that needs unwrapping first.
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "editedById" TEXT,
    "editedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_edit_pkey" PRIMARY KEY ("id")
);

-- The history panel reads one finding newest-first. The only query this table
-- has.
CREATE INDEX "finding_edit_findingId_createdAt_idx" ON "finding_edit" ("findingId", "createdAt");

-- Supports the SET NULL below. Without it, deleting a user sequentially scans
-- this table once per row removed.
CREATE INDEX "finding_edit_editedById_idx" ON "finding_edit" ("editedById");

-- The finding is the governance record and its history belongs to it: if the
-- finding goes, so does this.
ALTER TABLE "finding_edit" ADD CONSTRAINT "finding_edit_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The person does not. Removing an employee must not erase the record of what
-- they corrected — "editedByName" is why the row still reads correctly
-- afterwards.
ALTER TABLE "finding_edit" ADD CONSTRAINT "finding_edit_editedById_fkey"
    FOREIGN KEY ("editedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
