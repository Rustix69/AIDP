-- Whether this organisation has taken a clause into its own library.
--
-- Defaults to accepted for every existing row, which is what they already are:
-- the libraries in flight were uploaded deliberately and have been judged
-- against. A rejected clause is skipped by the clause query in
-- Workers/aidp/stages/analyse.py, so the default has to be the state that
-- changes nothing.
ALTER TABLE "clause" ADD COLUMN "adoption" TEXT NOT NULL DEFAULT 'accepted';

-- What a pending proposal is asking for. Every row written before adoption
-- proposals existed is a sharpening, which is what the default says.
ALTER TABLE "clause_draft" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'sharpen';

-- The adoption an adoption proposal asks for. Empty on a sharpening, and empty
-- on every existing row.
ALTER TABLE "clause_draft" ADD COLUMN "proposedAdoption" TEXT NOT NULL DEFAULT '';

-- An adoption proposal is raised from the standards library against a clause,
-- not from a finding against a design: there is no run and no verdict. Widening
-- only — no existing row loses its source.
ALTER TABLE "clause_draft" ALTER COLUMN "sourceFindingId" DROP NOT NULL;
ALTER TABLE "clause_draft" ALTER COLUMN "sourceRunId" DROP NOT NULL;
