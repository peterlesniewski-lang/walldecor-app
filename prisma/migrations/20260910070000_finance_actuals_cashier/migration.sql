-- Additive only: historical plans, existing ledger and application-specific FTS
-- tables / CHECK constraints are deliberately preserved.
ALTER TABLE "Revenue" ADD COLUMN "asOfDate" TEXT;

CREATE TABLE "SalonCashSettings" (
    "costCenterId" TEXT NOT NULL PRIMARY KEY,
    "cashAccountId" TEXT NOT NULL,
    "targetFloatCents" INTEGER NOT NULL,
    "initialCashCents" INTEGER NOT NULL,
    "startDate" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalonCashSettings_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalonCashSettings_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalonCashSettings_salon_check" CHECK ("costCenterId" IN ('PUL', 'JAG')),
    CONSTRAINT "SalonCashSettings_money_check" CHECK ("targetFloatCents" >= 0 AND "initialCashCents" >= 0)
);

CREATE TABLE "CashDailyReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "costCenterId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "openingCents" INTEGER NOT NULL,
    "targetFloatCents" INTEGER NOT NULL,
    "cashReceiptsCents" INTEGER,
    "cardReceiptsCents" INTEGER,
    "countedCents" INTEGER,
    "expectedCents" INTEGER,
    "differenceCents" INTEGER,
    "retainedCents" INTEGER,
    "depositCents" INTEGER,
    "shortfallCents" INTEGER,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "closedById" TEXT,
    "closedAt" DATETIME,
    "closeRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashDailyReport_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashDailyReport_status_check" CHECK ("status" IN ('DRAFT', 'CLOSED')),
    CONSTRAINT "CashDailyReport_money_check" CHECK ("openingCents" >= 0 AND "targetFloatCents" >= 0 AND ("cashReceiptsCents" IS NULL OR "cashReceiptsCents" >= 0) AND ("cardReceiptsCents" IS NULL OR "cardReceiptsCents" >= 0) AND ("countedCents" IS NULL OR "countedCents" >= 0))
);

CREATE TABLE "CashDailyOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashDailyOperation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CashDailyReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashDailyOperation_kind_check" CHECK ("kind" IN ('SALES_REFUND', 'DEPOSIT_IN', 'DEPOSIT_REFUND')),
    CONSTRAINT "CashDailyOperation_method_check" CHECK ("method" IN ('CASH', 'CARD')),
    CONSTRAINT "CashDailyOperation_amount_check" CHECK ("amountCents" > 0)
);

CREATE TABLE "CashDeposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "declaredCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "destinationAccountId" TEXT,
    "receivedById" TEXT,
    "receivedAt" DATETIME,
    "actualCents" INTEGER,
    "verifiedById" TEXT,
    "verifiedAt" DATETIME,
    "verificationNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CashDeposit_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CashDailyReport" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashDeposit_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "CashAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CashDeposit_status_check" CHECK ("status" IN ('WAITING', 'RECEIVED', 'VERIFIED', 'DISCREPANCY', 'VOID')),
    CONSTRAINT "CashDeposit_amount_check" CHECK ("declaredCents" >= 0 AND ("actualCents" IS NULL OR "actualCents" >= 0))
);

CREATE TABLE "CashierAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "costCenterId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SalonCashSettings_cashAccountId_key" ON "SalonCashSettings"("cashAccountId");
CREATE UNIQUE INDEX "CashDailyReport_closeRequestId_key" ON "CashDailyReport"("closeRequestId");
CREATE INDEX "CashDailyReport_costCenterId_status_businessDate_idx" ON "CashDailyReport"("costCenterId", "status", "businessDate");
CREATE UNIQUE INDEX "CashDailyReport_costCenterId_businessDate_key" ON "CashDailyReport"("costCenterId", "businessDate");
-- Prisma cannot express a partial unique index; keep this safety guard in SQL.
CREATE UNIQUE INDEX "CashDailyReport_one_draft_per_salon" ON "CashDailyReport"("costCenterId") WHERE "status" = 'DRAFT';
CREATE INDEX "CashDailyOperation_reportId_createdAt_idx" ON "CashDailyOperation"("reportId", "createdAt");
CREATE UNIQUE INDEX "CashDeposit_reportId_key" ON "CashDeposit"("reportId");
CREATE INDEX "CashDeposit_status_createdAt_idx" ON "CashDeposit"("status", "createdAt");
CREATE INDEX "CashierAuditLog_costCenterId_createdAt_idx" ON "CashierAuditLog"("costCenterId", "createdAt");
CREATE INDEX "CashierAuditLog_entityType_entityId_createdAt_idx" ON "CashierAuditLog"("entityType", "entityId", "createdAt");
