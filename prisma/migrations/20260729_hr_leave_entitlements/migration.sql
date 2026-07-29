-- CreateTable
CREATE TABLE "LeaveEntitlementConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "customAnnualDays" INTEGER,
    "employmentFraction" REAL NOT NULL DEFAULT 1,
    "effectiveFrom" DATETIME NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeaveEntitlementConfig_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeaveBalanceCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "balanceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL,
    "afterJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeaveBalanceCorrection_balanceId_fkey" FOREIGN KEY ("balanceId") REFERENCES "LeaveBalanceNew" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeaveBalanceCorrection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeaveBalanceCorrection_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveEntitlementConfig_employeeId_effectiveFrom_key" ON "LeaveEntitlementConfig"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LeaveEntitlementConfig_employeeId_effectiveFrom_idx" ON "LeaveEntitlementConfig"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LeaveBalanceCorrection_balanceId_createdAt_idx" ON "LeaveBalanceCorrection"("balanceId", "createdAt");

-- CreateIndex
CREATE INDEX "LeaveBalanceCorrection_employeeId_year_idx" ON "LeaveBalanceCorrection"("employeeId", "year");

INSERT INTO "LeaveType" (
    "id",
    "name",
    "code",
    "color",
    "isPaid",
    "requiresApproval",
    "tracksBalance",
    "maxDaysPerYear",
    "isActive",
    "parentId"
)
SELECT
    'system:leave-type:UB:v1',
    'Urlop bezpłatny',
    'UB',
    '#64748B',
    false,
    true,
    false,
    NULL,
    true,
    NULL
WHERE NOT EXISTS (
    SELECT 1
    FROM "LeaveType"
    WHERE "code" = 'UB'
);

UPDATE "LeaveType"
SET "tracksBalance" = false
WHERE "code" IN ('SL', 'UB');

UPDATE "LeaveType"
SET
    "isPaid" = false,
    "requiresApproval" = true,
    "tracksBalance" = false
WHERE "code" = 'UB';
