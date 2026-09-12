-- Additive only: no financial or existing business table is changed.
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('FINANCE_CHAT', 'WIKI_CHAT', 'INVOICE_EXTRACT')),
    "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED')),
    "payloadJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "errorCode" TEXT,
    "idempotencyKey" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
    "workerId" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiJob_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiJob_running_lease_check" CHECK ("status" != 'RUNNING' OR ("workerId" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL))
);

CREATE UNIQUE INDEX "AiJob_ownerUserId_idempotencyKey_key" ON "AiJob"("ownerUserId", "idempotencyKey");
CREATE INDEX "AiJob_status_priority_createdAt_idx" ON "AiJob"("status", "priority", "createdAt");
CREATE INDEX "AiJob_ownerUserId_createdAt_idx" ON "AiJob"("ownerUserId", "createdAt");
-- A database guard, including for concurrent clients that bypass application code.
CREATE UNIQUE INDEX "AiJob_single_running" ON "AiJob"("status") WHERE "status" = 'RUNNING';

CREATE TABLE "AiQueueLease" (
    "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'shared-ai'),
    "workerId" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" DATETIME,
    "pauseReason" TEXT CHECK ("pauseReason" IS NULL OR "pauseReason" IN ('QUOTA', 'AUTH', 'MODEL_UNAVAILABLE')),
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiQueueLease_complete_lease_check" CHECK (
      ("workerId" IS NULL AND "leaseToken" IS NULL AND "leaseUntil" IS NULL) OR
      ("workerId" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    )
);
