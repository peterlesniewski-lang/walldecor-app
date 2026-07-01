-- CreateTable
CREATE TABLE "CostTagGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CostTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CostTag_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CostTagGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KsefSupplierRuleTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "KsefSupplierRuleTag_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "KsefSupplierRule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KsefSupplierRuleTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CostTag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KsefInvoicePart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "grossAmount" REAL NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KsefInvoicePart_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "KsefInvoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KsefInvoicePartTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "KsefInvoicePartTag_partId_fkey" FOREIGN KEY ("partId") REFERENCES "KsefInvoicePart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KsefInvoicePartTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CostTag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KsefInvoicePartAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "percent" REAL NOT NULL,
    CONSTRAINT "KsefInvoicePartAllocation_partId_fkey" FOREIGN KEY ("partId") REFERENCES "KsefInvoicePart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KsefInvoicePartAllocation_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceInvoiceId" TEXT,
    "eventDate" DATETIME NOT NULL,
    "supplierName" TEXT,
    "supplierNip" TEXT,
    "reference" TEXT,
    "grossAmount" REAL NOT NULL,
    "netAmount" REAL,
    "vatAmount" REAL,
    "currency" TEXT NOT NULL DEFAULT 'PLN',
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "documentStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isConfidential" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CostEvent_sourceInvoiceId_fkey" FOREIGN KEY ("sourceInvoiceId") REFERENCES "KsefInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostEventPart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "grossAmount" REAL NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CostEventPart_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CostEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostEventPartTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "CostEventPartTag_partId_fkey" FOREIGN KEY ("partId") REFERENCES "CostEventPart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CostEventPartTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "CostTag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostEventPartAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "percent" REAL NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CostEventPartAllocation_partId_fkey" FOREIGN KEY ("partId") REFERENCES "CostEventPart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CostEventPartAllocation_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT,
    "costEventId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostAuditLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "KsefInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CostAuditLog_costEventId_fkey" FOREIGN KEY ("costEventId") REFERENCES "CostEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancePeriodClose" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "closedById" TEXT,
    "closedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT
);

-- CreateTable
CREATE TABLE "ContributionMarginSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "costCenterId" TEXT NOT NULL,
    "margin" REAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContributionMarginSetting_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KsefInvoice" (
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
    "reportingGrossAmount" REAL,
    "reportingNetAmount" REAL,
    "reportingVatAmount" REAL,
    "originalCurrency" TEXT,
    "originalGrossAmount" REAL,
    "originalNetAmount" REAL,
    "originalVatAmount" REAL,
    "currencyConversionNote" TEXT,
    "convertedById" TEXT,
    "convertedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "paidAt" DATETIME,
    "dueDate" DATETIME,
    "documentStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ruleMatchStatus" TEXT NOT NULL DEFAULT 'NO_RULE',
    "correctsInvoiceId" TEXT,
    "notes" TEXT,
    "actualEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "costCenterId" TEXT,
    "subCategoryId" TEXT,
    "supplierRuleId" TEXT,
    CONSTRAINT "KsefInvoice_correctsInvoiceId_fkey" FOREIGN KEY ("correctsInvoiceId") REFERENCES "KsefInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KsefInvoice_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KsefInvoice_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KsefInvoice_supplierRuleId_fkey" FOREIGN KEY ("supplierRuleId") REFERENCES "KsefSupplierRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_KsefInvoice" ("actualEntryId", "costCenterId", "createdAt", "currency", "externalId", "grossAmount", "id", "invoiceNumber", "issueDate", "netAmount", "notes", "source", "status", "subCategoryId", "supplierName", "supplierNip", "supplierRuleId", "updatedAt", "vatAmount") SELECT "actualEntryId", "costCenterId", "createdAt", "currency", "externalId", "grossAmount", "id", "invoiceNumber", "issueDate", "netAmount", "notes", "source", "status", "subCategoryId", "supplierName", "supplierNip", "supplierRuleId", "updatedAt", "vatAmount" FROM "KsefInvoice";
