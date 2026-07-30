import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@/generated/prisma'

let tempDir = ''
let prisma: PrismaClient

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'walldecor-leave-correction-'))
  const databasePath = join(tempDir, 'rollback.db')
  prisma = new PrismaClient({
    datasources: { db: { url: `file:${databasePath}` } },
  })

  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Employee" (
      "id" TEXT NOT NULL PRIMARY KEY
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "LeaveType" (
      "id" TEXT NOT NULL PRIMARY KEY
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
    'INSERT INTO "Employee" ("id") VALUES (?)',
    'employee-rollback'
  )
  await prisma.$executeRawUnsafe(
    'INSERT INTO "LeaveType" ("id") VALUES (?)',
    'leave-type-rollback'
  )
  await prisma.leaveBalanceNew.create({
    data: {
      id: 'balance-rollback',
      employeeId: 'employee-rollback',
      leaveTypeId: 'leave-type-rollback',
      year: 2026,
      totalDays: 26,
      usedDays: 5,
      pendingDays: 2,
      carriedOver: 3,
    },
  })
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('leave balance correction transaction rollback', () => {
  it('rolls back the balance update when the correction insert fails', async () => {
    await expect(prisma.$transaction(async (tx) => {
      await tx.leaveBalanceNew.update({
        where: { id: 'balance-rollback' },
        data: { totalDays: 24 },
      })
      await tx.leaveBalanceCorrection.create({
        data: {
          balanceId: 'missing-balance',
          employeeId: 'employee-rollback',
          leaveTypeId: 'leave-type-rollback',
          year: 2026,
          reason: 'Intentionally fail the correction insert',
          actorId: 'admin-rollback',
          beforeJson: JSON.stringify({
            totalDays: 26,
            usedDays: 5,
            pendingDays: 2,
            carriedOver: 3,
          }),
          afterJson: JSON.stringify({
            totalDays: 24,
            usedDays: 5,
            pendingDays: 2,
            carriedOver: 3,
          }),
        },
      })
    })).rejects.toMatchObject({ code: 'P2003' })

    const [balance, correctionCount] = await Promise.all([
      prisma.leaveBalanceNew.findUniqueOrThrow({
        where: { id: 'balance-rollback' },
      }),
      prisma.leaveBalanceCorrection.count(),
    ])

    expect(balance.totalDays).toBe(26)
    expect(correctionCount).toBe(0)
  })
})
