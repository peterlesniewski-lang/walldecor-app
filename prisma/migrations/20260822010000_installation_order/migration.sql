CREATE TABLE "InstallationClient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "InstallationOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "clientId" TEXT NOT NULL,
    "addressStreet" TEXT NOT NULL,
    "addressBuildingNumber" TEXT,
    "addressApartmentNumber" TEXT,
    "addressPostalCode" TEXT NOT NULL,
    "addressCity" TEXT NOT NULL,
    "primaryEmployeeId" TEXT NOT NULL,
    "backupEmployeeId" TEXT NOT NULL,
    "scheduledAt" DATETIME,
    "externalSystem" TEXT,
    "externalId" TEXT,
    "isAssignedInstaller" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "InstallationClient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationOrder_primaryEmployeeId_fkey" FOREIGN KEY ("primaryEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationOrder_backupEmployeeId_fkey" FOREIGN KEY ("backupEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InstallationDelegation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "delegateEmployeeId" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "endedAt" DATETIME,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationDelegation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationDelegation_delegateEmployeeId_fkey" FOREIGN KEY ("delegateEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "InstallationAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstallationAuditEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InstallationClient_email_key" ON "InstallationClient"("email");
CREATE UNIQUE INDEX "InstallationOrder_number_key" ON "InstallationOrder"("number");
CREATE INDEX "InstallationOrder_status_archivedAt_idx" ON "InstallationOrder"("status", "archivedAt");
CREATE INDEX "InstallationOrder_primaryEmployeeId_idx" ON "InstallationOrder"("primaryEmployeeId");
CREATE INDEX "InstallationOrder_backupEmployeeId_idx" ON "InstallationOrder"("backupEmployeeId");
CREATE INDEX "InstallationOrder_clientId_idx" ON "InstallationOrder"("clientId");
CREATE INDEX "InstallationDelegation_orderId_startsAt_idx" ON "InstallationDelegation"("orderId", "startsAt");
CREATE INDEX "InstallationDelegation_delegateEmployeeId_idx" ON "InstallationDelegation"("delegateEmployeeId");
CREATE INDEX "InstallationAuditEvent_orderId_createdAt_idx" ON "InstallationAuditEvent"("orderId", "createdAt");
CREATE INDEX "InstallationAuditEvent_actorId_idx" ON "InstallationAuditEvent"("actorId");
