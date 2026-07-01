-- User account mechanics
ALTER TABLE "User" ADD COLUMN "username" TEXT;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" DATETIME;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- KSeF inbox
CREATE TABLE "KsefSupplierRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierNamePattern" TEXT,
    "supplierNip" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "subCategoryId" TEXT NOT NULL,
    CONSTRAINT "KsefSupplierRule_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KsefSupplierRule_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "KsefInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierNip" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "issueDate" DATETIME NOT NULL,
    "grossAmount" REAL NOT NULL,
    "netAmount" REAL,
    "vatAmount" REAL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "actualEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "costCenterId" TEXT,
    "subCategoryId" TEXT,
    "supplierRuleId" TEXT,
    CONSTRAINT "KsefInvoice_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KsefInvoice_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KsefInvoice_supplierRuleId_fkey" FOREIGN KEY ("supplierRuleId") REFERENCES "KsefSupplierRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KsefInvoice_externalId_key" ON "KsefInvoice"("externalId");
CREATE UNIQUE INDEX "KsefInvoice_supplierNip_invoiceNumber_issueDate_key" ON "KsefInvoice"("supplierNip", "invoiceNumber", "issueDate");
CREATE INDEX "KsefInvoice_status_idx" ON "KsefInvoice"("status");
CREATE INDEX "KsefInvoice_issueDate_idx" ON "KsefInvoice"("issueDate");
CREATE INDEX "KsefInvoice_supplierNip_idx" ON "KsefInvoice"("supplierNip");
CREATE INDEX "KsefSupplierRule_active_idx" ON "KsefSupplierRule"("active");
CREATE INDEX "KsefSupplierRule_supplierNip_idx" ON "KsefSupplierRule"("supplierNip");
