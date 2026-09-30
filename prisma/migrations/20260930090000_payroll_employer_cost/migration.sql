-- Employer cost is derived from gross and employer rates; salons share an employee's cost by a fixed split.
-- Money stays in integer grosze, rates in basis points (1 bp = 0.01%).

-- ── Settlement and version columns ──────────────────────────────────────────

ALTER TABLE "PayrollSettlement" ADD COLUMN "employerCostSource" TEXT
  CHECK ("employerCostSource" IS NULL OR "employerCostSource" IN ('CALCULATED', 'OVERRIDDEN'));

ALTER TABLE "PayrollSettlementVersion" ADD COLUMN "employerCostSource" TEXT NOT NULL DEFAULT 'ENTERED'
  CHECK ("employerCostSource" IN ('ENTERED', 'CALCULATED', 'OVERRIDDEN'));
ALTER TABLE "PayrollSettlementVersion" ADD COLUMN "employerRatesJson" TEXT;
ALTER TABLE "PayrollSettlementVersion" ADD COLUMN "costAllocationJson" TEXT NOT NULL DEFAULT '[]';

-- ── Employer rates (append-only, revoke instead of edit) ────────────────────

CREATE TABLE "PayrollEmployerRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementType" TEXT NOT NULL CHECK ("settlementType" IN ('UOP', 'UZ', 'ZARZAD')),
    "effectiveFrom" TEXT NOT NULL CHECK ("effectiveFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    "pensionBp" INTEGER NOT NULL CHECK ("pensionBp" BETWEEN 0 AND 5000),
    "disabilityBp" INTEGER NOT NULL CHECK ("disabilityBp" BETWEEN 0 AND 5000),
    "accidentBp" INTEGER NOT NULL CHECK ("accidentBp" BETWEEN 0 AND 5000),
    "labourFundBp" INTEGER NOT NULL CHECK ("labourFundBp" BETWEEN 0 AND 5000),
    "guaranteeFundBp" INTEGER NOT NULL CHECK ("guaranteeFundBp" BETWEEN 0 AND 5000),
    "ppkBp" INTEGER NOT NULL CHECK ("ppkBp" BETWEEN 0 AND 5000),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    CHECK (("revokedAt" IS NULL AND "revokedById" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL))
);
CREATE INDEX "PayrollEmployerRate_settlementType_effectiveFrom_idx" ON "PayrollEmployerRate"("settlementType", "effectiveFrom");
CREATE UNIQUE INDEX "PayrollEmployerRate_active_type_month_key" ON "PayrollEmployerRate"("settlementType", "effectiveFrom") WHERE "revokedAt" IS NULL;

CREATE TRIGGER "PayrollEmployerRate_no_delete" BEFORE DELETE ON "PayrollEmployerRate"
BEGIN SELECT RAISE(ABORT, 'payroll employer rates are append-only; revoke instead'); END;

CREATE TRIGGER "PayrollEmployerRate_immutable" BEFORE UPDATE ON "PayrollEmployerRate"
WHEN OLD."revokedAt" IS NOT NULL
  OR NEW."revokedAt" IS NULL
  OR NEW."id" IS NOT OLD."id"
  OR NEW."settlementType" IS NOT OLD."settlementType"
  OR NEW."effectiveFrom" IS NOT OLD."effectiveFrom"
  OR NEW."pensionBp" IS NOT OLD."pensionBp"
  OR NEW."disabilityBp" IS NOT OLD."disabilityBp"
  OR NEW."accidentBp" IS NOT OLD."accidentBp"
  OR NEW."labourFundBp" IS NOT OLD."labourFundBp"
  OR NEW."guaranteeFundBp" IS NOT OLD."guaranteeFundBp"
  OR NEW."ppkBp" IS NOT OLD."ppkBp"
  OR NEW."note" IS NOT OLD."note"
  OR NEW."createdById" IS NOT OLD."createdById"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'payroll employer rates are append-only; revoke instead'); END;

-- ── Per-employee exemptions ─────────────────────────────────────────────────

