-- Which register of the product's own baseline library a document is a copy of.
--
-- Additive and nullable: every existing document was uploaded by somebody, so
-- NULL is the correct value for all of them and no backfill is needed. A seeded
-- copy is an ordinary reference document in every other respect — it reaches
-- the database through the same intake path an upload does — so nothing else
-- in the schema changes.
ALTER TABLE "document" ADD COLUMN "suppliedKey" TEXT;

-- The library screen asks "which of ours is this organisation still running
-- on?", which is this pair and nothing else.
CREATE INDEX "document_organisationId_suppliedKey_idx"
  ON "document" ("organisationId", "suppliedKey");
