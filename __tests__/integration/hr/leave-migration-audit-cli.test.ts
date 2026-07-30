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
  vldBalancesIgnoredByNewPolicy: 1,
  existingRequests: 3,
  existingVldRequests: 2,
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
        "code" TEXT NOT NULL UNIQUE
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LeaveBalanceNew" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "leaveTypeId" TEXT NOT NULL
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "LeaveRequestNew" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "leaveTypeId" TEXT NOT NULL,
        "isOnDemand" BOOLEAN NOT NULL DEFAULT false
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
      INSERT INTO "LeaveType" ("id", "code") VALUES
        ('leave-type-vl', 'VL'),
        ('leave-type-vld', 'VLD')
    `)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LeaveBalanceNew" ("id", "leaveTypeId") VALUES
        ('balance-vl-1', 'leave-type-vl'),
        ('balance-vl-2', 'leave-type-vl'),
        ('balance-vld-1', 'leave-type-vld')
    `)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LeaveRequestNew" ("id", "leaveTypeId", "isOnDemand") VALUES
        ('request-vld', 'leave-type-vld', false),
        ('request-demand', 'leave-type-vl', true),
        ('request-vl', 'leave-type-vl', false)
    `)
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