CREATE TABLE "PayrollCostProfile" (
    "employeeId" TEXT NOT NULL PRIMARY KEY,
    "withoutFunds" BOOLEAN NOT NULL DEFAULT false,
    "withoutContributions" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayrollCostProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ── Salon split (append-only, revoke instead of edit) ───────────────────────

CREATE TABLE "PayrollCostSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL CHECK ("effectiveFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    "jagPercent" INTEGER NOT NULL CHECK ("jagPercent" BETWEEN 0 AND 100),
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    CONSTRAINT "PayrollCostSplit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (("revokedAt" IS NULL AND "revokedById" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL))
);
CREATE INDEX "PayrollCostSplit_employeeId_effectiveFrom_idx" ON "PayrollCostSplit"("employeeId", "effectiveFrom");
CREATE UNIQUE INDEX "PayrollCostSplit_active_employee_month_key" ON "PayrollCostSplit"("employeeId", "effectiveFrom") WHERE "revokedAt" IS NULL;

CREATE TRIGGER "PayrollCostSplit_no_delete" BEFORE DELETE ON "PayrollCostSplit"
BEGIN SELECT RAISE(ABORT, 'payroll cost splits are append-only; revoke instead'); END;

CREATE TRIGGER "PayrollCostSplit_immutable" BEFORE UPDATE ON "PayrollCostSplit"
WHEN OLD."revokedAt" IS NOT NULL
  OR NEW."revokedAt" IS NULL
  OR NEW."id" IS NOT OLD."id"
  OR NEW."employeeId" IS NOT OLD."employeeId"
  OR NEW."effectiveFrom" IS NOT OLD."effectiveFrom"
  OR NEW."jagPercent" IS NOT OLD."jagPercent"
  OR NEW."createdById" IS NOT OLD."createdById"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'payroll cost splits are append-only; revoke instead'); END;

-- ── Versions stay immutable, including the new columns ──────────────────────

DROP TRIGGER "PayrollSettlementVersion_immutable";
CREATE TRIGGER "PayrollSettlementVersion_immutable" BEFORE UPDATE ON "PayrollSettlementVersion"
WHEN OLD."supersededAt" IS NOT NULL
  OR NEW."supersededAt" IS NULL
  OR NEW."id" IS NOT OLD."id"
  OR NEW."settlementId" IS NOT OLD."settlementId"
  OR NEW."employeeId" IS NOT OLD."employeeId"
  OR NEW."year" IS NOT OLD."year"
  OR NEW."month" IS NOT OLD."month"
  OR NEW."versionNumber" IS NOT OLD."versionNumber"
  OR NEW."costCenterId" IS NOT OLD."costCenterId"
  OR NEW."employmentType" IS NOT OLD."employmentType"
  OR NEW."baseSalaryGrosze" IS NOT OLD."baseSalaryGrosze"
  OR NEW."baseBasis" IS NOT OLD."baseBasis"
  OR NEW."bonusesGrosze" IS NOT OLD."bonusesGrosze"
  OR NEW."correctionsGrosze" IS NOT OLD."correctionsGrosze"
  OR NEW."payoutOvertimeMinutes" IS NOT OLD."payoutOvertimeMinutes"
  OR NEW."timeOffOvertimeMinutes" IS NOT OLD."timeOffOvertimeMinutes"
  OR NEW."approvedWorkedMinutes" IS NOT OLD."approvedWorkedMinutes"
  OR NEW."finalGrossGrosze" IS NOT OLD."finalGrossGrosze"
  OR NEW."finalNetGrosze" IS NOT OLD."finalNetGrosze"
  OR NEW."employerCostGrosze" IS NOT OLD."employerCostGrosze"
  OR NEW."payrollOfficeReference" IS NOT OLD."payrollOfficeReference"
  OR NEW."payrollOfficeConfirmedAt" IS NOT OLD."payrollOfficeConfirmedAt"
  OR NEW."snapshotJson" IS NOT OLD."snapshotJson"
  OR NEW."approvalNote" IS NOT OLD."approvalNote"
  OR NEW."approvedById" IS NOT OLD."approvedById"
  OR NEW."approvedAt" IS NOT OLD."approvedAt"
  OR NEW."employerCostSource" IS NOT OLD."employerCostSource"
  OR NEW."employerRatesJson" IS NOT OLD."employerRatesJson"
  OR NEW."costAllocationJson" IS NOT OLD."costAllocationJson"
BEGIN SELECT RAISE(ABORT, 'approved payroll versions are immutable'); END;