DROP TABLE "KsefInvoice";
ALTER TABLE "new_KsefInvoice" RENAME TO "KsefInvoice";
CREATE UNIQUE INDEX "KsefInvoice_externalId_key" ON "KsefInvoice"("externalId");
CREATE INDEX "KsefInvoice_status_idx" ON "KsefInvoice"("status");
CREATE INDEX "KsefInvoice_paymentStatus_idx" ON "KsefInvoice"("paymentStatus");
CREATE INDEX "KsefInvoice_documentStatus_idx" ON "KsefInvoice"("documentStatus");
CREATE INDEX "KsefInvoice_ruleMatchStatus_idx" ON "KsefInvoice"("ruleMatchStatus");
CREATE INDEX "KsefInvoice_correctsInvoiceId_idx" ON "KsefInvoice"("correctsInvoiceId");
CREATE INDEX "KsefInvoice_dueDate_idx" ON "KsefInvoice"("dueDate");
CREATE INDEX "KsefInvoice_issueDate_idx" ON "KsefInvoice"("issueDate");
CREATE INDEX "KsefInvoice_supplierNip_idx" ON "KsefInvoice"("supplierNip");
CREATE UNIQUE INDEX "KsefInvoice_supplierNip_invoiceNumber_issueDate_key" ON "KsefInvoice"("supplierNip", "invoiceNumber", "issueDate");
CREATE TABLE "new_KsefSupplierRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierNamePattern" TEXT,
    "supplierNip" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "subCategoryId" TEXT NOT NULL,
    CONSTRAINT "KsefSupplierRule_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KsefSupplierRule_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_KsefSupplierRule" ("active", "costCenterId", "createdAt", "id", "subCategoryId", "supplierNamePattern", "supplierNip", "updatedAt") SELECT "active", "costCenterId", "createdAt", "id", "subCategoryId", "supplierNamePattern", "supplierNip", "updatedAt" FROM "KsefSupplierRule";
DROP TABLE "KsefSupplierRule";
ALTER TABLE "new_KsefSupplierRule" RENAME TO "KsefSupplierRule";
CREATE INDEX "KsefSupplierRule_active_idx" ON "KsefSupplierRule"("active");
CREATE INDEX "KsefSupplierRule_supplierNip_idx" ON "KsefSupplierRule"("supplierNip");
CREATE INDEX "KsefSupplierRule_priority_idx" ON "KsefSupplierRule"("priority");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CostTagGroup_slug_key" ON "CostTagGroup"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CostTag_slug_key" ON "CostTag"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "KsefSupplierRuleTag_ruleId_tagId_key" ON "KsefSupplierRuleTag"("ruleId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "KsefInvoicePartTag_partId_tagId_key" ON "KsefInvoicePartTag"("partId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "KsefInvoicePartAllocation_partId_costCenterId_key" ON "KsefInvoicePartAllocation"("partId", "costCenterId");

-- CreateIndex
CREATE UNIQUE INDEX "CostEvent_sourceInvoiceId_key" ON "CostEvent"("sourceInvoiceId");

-- CreateIndex
CREATE INDEX "CostEvent_eventDate_idx" ON "CostEvent"("eventDate");

-- CreateIndex
CREATE INDEX "CostEvent_status_idx" ON "CostEvent"("status");

-- CreateIndex
CREATE INDEX "CostEvent_supplierNip_idx" ON "CostEvent"("supplierNip");

-- CreateIndex
CREATE INDEX "CostEvent_isConfidential_idx" ON "CostEvent"("isConfidential");

-- CreateIndex
CREATE UNIQUE INDEX "CostEventPartTag_partId_tagId_key" ON "CostEventPartTag"("partId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "CostEventPartAllocation_partId_costCenterId_key" ON "CostEventPartAllocation"("partId", "costCenterId");

-- CreateIndex
CREATE INDEX "CostAuditLog_invoiceId_idx" ON "CostAuditLog"("invoiceId");

-- CreateIndex
CREATE INDEX "CostAuditLog_costEventId_idx" ON "CostAuditLog"("costEventId");

-- CreateIndex
CREATE INDEX "CostAuditLog_createdAt_idx" ON "CostAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePeriodClose_year_month_key" ON "FinancePeriodClose"("year", "month");

-- CreateIndex
CREATE INDEX "ContributionMarginSetting_costCenterId_effectiveFrom_idx" ON "ContributionMarginSetting"("costCenterId", "effectiveFrom");
