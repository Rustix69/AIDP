-- A contradiction can produce a second rule, not only a sharper one.
--
-- Publishing a proposed standard had exactly one outcome: the clause gained the
-- new requirement lines as a new version of itself, and the old version was
-- superseded. For a `partial` that is right and is the only sensible answer —
-- a partial *means* the clause could not be judged as written, so the clause
-- is the thing at fault and the clause is the thing that changes.
--
-- A `contradicts` is not that. The design stated something the standard
-- forbids, and what the breach often shows is that a second, separate rule was
-- missing — not that the rule it broke was vague. "All external APIs are
-- exposed through Apigee" is not improved by bolting "direct database-to-
-- application connections are prohibited" onto it; those are two rules about
-- two things, and merging them produces a clause that is harder to judge than
-- either, against which every future design will come back `partial`.
--
-- So a contradiction may now be published either way, and the choice is made
-- by the administrator at publish time rather than assumed here.
--
-- Two columns, both additive and both defaulting to empty, so every existing
-- row keeps its current meaning and nothing is backfilled.

-- Which verdict the draft was written from, copied at the moment it was asked
-- for. Denormalised rather than read back off the finding, for the reason
-- "clauseRef" on the same table is: a proposal has to keep stating its own case
-- after the finding behind it has been corrected, re-run or removed. It is also
-- what decides which publish modes are offered.
--
-- Empty on rows that predate this. Those are all sharpenings from a partial,
-- because a partial was the only verdict a draft could be asked for until now,
-- and the code reads an empty value as exactly that.
ALTER TABLE "clause_draft" ADD COLUMN "sourceVerdict" TEXT NOT NULL DEFAULT '';

-- How it was published: 'sharpen' or 'separate'. Empty until it is.
--
-- Recorded because the two leave the library in genuinely different states and
-- a reader cannot tell which happened by looking at the clause afterwards: a
-- sharpening leaves a superseded predecessor pointing at its replacement, a
-- separate clause leaves no trace on the original at all.
ALTER TABLE "clause_draft" ADD COLUMN "publishMode" TEXT NOT NULL DEFAULT '';
