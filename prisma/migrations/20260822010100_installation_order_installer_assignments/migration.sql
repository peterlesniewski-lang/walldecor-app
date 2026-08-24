PRAGMA foreign_keys=OFF;

CREATE TABLE "new_InstallationOrder" (
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
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "InstallationClient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationOrder_primaryEmployeeId_fkey" FOREIGN KEY ("primaryEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationOrder_backupEmployeeId_fkey" FOREIGN KEY ("backupEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_InstallationOrder" ("id", "number", "status", "clientId", "addressStreet", "addressBuildingNumber", "addressApartmentNumber", "addressPostalCode", "addressCity", "primaryEmployeeId", "backupEmployeeId", "scheduledAt", "externalSystem", "externalId", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "number", "status", "clientId", "addressStreet", "addressBuildingNumber", "addressApartmentNumber", "addressPostalCode", "addressCity", "primaryEmployeeId", "backupEmployeeId", "scheduledAt", "externalSystem", "externalId", "archivedAt", "createdAt", "updatedAt"
FROM "InstallationOrder";

DROP TABLE "InstallationOrder";
ALTER TABLE "new_InstallationOrder" RENAME TO "InstallationOrder";

CREATE UNIQUE INDEX "InstallationOrder_number_key" ON "InstallationOrder"("number");
CREATE INDEX "InstallationOrder_status_archivedAt_idx" ON "InstallationOrder"("status", "archivedAt");
CREATE INDEX "InstallationOrder_primaryEmployeeId_idx" ON "InstallationOrder"("primaryEmployeeId");
CREATE INDEX "InstallationOrder_backupEmployeeId_idx" ON "InstallationOrder"("backupEmployeeId");
CREATE INDEX "InstallationOrder_clientId_idx" ON "InstallationOrder"("clientId");

CREATE TABLE "InstallationOrderInstaller" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstallationOrderInstaller_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "InstallationOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationOrderInstaller_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InstallationOrderInstaller_orderId_employeeId_key" ON "InstallationOrderInstaller"("orderId", "employeeId");
CREATE INDEX "InstallationOrderInstaller_employeeId_idx" ON "InstallationOrderInstaller"("employeeId");

PRAGMA foreign_keys=ON;
