-- What the model answered, before any guard touched it.
--
-- "verdict", "confidence" and "rationale" are all post-guard: `_normalise` may
-- have promoted a described breach out of "partial", and `_guard` may have
-- demoted the verdict and prepended its own sentence to the rationale. That is
-- the right thing to show a reviewer. It was the wrong thing to keep as the
-- only record.
--
-- The cost of keeping only it: `_normalise`, `_guard_document`, `_guard` and
-- everything in fidelity.py are pure functions of the model's answer, the
-- clause and the evidence — so a change to any of them could have been
-- replayed for nothing against the findings already stored. The model's answer
-- was not stored, so it could not, and every guard or prompt experiment cost a
-- full run instead: 170 model calls on the client corpus.
--
-- Backfilled to '' and 0 rather than NULL, and the empty verdict is readable
-- as "this finding predates the column" — no model returns one.
ALTER TABLE "finding"
  ADD COLUMN "rawVerdict"    TEXT             NOT NULL DEFAULT '',
  ADD COLUMN "rawConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "rawRationale"  TEXT             NOT NULL DEFAULT '';
