-- A clause's standing in the library becomes a status an administrator sets
-- directly, instead of an "adoption" proposed through the decision register.
--
-- The rule this encodes: decisions are how a new standard is promoted *into*
-- the library, and a standard already in the library must never travel back the
-- other way. There is one direction, and the far end of it is this column.
--
-- "accepted" becomes "active" and "rejected" becomes "suspended" — the words a
-- person uses about a standard they still have. The column is renamed rather
-- than replaced so no row's history is lost and nothing has to be backfilled
-- from somewhere else.

ALTER TABLE "clause" RENAME COLUMN "adoption" TO "status";
ALTER TABLE "clause" ALTER COLUMN "status" SET DEFAULT 'active';

UPDATE "clause" SET "status" = 'active'    WHERE "status" = 'accepted';
UPDATE "clause" SET "status" = 'suspended' WHERE "status" = 'rejected';

-- Anything else that somehow reached the column is left exactly as it is and
-- will be judged: `readClauseStatus` and the worker's query both treat an
-- unrecognised value as in force, because the failure that matters is silently
-- *not* measuring a design against a rule its owner still holds.

-- Every move of that column, kept.
--
-- `clauseId` carries no foreign key on purpose. A clause dies when its document
-- is re-parsed or removed; this records a person's decision about the library
-- and has to outlive the row it was about — the same argument that makes
-- finding."clauseId" a plain column.
CREATE TABLE "clause_status_change" (
    "id"             TEXT NOT NULL,
    "clauseId"       TEXT NOT NULL,
    "clauseRef"      TEXT NOT NULL DEFAULT '',
    "organisationId" TEXT NOT NULL,
    "from"           TEXT NOT NULL,
    "to"             TEXT NOT NULL,
    "reason"         TEXT NOT NULL DEFAULT '',
    "byId"           TEXT,
    "byName"         TEXT NOT NULL DEFAULT '',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clause_status_change_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clause_status_change_clauseId_createdAt_idx"
  ON "clause_status_change" ("clauseId", "createdAt");
CREATE INDEX "clause_status_change_organisationId_createdAt_idx"
  ON "clause_status_change" ("organisationId", "createdAt");
CREATE INDEX "clause_status_change_byId_idx"
  ON "clause_status_change" ("byId");

ALTER TABLE "clause_status_change"
  ADD CONSTRAINT "clause_status_change_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "organisation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "clause_status_change"
  ADD CONSTRAINT "clause_status_change_byId_fkey"
  FOREIGN KEY ("byId") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Any adoption proposal still in flight is closed rather than left in the
-- register pointing at a workflow that no longer exists. There were none when
-- this was written; this is here so that a database where there were is not
-- left showing a reviewer a dead end.
UPDATE "clause_draft"
   SET "state" = 'discarded'
 WHERE "kind" = 'adoption'
   AND "state" IN ('drafting', 'ready', 'approved');
