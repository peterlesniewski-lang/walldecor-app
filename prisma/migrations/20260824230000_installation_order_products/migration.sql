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
      FOREIGN KEY ("catalogProductId") REFERENCES "InstallationCatalogProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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

ALTER TABLE "InstallationMeasurement" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SINGLE';
ALTER TABLE "InstallationMeasurement" ADD COLUMN "secondaryValue" DECIMAL;
