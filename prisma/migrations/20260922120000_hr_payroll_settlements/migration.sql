-- Monthly payroll settlements (ADMIN-only data). Additive: existing HR, time and finance rows are unchanged.
-- Money is stored in integer grosze. Constraints and triggers below are the database-side guard for
-- payroll data: approved versions and the audit trail are immutable, only one approved version per
-- employee-month can be effective (no double cost recognition), and approved settlements are locked.

CREATE TABLE "PayrollBaseSalary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "amountGrosze" INTEGER NOT NULL CHECK ("amountGrosze" > 0 AND "amountGrosze" <= 100000000),
    "basis" TEXT NOT NULL CHECK ("basis" IN ('MONTHLY_GROSS', 'HOURLY_GROSS')),
    "effectiveFrom" TEXT NOT NULL CHECK ("effectiveFrom" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    "revokeReason" TEXT,
    CONSTRAINT "PayrollBaseSalary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (("revokedAt" IS NULL AND "revokedById" IS NULL AND "revokeReason" IS NULL)
        OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND length(trim("revokeReason")) >= 3))
);
CREATE INDEX "PayrollBaseSalary_employeeId_effectiveFrom_idx" ON "PayrollBaseSalary"("employeeId", "effectiveFrom");
CREATE UNIQUE INDEX "PayrollBaseSalary_active_effectiveFrom_key" ON "PayrollBaseSalary"("employeeId", "effectiveFrom") WHERE "revokedAt" IS NULL;

CREATE TABLE "PayrollSettlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL CHECK ("year" BETWEEN 2020 AND 2100),
    "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'APPROVED')),
    "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
    "baseSalaryGrosze" INTEGER CHECK ("baseSalaryGrosze" IS NULL OR "baseSalaryGrosze" > 0),
    "baseBasis" TEXT CHECK ("baseBasis" IS NULL OR "baseBasis" IN ('MONTHLY_GROSS', 'HOURLY_GROSS')),
    "baseSegmentsJson" TEXT NOT NULL DEFAULT '[]',
    "approvedWorkedMinutes" INTEGER NOT NULL DEFAULT 0 CHECK ("approvedWorkedMinutes" >= 0),
    "pendingEntryCount" INTEGER NOT NULL DEFAULT 0 CHECK ("pendingEntryCount" >= 0),
    "calendarFingerprint" TEXT,
    "calendarSyncedAt" DATETIME,
    "finalGrossGrosze" INTEGER CHECK ("finalGrossGrosze" IS NULL OR "finalGrossGrosze" > 0),
    "finalNetGrosze" INTEGER CHECK ("finalNetGrosze" IS NULL OR "finalNetGrosze" >= 0),
    "employerCostGrosze" INTEGER CHECK ("employerCostGrosze" IS NULL OR "employerCostGrosze" > 0),
    "payrollOfficeReference" TEXT,
    "payrollOfficeConfirmedAt" DATETIME,
    "payrollOfficeConfirmedById" TEXT,
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 0 CHECK ("currentVersionNumber" >= 0),
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayrollSettlement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Payroll office figures are recorded together, each explicitly; net can never exceed gross.
    CHECK (("payrollOfficeConfirmedAt" IS NULL AND "payrollOfficeConfirmedById" IS NULL)
        OR ("payrollOfficeConfirmedAt" IS NOT NULL AND "payrollOfficeConfirmedById" IS NOT NULL
            AND "finalGrossGrosze" IS NOT NULL AND "finalNetGrosze" IS NOT NULL AND "employerCostGrosze" IS NOT NULL)),
    CHECK ("finalNetGrosze" IS NULL OR "finalGrossGrosze" IS NULL OR "finalNetGrosze" <= "finalGrossGrosze"),
    -- An approved settlement always carries the confirmed payroll office figures of its current version.
    CHECK ("status" = 'DRAFT' OR ("payrollOfficeConfirmedAt" IS NOT NULL AND "currentVersionNumber" >= 1))
);
CREATE UNIQUE INDEX "PayrollSettlement_employeeId_year_month_key" ON "PayrollSettlement"("employeeId", "year", "month");
CREATE INDEX "PayrollSettlement_year_month_idx" ON "PayrollSettlement"("year", "month");

