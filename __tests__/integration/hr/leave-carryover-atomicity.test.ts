import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@/generated/prisma'
import { executeLeaveCarryoverBatch } from '@/lib/hr/leave-carryover'
import { runSerializableTransactionWithRetry } from '@/lib/hr/serializable-transaction'

const VL_TYPE_ID = 'leave-type-vl'
const FROM_YEAR = 2025
const TO_YEAR = 2026

let tempDir = ''
let prisma: PrismaClient

async function seedEmployee(
  id: string,
  firstName: string,
  source: {
    totalDays: number
    usedDays: number
    pendingDays: number
  }
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Employee"
      ("id", "firstName", "lastName", "startDate", "active")
     VALUES (?, ?, 'Testowy', ?, true)`,
    id,
    firstName,
    new Date('2024-01-01T00:00:00.000Z')
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO "LeaveEntitlementConfig"
      ("id", "employeeId", "mode", "customAnnualDays",
       "employmentFraction", "effectiveFrom")
     VALUES (?, ?, 'DAYS_20', NULL, 1, ?)`,
    `config-${id}`,
    id,
    new Date('2025-01-01T00:00:00.000Z')
  )
  await prisma.leaveBalanceNew.create({
    data: {
      id: `source-${id}`,
      employeeId: id,
      leaveTypeId: VL_TYPE_ID,
      year: FROM_YEAR,
      totalDays: source.totalDays,
      usedDays: source.usedDays,
      pendingDays: source.pendingDays,
    },
  })
}

