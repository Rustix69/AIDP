-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requestId" TEXT,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "toEmail" TEXT,
    "toUserId" TEXT,
    "toName" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "providerId" TEXT,
    "lastError" TEXT,
    "correlationId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_dedupeKey_key" ON "notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "notification_state_runAfter_idx" ON "notification"("state", "runAfter");

-- CreateIndex
CREATE INDEX "notification_requestId_createdAt_idx" ON "notification"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_organisationId_createdAt_idx" ON "notification"("organisationId", "createdAt");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
