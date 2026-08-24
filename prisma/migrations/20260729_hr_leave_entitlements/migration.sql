BEGIN IMMEDIATE;

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

-- VLD_HISTORY_MERGE_BEGIN
-- VLD is a way of using the VL entitlement, not a separate entitlement pool.
-- A deterministic correction ID makes this transfer auditable and idempotent.
UPDATE "LeaveType"
SET "parentId" = (
    SELECT "id"
    FROM "LeaveType"
    WHERE "code" = 'VL'
)
WHERE "code" = 'VLD'
  AND EXISTS (
      SELECT 1
      FROM "LeaveType"
      WHERE "code" = 'VL'
  );

INSERT INTO "LeaveBalanceCorrection" (
    "id",
    "balanceId",
    "employeeId",
    "leaveTypeId",
    "year",
    "reason",
    "actorId",
    "beforeJson",
    "afterJson"
)
SELECT
    'migration:vld-to-vl:v1:' || "vldBalance"."id",
    "vlBalance"."id",
    "vlBalance"."employeeId",
    "vlBalance"."leaveTypeId",
    "vlBalance"."year",
    'Migracja historycznego salda VLD do wspólnej puli VL',
    'system:hr-leave-vld-merge:v1',
    json_object(
        'totalDays', "vlBalance"."totalDays",
        'usedDays', "vlBalance"."usedDays",
        'pendingDays', "vlBalance"."pendingDays",
        'carriedOver', "vlBalance"."carriedOver",
        'sourceVldBalanceId', "vldBalance"."id",
        'transferredUsedDays', "vldBalance"."usedDays",
        'transferredPendingDays', "vldBalance"."pendingDays"
    ),
    json_object(
        'totalDays', MAX(
            "vlBalance"."totalDays",
            "vlBalance"."usedDays" + "vldBalance"."usedDays"
                + "vlBalance"."pendingDays" + "vldBalance"."pendingDays"
        ),
        'usedDays', "vlBalance"."usedDays" + "vldBalance"."usedDays",
        'pendingDays', "vlBalance"."pendingDays" + "vldBalance"."pendingDays",
        'carriedOver', "vlBalance"."carriedOver",
        'sourceVldBalanceId', "vldBalance"."id",
        'transferredUsedDays', "vldBalance"."usedDays",
        'transferredPendingDays', "vldBalance"."pendingDays"
    )
FROM "LeaveBalanceNew" AS "vldBalance"
JOIN "LeaveType" AS "vldType"
    ON "vldType"."id" = "vldBalance"."leaveTypeId"
   AND "vldType"."code" = 'VLD'
JOIN "LeaveBalanceNew" AS "vlBalance"
    ON "vlBalance"."employeeId" = "vldBalance"."employeeId"
   AND "vlBalance"."year" = "vldBalance"."year"
JOIN "LeaveType" AS "vlType"
    ON "vlType"."id" = "vlBalance"."leaveTypeId"
   AND "vlType"."code" = 'VL'
WHERE NOT EXISTS (
    SELECT 1
    FROM "LeaveBalanceCorrection" AS "existingCorrection"
    WHERE "existingCorrection"."id" =
        'migration:vld-to-vl:v1:' || "vldBalance"."id"
);

UPDATE "LeaveBalanceNew" AS "vlBalance"
SET
    "totalDays" = json_extract("correction"."afterJson", '$.totalDays'),
    "usedDays" = json_extract("correction"."afterJson", '$.usedDays'),
    "pendingDays" = json_extract("correction"."afterJson", '$.pendingDays')
FROM "LeaveBalanceNew" AS "vldBalance"
JOIN "LeaveType" AS "vldType"
    ON "vldType"."id" = "vldBalance"."leaveTypeId"
   AND "vldType"."code" = 'VLD'
JOIN "LeaveBalanceCorrection" AS "correction"
    ON "correction"."id" =
       'migration:vld-to-vl:v1:' || "vldBalance"."id"
WHERE "vlBalance"."employeeId" = "vldBalance"."employeeId"
  AND "vlBalance"."year" = "vldBalance"."year"
  AND "vlBalance"."leaveTypeId" = (
      SELECT "id"
      FROM "LeaveType"
      WHERE "code" = 'VL'
  )
  AND "vlBalance"."totalDays" =
      json_extract("correction"."beforeJson", '$.totalDays')
  AND "vlBalance"."usedDays" =
      json_extract("correction"."beforeJson", '$.usedDays')
  AND "vlBalance"."pendingDays" =
      json_extract("correction"."beforeJson", '$.pendingDays');
-- VLD_HISTORY_MERGE_END

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

COMMIT;