CREATE TABLE "PayrollOvertimeLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "timeEntryId" TEXT NOT NULL,
    "date" TEXT NOT NULL CHECK ("date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
    "overtimeMinutes" INTEGER NOT NULL CHECK ("overtimeMinutes" > 0),
    "entryStatus" TEXT NOT NULL CHECK ("entryStatus" IN ('pending', 'approved', 'rejected')),
    "isSaturday" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT CHECK ("resolution" IS NULL OR "resolution" IN ('PAYOUT', 'TIME_OFF')),
    "resolutionSource" TEXT CHECK ("resolutionSource" IS NULL OR "resolutionSource" IN ('OVERTIME_REQUEST', 'ADMIN')),
    CONSTRAINT "PayrollOvertimeLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PayrollSettlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PayrollOvertimeLine_settlementId_timeEntryId_key" ON "PayrollOvertimeLine"("settlementId", "timeEntryId");

CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('BONUS', 'CORRECTION')),
    "label" TEXT NOT NULL CHECK (length(trim("label")) >= 2),
    "amountGrosze" INTEGER NOT NULL CHECK ("amountGrosze" <> 0 AND abs("amountGrosze") <= 100000000),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "deletedById" TEXT,
    CONSTRAINT "PayrollAdjustment_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PayrollSettlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" <> 'BONUS' OR "amountGrosze" > 0),
    CHECK (("deletedAt" IS NULL AND "deletedById" IS NULL) OR ("deletedAt" IS NOT NULL AND "deletedById" IS NOT NULL))
);
CREATE INDEX "PayrollAdjustment_settlementId_idx" ON "PayrollAdjustment"("settlementId");

CREATE TABLE "PayrollSettlementVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL CHECK ("year" BETWEEN 2020 AND 2100),
    "month" INTEGER NOT NULL CHECK ("month" BETWEEN 1 AND 12),
    "versionNumber" INTEGER NOT NULL CHECK ("versionNumber" >= 1),
    "costCenterId" TEXT NOT NULL,
    "employmentType" TEXT,
    "baseSalaryGrosze" INTEGER NOT NULL CHECK ("baseSalaryGrosze" > 0),
    "baseBasis" TEXT NOT NULL CHECK ("baseBasis" IN ('MONTHLY_GROSS', 'HOURLY_GROSS')),
    "bonusesGrosze" INTEGER NOT NULL CHECK ("bonusesGrosze" >= 0),
    "correctionsGrosze" INTEGER NOT NULL,
    "payoutOvertimeMinutes" INTEGER NOT NULL CHECK ("payoutOvertimeMinutes" >= 0),
    "timeOffOvertimeMinutes" INTEGER NOT NULL CHECK ("timeOffOvertimeMinutes" >= 0),
    "approvedWorkedMinutes" INTEGER NOT NULL CHECK ("approvedWorkedMinutes" >= 0),
    "finalGrossGrosze" INTEGER NOT NULL CHECK ("finalGrossGrosze" > 0),
    "finalNetGrosze" INTEGER NOT NULL CHECK ("finalNetGrosze" >= 0),
    "employerCostGrosze" INTEGER NOT NULL CHECK ("employerCostGrosze" > 0),
    "payrollOfficeReference" TEXT,
    "payrollOfficeConfirmedAt" DATETIME NOT NULL,
    "snapshotJson" TEXT NOT NULL CHECK (json_valid("snapshotJson")),
    "approvalNote" TEXT,
    "approvedById" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" DATETIME,
    "supersededByVersionId" TEXT,
    CONSTRAINT "PayrollSettlementVersion_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PayrollSettlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("finalNetGrosze" <= "finalGrossGrosze"),
    CHECK (("supersededAt" IS NULL AND "supersededByVersionId" IS NULL) OR ("supersededAt" IS NOT NULL AND "supersededByVersionId" IS NOT NULL))
);
CREATE UNIQUE INDEX "PayrollSettlementVersion_settlementId_versionNumber_key" ON "PayrollSettlementVersion"("settlementId", "versionNumber");
CREATE INDEX "PayrollSettlementVersion_year_month_idx" ON "PayrollSettlementVersion"("year", "month");
-- Double cost recognition guard: at most one effective (not superseded) approved version per employee-month.
CREATE UNIQUE INDEX "PayrollSettlementVersion_effective_employee_month_key"
    ON "PayrollSettlementVersion"("employeeId", "year", "month") WHERE "supersededAt" IS NULL;

CREATE TABLE "PayrollAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "settlementId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" TEXT CHECK ("beforeJson" IS NULL OR json_valid("beforeJson")),
    "afterJson" TEXT CHECK ("afterJson" IS NULL OR json_valid("afterJson")),
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollAuditEvent_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PayrollSettlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PayrollAuditEvent_settlementId_createdAt_idx" ON "PayrollAuditEvent"("settlementId", "createdAt");
CREATE INDEX "PayrollAuditEvent_employeeId_createdAt_idx" ON "PayrollAuditEvent"("employeeId", "createdAt");

-- ── Immutability guards ─────────────────────────────────────────────────────

CREATE TRIGGER "PayrollAuditEvent_no_update" BEFORE UPDATE ON "PayrollAuditEvent"
BEGIN SELECT RAISE(ABORT, 'payroll audit events are append-only'); END;

