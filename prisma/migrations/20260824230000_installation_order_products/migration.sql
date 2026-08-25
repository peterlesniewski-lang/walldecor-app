-- Order scopes can use an optional category, and products may be order-owned
-- rather than copied from the global catalogue. Existing catalogue snapshots
-- remain intact for historical orders.
ALTER TABLE "InstallationScope" ADD COLUMN "catalogCategoryId" TEXT
  REFERENCES "InstallationCatalogCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "InstallationScope_catalogCategoryId_idx"
ON "InstallationScope"("catalogCategoryId");

CREATE TABLE "new_InstallationScopeProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeId" TEXT NOT NULL,
    "catalogProductId" TEXT,
    "productNameSnapshot" TEXT,
    "productCodeSnapshot" TEXT,
    "manufacturerSnapshot" TEXT,
    "collectionSnapshot" TEXT,
    "batchSnapshot" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationScopeProduct_scopeId_fkey"
      FOREIGN KEY ("scopeId") REFERENCES "InstallationScope" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstallationScopeProduct_catalogProductId_fkey"
      FOREIGN KEY ("catalogProductId") REFERENCES "InstallationCatalogProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InstallationScopeProduct_catalogProduct_snapshot_check"
      CHECK (
        "catalogProductId" IS NULL
        OR (
          "productNameSnapshot" IS NOT NULL
          AND length(trim("productNameSnapshot")) > 0
        )
      )
);

INSERT INTO "new_InstallationScopeProduct" (
  "id", "scopeId", "catalogProductId", "productNameSnapshot",
  "productCodeSnapshot", "manufacturerSnapshot", "collectionSnapshot",
  "sortOrder", "createdAt", "updatedAt"
)
SELECT
  "id", "scopeId", "catalogProductId", "productNameSnapshot",
  "productCodeSnapshot", "manufacturerSnapshot", "collectionSnapshot",
  "sortOrder", "createdAt", "updatedAt"
FROM "InstallationScopeProduct";

DROP TABLE "InstallationScopeProduct";
ALTER TABLE "new_InstallationScopeProduct" RENAME TO "InstallationScopeProduct";

CREATE INDEX "InstallationScopeProduct_scopeId_sortOrder_idx"
ON "InstallationScopeProduct"("scopeId", "sortOrder");

CREATE INDEX "InstallationScopeProduct_catalogProductId_idx"
ON "InstallationScopeProduct"("catalogProductId");

-- SQLite cannot alter an existing CHECK constraint. Rebuild the table so the
-- new units are accepted without losing historical measurements or their
-- provenance. Zero remains valid for historical imports; new-value positivity
-- is enforced by the application service.
CREATE TABLE "new_InstallationMeasurement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "scopeId" TEXT,
    "elementName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SINGLE',
    "value" DECIMAL NOT NULL,
    "secondaryValue" DECIMAL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "authorId" TEXT,
    "authorContext" TEXT,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstallationMeasurement_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "InstallationRoom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstallationMeasurement_scopeId_fkey"
      FOREIGN KEY ("scopeId") REFERENCES "InstallationScope" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstallationMeasurement_value_check"
      CHECK (CAST("value" AS REAL) >= 0),
    CONSTRAINT "InstallationMeasurement_unit_check"
      CHECK ("unit" IN ('MM', 'CM', 'M', 'M2', 'MB', 'SZT')),
    CONSTRAINT "InstallationMeasurement_source_check"
      CHECK ("source" IN ('CLIENT', 'EMPLOYEE', 'INSTALLER')),
    CONSTRAINT "InstallationMeasurement_element_check"
      CHECK (length(trim("elementName")) > 0)
);

INSERT INTO "new_InstallationMeasurement" (
  "id", "roomId", "scopeId", "elementName", "kind", "value",
  "secondaryValue", "unit", "source", "authorId", "authorContext",
  "actorUserId", "actorRole", "createdAt", "updatedAt"
)
SELECT
  "id", "roomId", "scopeId", "elementName", 'SINGLE', "value",
  NULL, "unit", "source", "authorId", "authorContext", "actorUserId",
  "actorRole", "createdAt", "updatedAt"
FROM "InstallationMeasurement";

DROP TABLE "InstallationMeasurement";
ALTER TABLE "new_InstallationMeasurement" RENAME TO "InstallationMeasurement";

CREATE INDEX "InstallationMeasurement_roomId_createdAt_idx"
ON "InstallationMeasurement"("roomId", "createdAt");

CREATE INDEX "InstallationMeasurement_scopeId_createdAt_idx"
ON "InstallationMeasurement"("scopeId", "createdAt");

CREATE INDEX "InstallationMeasurement_actorUserId_createdAt_idx"
ON "InstallationMeasurement"("actorUserId", "createdAt");
