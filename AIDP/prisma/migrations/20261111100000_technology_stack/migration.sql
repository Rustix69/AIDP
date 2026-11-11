-- A technology stack: what this organisation has approved, and its position on
-- each thing.
--
-- Deliberately not clauses. A standards register states rules a design can
-- breach; a stack states facts about what is approved. `registers.detect` in
-- Workers/aidp/parsing/registers.py already refuses the stack template for
-- that reason — these tables are where its rows go instead.
--
-- Additive only: two new tables and no change to any existing one, so nothing
-- in flight is touched. Document.role gains a third value ("technology"), but
-- that column is already free text with a default, so no constraint moves.
CREATE TABLE "technology" (
    "id"               TEXT NOT NULL,
    "organisationId"   TEXT NOT NULL,
    "documentId"       TEXT NOT NULL,
    "name"             TEXT NOT NULL,
    "category"         TEXT NOT NULL DEFAULT '',
    -- adopt | trial | assess | hold. Defaults to the one that asserts least:
    -- an unreadable cell must not silently approve a technology.
    "status"           TEXT NOT NULL DEFAULT 'assess',
    "approvedVersions" TEXT NOT NULL DEFAULT '',
    "justification"    TEXT NOT NULL DEFAULT '',
    "scenarios"        TEXT NOT NULL DEFAULT '',
    "owner"            TEXT NOT NULL DEFAULT '',
    "addedDate"        TEXT NOT NULL DEFAULT '',
    "lastReviewedDate" TEXT NOT NULL DEFAULT '',
    "notes"            TEXT NOT NULL DEFAULT '',
    "ordinal"          INTEGER NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technology_pkey" PRIMARY KEY ("id")
);

-- Every change of a status, kept for good. Status decides what the next
-- assessment flags, so an edit that leaves no record is a silent change to
-- what the product will say about future designs.
CREATE TABLE "technology_change" (
    "id"           TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,
    -- Empty on the row the ingest writes: there was no previous position.
    "from"         TEXT NOT NULL DEFAULT '',
    "to"           TEXT NOT NULL,
    "byId"         TEXT,
    "byName"       TEXT NOT NULL DEFAULT '',
    -- "ingested" when the workbook said so, "edited" when a person did.
    "source"       TEXT NOT NULL DEFAULT 'edited',
    "note"         TEXT NOT NULL DEFAULT '',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technology_change_pkey" PRIMARY KEY ("id")
);

-- The stack has no identifier column, so the name is the identity. This is
-- what lets a re-parse update rows in place rather than doubling them.
CREATE UNIQUE INDEX "technology_documentId_name_key" ON "technology" ("documentId", "name");
CREATE INDEX "technology_organisationId_status_idx" ON "technology" ("organisationId", "status");
CREATE INDEX "technology_change_technologyId_createdAt_idx" ON "technology_change" ("technologyId", "createdAt");
CREATE INDEX "technology_change_byId_idx" ON "technology_change" ("byId");

ALTER TABLE "technology"
    ADD CONSTRAINT "technology_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "organisation" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technology"
    ADD CONSTRAINT "technology_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "document" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technology_change"
    ADD CONSTRAINT "technology_change_technologyId_fkey"
    FOREIGN KEY ("technologyId") REFERENCES "technology" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The name outlives the account, so the record still reads after a departure.
ALTER TABLE "technology_change"
    ADD CONSTRAINT "technology_change_byId_fkey"
    FOREIGN KEY ("byId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
