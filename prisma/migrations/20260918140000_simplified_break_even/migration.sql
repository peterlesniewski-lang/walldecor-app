-- Additive configuration only. Existing revenue, invoice and HR records are unchanged.
CREATE TABLE "BreakEvenMarginSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "margin" REAL NOT NULL CHECK ("margin" > 0 AND "margin" <= 1),
  "effectiveFrom" DATETIME NOT NULL,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BreakEvenMarginSetting_effectiveFrom_key" ON "BreakEvenMarginSetting"("effectiveFrom");

CREATE TABLE "BreakEvenFixedCost" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "costCenterId" TEXT NOT NULL CHECK ("costCenterId" IN ('JAG', 'PUL')),
  "supplierNip" TEXT,
  "supplierName" TEXT,
  "expectedNetAmount" REAL NOT NULL CHECK ("expectedNetAmount" >= 0),
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BreakEvenFixedCost_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);
CREATE INDEX "BreakEvenFixedCost_costCenterId_active_idx" ON "BreakEvenFixedCost"("costCenterId", "active");

CREATE TABLE "BreakEvenFixedCostMatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fixedCostId" TEXT NOT NULL,
  "year" INTEGER NOT NULL CHECK ("year" BETWEEN 2020 AND 2100),
  "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
  "costEventPartId" TEXT NOT NULL,
  "costCenterId" TEXT NOT NULL CHECK ("costCenterId" IN ('JAG', 'PUL')),
  "actualNetAmount" REAL,
  "createdById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BreakEvenFixedCostMatch_fixedCostId_fkey" FOREIGN KEY ("fixedCostId") REFERENCES "BreakEvenFixedCost" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BreakEvenFixedCostMatch_costEventPartId_fkey" FOREIGN KEY ("costEventPartId") REFERENCES "CostEventPart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BreakEvenFixedCostMatch_costEventPartId_costCenterId_key" ON "BreakEvenFixedCostMatch"("costEventPartId", "costCenterId");
CREATE INDEX "BreakEvenFixedCostMatch_year_month_idx" ON "BreakEvenFixedCostMatch"("year", "month");
CREATE INDEX "BreakEvenFixedCostMatch_fixedCostId_year_month_idx" ON "BreakEvenFixedCostMatch"("fixedCostId", "year", "month");

CREATE TABLE "BreakEvenRevenueBasis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "year" INTEGER NOT NULL CHECK ("year" BETWEEN 2020 AND 2100),
  "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
  "costCenterId" TEXT NOT NULL CHECK ("costCenterId" IN ('JAG', 'PUL')),
  "netAmount" REAL NOT NULL CHECK ("netAmount" >= 0),
  "grossAmountSnapshot" REAL NOT NULL,
  "createdById" TEXT,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "BreakEvenRevenueBasis_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BreakEvenRevenueBasis_year_month_costCenterId_key" ON "BreakEvenRevenueBasis"("year", "month", "costCenterId");