async function runBatch() {
  return runSerializableTransactionWithRetry(
    () =>
      prisma.$transaction(
        (tx) =>
          executeLeaveCarryoverBatch(tx, {
            fromYear: FROM_YEAR,
            toYear: TO_YEAR,
            reason: 'Integration carryover',
            actorId: 'admin-integration',
          }),
        { isolationLevel: 'Serializable' }
      ),
    { initialDelayMs: 0 }
  )
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'walldecor-leave-carryover-'))
  prisma = new PrismaClient({
    datasources: {
      db: { url: `file:${join(tempDir, 'carryover.db')}` },
    },
  })

  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Employee" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "firstName" TEXT NOT NULL,
      "lastName" TEXT NOT NULL,
      "startDate" DATETIME NOT NULL,
      "active" BOOLEAN NOT NULL DEFAULT true
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "LeaveType" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "code" TEXT NOT NULL,
      "parentId" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "isPaid" BOOLEAN NOT NULL DEFAULT true,
      "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
      "tracksBalance" BOOLEAN NOT NULL DEFAULT true
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "LeaveEntitlementConfig" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "employeeId" TEXT NOT NULL,
      "mode" TEXT NOT NULL,
      "customAnnualDays" INTEGER,
      "employmentFraction" REAL NOT NULL DEFAULT 1,
      "effectiveFrom" DATETIME NOT NULL,
      CONSTRAINT "LeaveEntitlementConfig_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "LeaveBalanceNew" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "employeeId" TEXT NOT NULL,
      "leaveTypeId" TEXT NOT NULL,
      "year" INTEGER NOT NULL,
      "totalDays" REAL NOT NULL,
      "usedDays" REAL NOT NULL DEFAULT 0,
      "pendingDays" REAL NOT NULL DEFAULT 0,
      "carriedOver" REAL NOT NULL DEFAULT 0,
      CONSTRAINT "LeaveBalanceNew_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "LeaveBalanceNew_leaveTypeId_fkey"
        FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "LeaveBalanceNew_employeeId_leaveTypeId_year_key"
    ON "LeaveBalanceNew"("employeeId", "leaveTypeId", "year")
  `)
  await prisma.$executeRawUnsafe(`
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
      CONSTRAINT "LeaveBalanceCorrection_balanceId_fkey"
        FOREIGN KEY ("balanceId") REFERENCES "LeaveBalanceNew" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "LeaveBalanceCorrection_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "LeaveBalanceCorrection_leaveTypeId_fkey"
        FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "LeaveType"
      ("id", "code", "parentId", "isActive", "isPaid",
       "requiresApproval", "tracksBalance")
     VALUES (?, 'VL', NULL, true, true, true, true)`,
    VL_TYPE_ID
  )
})

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "fail_second_correction"'
  )
  await prisma.leaveBalanceCorrection.deleteMany()
  await prisma.leaveBalanceNew.deleteMany()
  await prisma.$executeRawUnsafe('DELETE FROM "LeaveEntitlementConfig"')
  await prisma.$executeRawUnsafe('DELETE FROM "Employee"')
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('leave carryover batch atomicity', () => {
  it('rolls back the first employee and every audit when the second employee fails', async () => {
    await seedEmployee('employee-1', 'Anna', {
      totalDays: 12,
      usedDays: 5,
      pendingDays: 1,
    })
    await seedEmployee('employee-2', 'Jan', {
      totalDays: 10,
      usedDays: 4,
      pendingDays: 1,
    })
    await prisma.leaveBalanceNew.create({
      data: {
        id: 'target-employee-2',
        employeeId: 'employee-2',
        leaveTypeId: VL_TYPE_ID,
        year: TO_YEAR,
        totalDays: 21,
        usedDays: 2,
        pendingDays: 1,
        carriedOver: 1,
      },
    })
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "fail_second_correction"
      BEFORE INSERT ON "LeaveBalanceCorrection"
      WHEN NEW."employeeId" = 'employee-2'
      BEGIN
        SELECT RAISE(ABORT, 'forced second audit failure');
      END
    `)

    await expect(runBatch()).rejects.toThrow()

    const [firstTarget, secondTarget, correctionCount] = await Promise.all([
      prisma.leaveBalanceNew.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: 'employee-1',
            leaveTypeId: VL_TYPE_ID,
            year: TO_YEAR,
          },
        },
      }),
      prisma.leaveBalanceNew.findUniqueOrThrow({
        where: { id: 'target-employee-2' },
      }),
      prisma.leaveBalanceCorrection.count(),
    ])

    expect(firstTarget).toBeNull()
    expect(secondTarget).toMatchObject({
      totalDays: 21,
      usedDays: 2,
      pendingDays: 1,
      carriedOver: 1,
    })
    expect(correctionCount).toBe(0)
  })

  it('commits the whole batch and reruns without changing balances or audits', async () => {
    await seedEmployee('employee-1', 'Anna', {
      totalDays: 12,
      usedDays: 5,
      pendingDays: 1,
    })
    await seedEmployee('employee-2', 'Jan', {
      totalDays: 10,
      usedDays: 4,
      pendingDays: 1,
    })
    await prisma.leaveBalanceNew.create({
      data: {
        id: 'target-employee-2',
        employeeId: 'employee-2',
        leaveTypeId: VL_TYPE_ID,
        year: TO_YEAR,
        totalDays: 21,
        usedDays: 2,
        pendingDays: 1,
        carriedOver: 1,
      },
    })

    const firstResult = await runBatch()
    const targetsAfterFirstRun = await prisma.leaveBalanceNew.findMany({
      where: { year: TO_YEAR },
      orderBy: { employeeId: 'asc' },
    })
    const auditCountAfterFirstRun = await prisma.leaveBalanceCorrection.count()

    const secondResult = await runBatch()
    const targetsAfterSecondRun = await prisma.leaveBalanceNew.findMany({
      where: { year: TO_YEAR },
      orderBy: { employeeId: 'asc' },
    })
    const auditCountAfterSecondRun = await prisma.leaveBalanceCorrection.count()

    expect(firstResult).toMatchObject({
      processed: 2,
      created: 1,
      updated: 1,
      skipped: 0,
    })
    expect(secondResult).toMatchObject({
      processed: 2,
      created: 0,
      updated: 0,
      skipped: 2,
    })
    expect(targetsAfterFirstRun).toEqual(targetsAfterSecondRun)
    expect(targetsAfterSecondRun).toEqual([
      expect.objectContaining({
        employeeId: 'employee-1',
        totalDays: 26,
        usedDays: 0,
        pendingDays: 0,
        carriedOver: 6,
      }),
      expect.objectContaining({
        employeeId: 'employee-2',
        totalDays: 25,
        usedDays: 2,
        pendingDays: 1,
        carriedOver: 5,
      }),
    ])
    expect(auditCountAfterFirstRun).toBe(1)
    expect(auditCountAfterSecondRun).toBe(auditCountAfterFirstRun)
  })
})
