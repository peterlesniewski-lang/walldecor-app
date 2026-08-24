-- Durable installation visits, scope assignments, and a provider-agnostic
-- calendar synchronization outbox. Lifecycle values remain TEXT because
-- SQLite has no native enum type.
CREATE TABLE "InstallationVisit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Warsaw',
    "note" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" DATETIME,
    "cancelledAt" DATETIME,
    "completedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationVisit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationVisit_time_check" CHECK (
      ("startsAt" IS NULL AND "endsAt" IS NULL)
      OR ("startsAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" > "startsAt")
    )
);

CREATE TABLE "InstallationVisitScope" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstallationVisitScope_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "InstallationVisit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationVisitScope_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationVisitScope_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "InstallationScope" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InstallationScopeAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstallationScopeAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationScopeAssignment_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "InstallationScope" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationScopeAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "IntegrationSyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GOOGLE_CALENDAR',
    "status" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "externalId" TEXT,
    "externalUrl" TEXT,
    "externalEtag" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "lastAttemptAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationSyncState_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "InstallationVisit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "IntegrationOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visitId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "forceOverwrite" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" DATETIME,
    "completedAt" DATETIME,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationOutbox_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "InstallationVisit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "IntegrationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outboxId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationAttempt_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "IntegrationOutbox" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "InstallationVisit_orderId_status_startsAt_idx" ON "InstallationVisit"("orderId", "status", "startsAt");
CREATE UNIQUE INDEX "InstallationVisitScope_visitId_scopeId_key" ON "InstallationVisitScope"("visitId", "scopeId");
CREATE INDEX "InstallationVisitScope_orderId_scopeId_idx" ON "InstallationVisitScope"("orderId", "scopeId");
CREATE UNIQUE INDEX "InstallationScopeAssignment_scopeId_employeeId_key" ON "InstallationScopeAssignment"("scopeId", "employeeId");
CREATE INDEX "InstallationScopeAssignment_orderId_employeeId_idx" ON "InstallationScopeAssignment"("orderId", "employeeId");
CREATE UNIQUE INDEX "IntegrationSyncState_visitId_kind_key" ON "IntegrationSyncState"("visitId", "kind");
CREATE UNIQUE INDEX "IntegrationSyncState_kind_externalId_key" ON "IntegrationSyncState"("kind", "externalId");
CREATE INDEX "IntegrationSyncState_status_updatedAt_idx" ON "IntegrationSyncState"("status", "updatedAt");
CREATE UNIQUE INDEX "IntegrationOutbox_idempotencyKey_key" ON "IntegrationOutbox"("idempotencyKey");
CREATE INDEX "IntegrationOutbox_status_availableAt_lockedUntil_idx" ON "IntegrationOutbox"("status", "availableAt", "lockedUntil");
CREATE INDEX "IntegrationOutbox_visitId_revision_idx" ON "IntegrationOutbox"("visitId", "revision");
CREATE UNIQUE INDEX "IntegrationAttempt_outboxId_number_key" ON "IntegrationAttempt"("outboxId", "number");
CREATE INDEX "IntegrationAttempt_outboxId_createdAt_idx" ON "IntegrationAttempt"("outboxId", "createdAt");

CREATE TRIGGER "InstallationVisit_time_insert_guard"
BEFORE INSERT ON "InstallationVisit"
FOR EACH ROW WHEN (
  (NEW."startsAt" IS NULL AND NEW."endsAt" IS NOT NULL)
  OR (NEW."startsAt" IS NOT NULL AND NEW."endsAt" IS NULL)
  OR (NEW."startsAt" IS NOT NULL AND NEW."endsAt" IS NOT NULL AND NEW."endsAt" <= NEW."startsAt")
)
BEGIN
  SELECT RAISE(ABORT, 'InstallationVisit_time_insert_guard');
END;

CREATE TRIGGER "InstallationVisit_time_update_guard"
BEFORE UPDATE ON "InstallationVisit"
FOR EACH ROW WHEN (
  (NEW."startsAt" IS NULL AND NEW."endsAt" IS NOT NULL)
  OR (NEW."startsAt" IS NOT NULL AND NEW."endsAt" IS NULL)
  OR (NEW."startsAt" IS NOT NULL AND NEW."endsAt" IS NOT NULL AND NEW."endsAt" <= NEW."startsAt")
)
BEGIN
  SELECT RAISE(ABORT, 'InstallationVisit_time_update_guard');
END;

CREATE TRIGGER "InstallationVisitScope_order_insert_guard"
BEFORE INSERT ON "InstallationVisitScope"
FOR EACH ROW WHEN (
  NOT EXISTS (
    SELECT 1
    FROM "InstallationScope" scope
    JOIN "InstallationRoom" room ON room."id" = scope."roomId"
    WHERE scope."id" = NEW."scopeId" AND room."orderId" = NEW."orderId"
  )
  OR NOT EXISTS (
    SELECT 1
    FROM "InstallationVisit" visit
    WHERE visit."id" = NEW."visitId" AND visit."orderId" = NEW."orderId"
  )
)
BEGIN
  SELECT RAISE(ABORT, 'InstallationVisitScope must belong to the visit and scope order');
END;

CREATE TRIGGER "InstallationVisitScope_order_update_guard"
BEFORE UPDATE ON "InstallationVisitScope"
FOR EACH ROW WHEN (
  NOT EXISTS (
    SELECT 1
    FROM "InstallationScope" scope
    JOIN "InstallationRoom" room ON room."id" = scope."roomId"
    WHERE scope."id" = NEW."scopeId" AND room."orderId" = NEW."orderId"
  )
  OR NOT EXISTS (
    SELECT 1
    FROM "InstallationVisit" visit
    WHERE visit."id" = NEW."visitId" AND visit."orderId" = NEW."orderId"
  )
)
BEGIN
  SELECT RAISE(ABORT, 'InstallationVisitScope must belong to the visit and scope order');
END;

CREATE TRIGGER "InstallationScopeAssignment_order_insert_guard"
BEFORE INSERT ON "InstallationScopeAssignment"
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM "InstallationScope" scope
  JOIN "InstallationRoom" room ON room."id" = scope."roomId"
  WHERE scope."id" = NEW."scopeId" AND room."orderId" = NEW."orderId"
)
BEGIN
  SELECT RAISE(ABORT, 'InstallationScopeAssignment must belong to the scope order');
END;

CREATE TRIGGER "InstallationScopeAssignment_order_update_guard"
BEFORE UPDATE ON "InstallationScopeAssignment"
FOR EACH ROW WHEN NOT EXISTS (
  SELECT 1
  FROM "InstallationScope" scope
  JOIN "InstallationRoom" room ON room."id" = scope."roomId"
  WHERE scope."id" = NEW."scopeId" AND room."orderId" = NEW."orderId"
)
BEGIN
  SELECT RAISE(ABORT, 'InstallationScopeAssignment must belong to the scope order');
END;
