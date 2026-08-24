-- Each order owns a private client snapshot. Existing shared clients are copied
-- for every order after the first one before the one-to-one constraint is added.
PRAGMA foreign_keys=OFF;
BEGIN;

DROP INDEX "InstallationClient_email_key";

INSERT INTO "InstallationClient" ("id", "name", "email", "phone", "createdAt", "updatedAt")
SELECT
  'installation-client-snapshot-' || "InstallationOrder"."id",
  "InstallationClient"."name",
  "InstallationClient"."email",
  "InstallationClient"."phone",
  "InstallationClient"."createdAt",
  "InstallationClient"."updatedAt"
FROM "InstallationOrder"
INNER JOIN "InstallationClient" ON "InstallationClient"."id" = "InstallationOrder"."clientId"
WHERE EXISTS (
  SELECT 1
  FROM "InstallationOrder" AS "EarlierInstallationOrder"
  WHERE "EarlierInstallationOrder"."clientId" = "InstallationOrder"."clientId"
    AND "EarlierInstallationOrder"."id" < "InstallationOrder"."id"
);

UPDATE "InstallationOrder"
SET "clientId" = 'installation-client-snapshot-' || "id"
WHERE EXISTS (
  SELECT 1
  FROM "InstallationOrder" AS "EarlierInstallationOrder"
  WHERE "EarlierInstallationOrder"."clientId" = "InstallationOrder"."clientId"
    AND "EarlierInstallationOrder"."id" < "InstallationOrder"."id"
);

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
    CONSTRAINT "InstallationOrder_backupEmployeeId_fkey" FOREIGN KEY ("backupEmployeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationOrder_distinct_owners_check" CHECK ("primaryEmployeeId" <> "backupEmployeeId")
);

INSERT INTO "new_InstallationOrder" ("id", "number", "status", "clientId", "addressStreet", "addressBuildingNumber", "addressApartmentNumber", "addressPostalCode", "addressCity", "primaryEmployeeId", "backupEmployeeId", "scheduledAt", "externalSystem", "externalId", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "number", "status", "clientId", "addressStreet", "addressBuildingNumber", "addressApartmentNumber", "addressPostalCode", "addressCity", "primaryEmployeeId", "backupEmployeeId", "scheduledAt", "externalSystem", "externalId", "archivedAt", "createdAt", "updatedAt"
FROM "InstallationOrder";

DROP TABLE "InstallationOrder";
ALTER TABLE "new_InstallationOrder" RENAME TO "InstallationOrder";

CREATE UNIQUE INDEX "InstallationOrder_number_key" ON "InstallationOrder"("number");
CREATE UNIQUE INDEX "InstallationOrder_clientId_key" ON "InstallationOrder"("clientId");
CREATE INDEX "InstallationOrder_status_archivedAt_idx" ON "InstallationOrder"("status", "archivedAt");
CREATE INDEX "InstallationOrder_primaryEmployeeId_idx" ON "InstallationOrder"("primaryEmployeeId");
CREATE INDEX "InstallationOrder_backupEmployeeId_idx" ON "InstallationOrder"("backupEmployeeId");

COMMIT;
PRAGMA foreign_keys=ON;
