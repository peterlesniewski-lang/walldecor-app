-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_KsefSupplierRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierNamePattern" TEXT,
    "supplierNip" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "subCategoryId" TEXT,
    CONSTRAINT "KsefSupplierRule_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KsefSupplierRule_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_KsefSupplierRule" (
    "active",
    "costCenterId",
    "createdAt",
    "id",
    "priority",
    "subCategoryId",
    "supplierNamePattern",
    "supplierNip",
    "updatedAt"
)
SELECT
    "active",
    "costCenterId",
    "createdAt",
    "id",
    "priority",
    "subCategoryId",
    "supplierNamePattern",
    "supplierNip",
    "updatedAt"
FROM "KsefSupplierRule";

DROP TABLE "KsefSupplierRule";
ALTER TABLE "new_KsefSupplierRule" RENAME TO "KsefSupplierRule";

CREATE INDEX "KsefSupplierRule_active_idx" ON "KsefSupplierRule"("active");
CREATE INDEX "KsefSupplierRule_supplierNip_idx" ON "KsefSupplierRule"("supplierNip");
CREATE INDEX "KsefSupplierRule_priority_idx" ON "KsefSupplierRule"("priority");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
