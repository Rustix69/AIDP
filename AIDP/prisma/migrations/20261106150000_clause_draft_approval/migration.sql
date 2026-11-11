-- Approving a standard and publishing it are two acts.
--
-- A clause draft is a standard written out of a real finding: the design broke
-- a rule the library states too vaguely to judge, and this is the sharper
-- wording. Until now it had one gate — a `ready` draft was applied straight
-- into the library by whoever read it, and the row recorded neither who agreed
-- the wording nor who decided the library should carry it, because they were
-- the same press.
--
-- They are not the same decision. Approving says "this sentence is right".
-- Publishing changes what every future assessment in this organisation is
-- measured against, supersedes a live clause, and cannot be taken back without
-- writing another version. Collapsing the two means the irreversible half
-- happens as a side effect of agreeing with a sentence.
--
-- So the gate becomes `ready -> approved -> applied`, and each step records its
-- own person and its own time. "Approved in March, published in June" is an
-- ordinary sequence and one timestamp cannot express it.
--
-- No state is renamed and nothing is backfilled: a draft sitting in `ready`
-- stays in `ready` and now reads as "pending review", which is what it always
-- was. Rows already in `applied` keep their state and simply have no approver
-- or publisher recorded, which is the truth about them — they were applied
-- before anybody was asked to sign off separately.
--
-- The Python workers are unaffected. They write only 'ready' and 'failed', and
-- act only on a row in 'drafting' (Workers/aidp/standards.py), so no worker can
-- move a draft past the point where a person takes over.

-- Who agreed the wording.
ALTER TABLE "clause_draft" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "clause_draft" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "clause_draft" ADD COLUMN "approvedByName" TEXT NOT NULL DEFAULT '';

-- Who put it into the library.
ALTER TABLE "clause_draft" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "clause_draft" ADD COLUMN "publishedById" TEXT;
ALTER TABLE "clause_draft" ADD COLUMN "publishedByName" TEXT NOT NULL DEFAULT '';

-- Both support the SET NULL below: without them, deleting a user sequentially
-- scans this table once per row removed.
CREATE INDEX "clause_draft_approvedById_idx" ON "clause_draft" ("approvedById");
CREATE INDEX "clause_draft_publishedById_idx" ON "clause_draft" ("publishedById");

-- The person does not cascade. Removing an employee must not erase the record
-- of what they signed off or published — the denormalised names beside these
-- are why the row still reads correctly afterwards.
ALTER TABLE "clause_draft" ADD CONSTRAINT "clause_draft_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clause_draft" ADD CONSTRAINT "clause_draft_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