CREATE TRIGGER "PayrollAuditEvent_no_delete" BEFORE DELETE ON "PayrollAuditEvent"
BEGIN SELECT RAISE(ABORT, 'payroll audit events are append-only'); END;

CREATE TRIGGER "PayrollSettlementVersion_no_delete" BEFORE DELETE ON "PayrollSettlementVersion"
BEGIN SELECT RAISE(ABORT, 'approved payroll versions cannot be deleted'); END;

-- The only permitted change is superseding an effective version exactly once.
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
BEGIN SELECT RAISE(ABORT, 'approved payroll versions are immutable'); END;

-- Base salaries are append-only: only a single revocation is allowed.
CREATE TRIGGER "PayrollBaseSalary_no_delete" BEFORE DELETE ON "PayrollBaseSalary"
BEGIN SELECT RAISE(ABORT, 'payroll base salaries are append-only; revoke instead'); END;

CREATE TRIGGER "PayrollBaseSalary_immutable" BEFORE UPDATE ON "PayrollBaseSalary"
WHEN OLD."revokedAt" IS NOT NULL
  OR NEW."employeeId" IS NOT OLD."employeeId"
  OR NEW."amountGrosze" IS NOT OLD."amountGrosze"
  OR NEW."basis" IS NOT OLD."basis"
  OR NEW."effectiveFrom" IS NOT OLD."effectiveFrom"
  OR NEW."note" IS NOT OLD."note"
  OR NEW."createdById" IS NOT OLD."createdById"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'payroll base salaries are append-only; revoke instead'); END;

-- Settlements are never deleted (history and versions reference them).
CREATE TRIGGER "PayrollSettlement_no_delete" BEFORE DELETE ON "PayrollSettlement"
BEGIN SELECT RAISE(ABORT, 'payroll settlements cannot be deleted'); END;

-- An approved settlement is locked; the only allowed transition is an explicit reopen to DRAFT.
CREATE TRIGGER "PayrollSettlement_approved_locked" BEFORE UPDATE ON "PayrollSettlement"
WHEN OLD."status" = 'APPROVED' AND NEW."status" = 'APPROVED'
BEGIN SELECT RAISE(ABORT, 'approved payroll settlement is locked; reopen it first'); END;

-- Approving requires a matching effective version to exist.
CREATE TRIGGER "PayrollSettlement_approve_requires_version" BEFORE UPDATE OF "status" ON "PayrollSettlement"
WHEN NEW."status" = 'APPROVED' AND NOT EXISTS (
  SELECT 1 FROM "PayrollSettlementVersion" v
  WHERE v."settlementId" = NEW."id" AND v."versionNumber" = NEW."currentVersionNumber" AND v."supersededAt" IS NULL
)
BEGIN SELECT RAISE(ABORT, 'approved payroll settlement requires its effective version'); END;

-- Child rows of an approved settlement cannot change.
CREATE TRIGGER "PayrollAdjustment_locked_insert" BEFORE INSERT ON "PayrollAdjustment"
WHEN (SELECT "status" FROM "PayrollSettlement" WHERE "id" = NEW."settlementId") <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'payroll settlement is not a draft'); END;

CREATE TRIGGER "PayrollAdjustment_locked_update" BEFORE UPDATE ON "PayrollAdjustment"
WHEN (SELECT "status" FROM "PayrollSettlement" WHERE "id" = OLD."settlementId") <> 'DRAFT'
  OR NEW."settlementId" IS NOT OLD."settlementId"
  OR OLD."deletedAt" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'payroll adjustment is locked'); END;

CREATE TRIGGER "PayrollAdjustment_no_delete" BEFORE DELETE ON "PayrollAdjustment"
BEGIN SELECT RAISE(ABORT, 'payroll adjustments are soft-deleted to keep history'); END;

CREATE TRIGGER "PayrollOvertimeLine_locked_insert" BEFORE INSERT ON "PayrollOvertimeLine"
WHEN (SELECT "status" FROM "PayrollSettlement" WHERE "id" = NEW."settlementId") <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'payroll settlement is not a draft'); END;

CREATE TRIGGER "PayrollOvertimeLine_locked_update" BEFORE UPDATE ON "PayrollOvertimeLine"
WHEN (SELECT "status" FROM "PayrollSettlement" WHERE "id" = OLD."settlementId") <> 'DRAFT'
  OR NEW."settlementId" IS NOT OLD."settlementId"
BEGIN SELECT RAISE(ABORT, 'payroll settlement is not a draft'); END;

CREATE TRIGGER "PayrollOvertimeLine_locked_delete" BEFORE DELETE ON "PayrollOvertimeLine"
WHEN (SELECT "status" FROM "PayrollSettlement" WHERE "id" = OLD."settlementId") <> 'DRAFT'
BEGIN SELECT RAISE(ABORT, 'payroll settlement is not a draft'); END;
