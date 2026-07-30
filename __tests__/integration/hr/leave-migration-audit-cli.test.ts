import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const expectedReport = {
  employees: 3,
  employeesWithConfig: 2,
  vacationBalances: 2,
  existingRequests: 3,
  vld: {
    balances: {
      count: 1,
      totalDays: 4,
      usedDays: 2,
      pendingDays: 1,
      transferredCount: 0,
      transferredUsedDays: 0,
      transferredPendingDays: 0,
    },
    balancesWithoutVl: {
      count: 1,
      totalDays: 4,
      usedDays: 2,
      pendingDays: 1,
    },
    requests: {
      count: 2,
      days: 3,
      byStatus: {
        pending: { count: 1, days: 1 },
        approved: { count: 1, days: 2 },
        rejected: { count: 0, days: 0 },
        cancelled: { count: 0, days: 0 },
        other: { count: 0, days: 0 },
      },
    },
    pendingRequestsNotProcessable: {
      count: 1,
      days: 1,
      groups: [
        {
          employeeId: 'employee-3',
          year: 2026,
          requestCount: 1,
          requestDays: 1,
          reasons: ['MISSING_VL_BALANCE'],
        },
      ],
    },
  },
  blockers: [
    {
      code: 'ACTIVE_EMPLOYEE_WITHOUT_ENTITLEMENT_CONFIG',
      count: 1,
    },
    {
      code: 'VLD_BALANCE_WITHOUT_VL',
      count: 1,
      totalDays: 4,
      usedDays: 2,
      pendingDays: 1,
    },
    {
      code: 'PENDING_VLD_REQUEST_NOT_PROCESSABLE',
      count: 1,
      days: 1,
    },
  ],
  readyForProduction: false,
}

let tempDir = ''

function createClient(databasePath: string) {
  return new PrismaClient({
    datasources: { db: { url: `file:${databasePath}` } },
  })
}

async function createAuditDatabase(databasePath: string) {
  const prisma = createClient(databasePath)

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "Employee" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "active" BOOLEAN NOT NULL
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LeaveEntitlementConfig" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "employeeId" TEXT NOT NULL
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LeaveType" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "code" TEXT NOT NULL UNIQUE,
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
        "usedDays" REAL NOT NULL,
        "pendingDays" REAL NOT NULL
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LeaveRequestNew" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "employeeId" TEXT NOT NULL,
        "leaveTypeId" TEXT NOT NULL,
        "startDate" DATETIME NOT NULL,
        "days" REAL NOT NULL,
        "status" TEXT NOT NULL,
        "isOnDemand" BOOLEAN NOT NULL DEFAULT false
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LeaveBalanceCorrection" (
        "id" TEXT NOT NULL PRIMARY KEY
      )
    `)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Employee" ("id", "active") VALUES
        ('employee-1', true),
        ('employee-2', true),
        ('employee-3', true),
        ('employee-4', false)
    `)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LeaveEntitlementConfig" ("id", "employeeId") VALUES
        ('config-1', 'employee-1'),
        ('config-2', 'employee-2'),
        ('config-4', 'employee-4')
    `)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LeaveType" ("id", "code", "parentId") VALUES
        ('leave-type-vl', 'VL', NULL),
        ('leave-type-vld', 'VLD', 'leave-type-vl')
    `)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LeaveBalanceNew"
        ("id", "employeeId", "leaveTypeId", "year",
         "totalDays", "usedDays", "pendingDays")
      VALUES
        ('balance-vl-1', 'employee-1', 'leave-type-vl', 2026, 20, 3, 1),
        ('balance-vl-2', 'employee-2', 'leave-type-vl', 2026, 20, 2, 0),
        ('balance-vld-1', 'employee-3', 'leave-type-vld', 2026, 4, 2, 1)
    `)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "LeaveRequestNew"
        ("id", "employeeId", "leaveTypeId", "startDate",
         "days", "status", "isOnDemand")
       VALUES
        ('request-vld', 'employee-3', 'leave-type-vld', ?, 1, 'pending', false),
        ('request-demand', 'employee-1', 'leave-type-vl', ?, 2, 'approved', true),
        ('request-vl', 'employee-2', 'leave-type-vl', ?, 1, 'approved', false)`,
      new Date('2026-07-07T00:00:00.000Z'),
      new Date('2026-06-05T00:00:00.000Z'),
      new Date('2026-05-04T00:00:00.000Z')
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function createEmptyDatabase(databasePath: string) {
  const prisma = createClient(databasePath)

  try {
    await prisma.$executeRawUnsafe('PRAGMA user_version = 0')
  } finally {
    await prisma.$disconnect()
  }
}

function runAuditCli(databasePath: string) {
  return new Promise<{
    exitCode: number | null
    stdout: string
    stderr: string
  }>((resolveProcess, rejectProcess) => {
    const child = spawn(
      process.execPath,
      [
        '--preserve-symlinks',
        '--import',
        'tsx',
        'scripts/audit-hr-leave-migration.ts',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: `file:${databasePath}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', rejectProcess)
    child.once('close', (exitCode) => {
      resolveProcess({ exitCode, stdout, stderr })
    })
  })
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'walldecor-leave-audit-cli-'))
})

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('HR leave migration audit CLI', () => {
  it('prints only pretty JSON and exits zero against an isolated SQLite database', async () => {
    const databasePath = join(tempDir, 'audit.db')
    await createAuditDatabase(databasePath)

    const result = await runAuditCli(databasePath)

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${JSON.stringify(expectedReport, null, 2)}\n`,
      stderr: '',
    })
  })

  it('prints only the controlled error and exits one when tables are missing', async () => {
    const databasePath = join(tempDir, 'missing-tables.db')
    await createEmptyDatabase(databasePath)

    const result = await runAuditCli(databasePath)

    expect(result).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'HR leave migration audit failed.\n',
    })
  })
})
