-- Origin of an approved payroll version: MANUAL (detail page or month sheet) or AUTO_CARRYOVER
-- (approved on the 1st of the month by the payroll automat, amounts copied from the previous month).
-- Additive: every existing version keeps MANUAL. The automat's switch and run state live in AppSetting
-- (payroll_auto_carryover_*), which needs no schema change; the automat is OFF until an ADMIN enables it.

ALTER TABLE "PayrollSettlementVersion" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'MANUAL'
  CHECK ("origin" IN ('MANUAL', 'AUTO_CARRYOVER'));

-- ── Versions stay immutable, including the new column ───────────────────────

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
  OR NEW."origin" IS NOT OLD."origin"
BEGIN SELECT RAISE(ABORT, 'approved payroll versions are immutable'); END;
