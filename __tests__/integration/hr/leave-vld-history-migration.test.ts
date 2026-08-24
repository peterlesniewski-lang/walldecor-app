import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const MIGRATION_PATH =
  'prisma/migrations/20260729_hr_leave_entitlements/migration.sql'
const MERGE_BEGIN = '-- VLD_HISTORY_MERGE_BEGIN'
const MERGE_END = '-- VLD_HISTORY_MERGE_END'

let tempDir = ''
let prisma: PrismaClient

function splitSqlStatements(sql: string) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

async function executeSql(sql: string) {
  const statements = splitSqlStatements(sql).filter(
    (statement) =>
      statement !== 'BEGIN IMMEDIATE' &&
      statement !== 'COMMIT'
  )

  await prisma.$transaction(async (tx) => {
    for (const statement of statements) {
      await tx.$executeRawUnsafe(statement)
    }
  })
}

async function createPreMigrationFixture() {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Employee" (
      "id" TEXT NOT NULL PRIMARY KEY
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "LeaveType" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "code" TEXT NOT NULL UNIQUE,
      "color" TEXT NOT NULL DEFAULT '#3B82F6',
      "isPaid" BOOLEAN NOT NULL DEFAULT true,
      "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
      "tracksBalance" BOOLEAN NOT NULL DEFAULT true,
      "maxDaysPerYear" INTEGER,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "parentId" TEXT
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
        FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id"),
      CONSTRAINT "LeaveBalanceNew_leaveTypeId_fkey"
        FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id")
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "LeaveBalanceNew_employeeId_leaveTypeId_year_key"
    ON "LeaveBalanceNew"("employeeId", "leaveTypeId", "year")
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "Employee" ("id") VALUES
      ('employee-with-vl'),
      ('employee-with-small-vl'),
      ('employee-without-vl')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "LeaveType"
      ("id", "name", "code", "tracksBalance", "parentId")
    VALUES
      ('leave-type-vl', 'Urlop wypoczynkowy', 'VL', true, NULL),
      ('leave-type-vld', 'Urlop na żądanie', 'VLD', true, NULL),
      ('leave-type-sl', 'Zwolnienie chorobowe', 'SL', true, NULL)
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "LeaveBalanceNew"
      ("id", "employeeId", "leaveTypeId", "year",
       "totalDays", "usedDays", "pendingDays", "carriedOver")
    VALUES
      ('vl-existing', 'employee-with-vl', 'leave-type-vl', 2026, 20, 5, 2, 0),
      ('vld-existing', 'employee-with-vl', 'leave-type-vld', 2026, 4, 3, 1, 0),
      ('vl-small', 'employee-with-small-vl', 'leave-type-vl', 2026, 5, 4, 0, 0),
      ('vld-small', 'employee-with-small-vl', 'leave-type-vld', 2026, 4, 1, 2, 0),
      ('vld-orphan', 'employee-without-vl', 'leave-type-vld', 2026, 4, 2, 1, 0)
  `)
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'walldecor-vld-migration-'))
  prisma = new PrismaClient({
    datasources: {
      db: { url: `file:${join(tempDir, 'migration.db')}` },
    },
  })
  await createPreMigrationFixture()
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('historical VLD balance migration', () => {
  it('moves VLD usage into VL, preserves commitments, and records an audit', async () => {
    const migration = await readFile(MIGRATION_PATH, 'utf8')

    await executeSql(migration)

    const [existingVl, smallVl, orphanVld, vldType, corrections] =
      await Promise.all([
        prisma.leaveBalanceNew.findUniqueOrThrow({
          where: { id: 'vl-existing' },
        }),
        prisma.leaveBalanceNew.findUniqueOrThrow({
          where: { id: 'vl-small' },
        }),
        prisma.leaveBalanceNew.findUniqueOrThrow({
          where: { id: 'vld-orphan' },
        }),
        prisma.leaveType.findUniqueOrThrow({
          where: { code: 'VLD' },
        }),
        prisma.leaveBalanceCorrection.findMany({
          orderBy: { id: 'asc' },
        }),
      ])

    expect(existingVl).toMatchObject({
      totalDays: 20,
      usedDays: 8,
      pendingDays: 3,
    })
    expect(smallVl).toMatchObject({
      totalDays: 7,
      usedDays: 5,
      pendingDays: 2,
    })
    expect(orphanVld).toMatchObject({
      totalDays: 4,
      usedDays: 2,
      pendingDays: 1,
    })
    expect(vldType.parentId).toBe('leave-type-vl')
    expect(corrections).toHaveLength(2)
    expect(corrections[0]).toMatchObject({
      id: 'migration:vld-to-vl:v1:vld-existing',
      balanceId: 'vl-existing',
      employeeId: 'employee-with-vl',
      leaveTypeId: 'leave-type-vl',
      year: 2026,
      actorId: 'system:hr-leave-vld-merge:v1',
    })
    expect(JSON.parse(corrections[0].beforeJson)).toMatchObject({
      totalDays: 20,
      usedDays: 5,
      pendingDays: 2,
      sourceVldBalanceId: 'vld-existing',
      transferredUsedDays: 3,
      transferredPendingDays: 1,
    })
    expect(JSON.parse(corrections[0].afterJson)).toMatchObject({
      totalDays: 20,
      usedDays: 8,
      pendingDays: 3,
      sourceVldBalanceId: 'vld-existing',
      transferredUsedDays: 3,
      transferredPendingDays: 1,
    })
  })

  it('does not apply historical VLD usage twice', async () => {
    const migration = await readFile(MIGRATION_PATH, 'utf8')
    const mergeStart = migration.indexOf(MERGE_BEGIN)
    const mergeEnd = migration.indexOf(MERGE_END)

    expect(mergeStart).toBeGreaterThanOrEqual(0)
    expect(mergeEnd).toBeGreaterThan(mergeStart)

    await executeSql(migration)

    const balancesBefore = await prisma.leaveBalanceNew.findMany({
      where: { leaveTypeId: 'leave-type-vl' },
      orderBy: { id: 'asc' },
    })
    const correctionsBefore = await prisma.leaveBalanceCorrection.findMany({
      orderBy: { id: 'asc' },
    })

    await executeSql(
      migration.slice(mergeStart + MERGE_BEGIN.length, mergeEnd)
    )

    const balancesAfter = await prisma.leaveBalanceNew.findMany({
      where: { leaveTypeId: 'leave-type-vl' },
      orderBy: { id: 'asc' },
    })
    const correctionsAfter = await prisma.leaveBalanceCorrection.findMany({
      orderBy: { id: 'asc' },
    })

    expect(balancesAfter).toEqual(balancesBefore)
    expect(correctionsAfter).toEqual(correctionsBefore)
  })
})
