-- What the attached designs say the structured answers are.
--
-- The brief's Group C is "mandatory if no diagram; otherwise auto-extracted
-- from the diagram and shown for confirmation". Until now only the first half
-- existed: `architecture_request.diagramDocumentId` was read by the submission
-- gate and written by nothing, so the diagram branch could never be taken and
-- every requestor typed all eight fields by hand.
--
-- This table is the second half. A reading proposes; a person accepts;
-- accepting writes the ordinary column on architecture_request. Nothing
-- downstream — the significance check, the renderer, the report — ever reads
-- this table, which is what keeps a classification resting on what somebody
-- stated rather than on what a model inferred.
CREATE TABLE "intake_reading" (
    "id"              TEXT         NOT NULL,
    "organisationId"  TEXT         NOT NULL,
    "requestId"       TEXT         NOT NULL,
    "state"           TEXT         NOT NULL DEFAULT 'reading',
    "proposals"       JSONB        NOT NULL DEFAULT '[]',
    "acceptedFields"  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "readDocumentIds" TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    "model"           TEXT,
    "error"           TEXT,
    "requestedById"   TEXT,
    "requestedByName" TEXT         NOT NULL DEFAULT '',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_reading_pkey" PRIMARY KEY ("id")
);

-- One per request. A second reading replaces the first rather than
-- accumulating: the designs have changed, so the earlier inference describes a
-- submission that no longer exists.
CREATE UNIQUE INDEX "intake_reading_requestId_key" ON "intake_reading"("requestId");

CREATE INDEX "intake_reading_organisationId_state_idx"
    ON "intake_reading"("organisationId", "state");

ALTER TABLE "intake_reading"
    ADD CONSTRAINT "intake_reading_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascades, unlike the request's own document references. A reading is not a
-- governance record: it is working-out about a request, worthless once the
-- request is gone, and it holds nothing that has to survive it.
ALTER TABLE "intake_reading"
    ADD CONSTRAINT "intake_reading_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "architecture_request"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
