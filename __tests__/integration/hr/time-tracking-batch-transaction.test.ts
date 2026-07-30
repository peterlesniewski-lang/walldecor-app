import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { PrismaClient } from '@/generated/prisma'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

const mockGetServerSession = vi.mocked(getServerSession)

let tempDir = ''
let prisma: PrismaClient
let postBatch: typeof import('@/app/api/hr/time-tracking/batch/route').POST

function request(rows: Array<Record<string, unknown>>) {
  return new NextRequest('http://localhost/api/hr/time-tracking/batch', {
    method: 'POST',
    body: JSON.stringify({ employeeId: 'employee-1', rows }),
  })
}

function row(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    clockIn: `${date}T08:00:00.000Z`,
    clockOut: `${date}T16:00:00.000Z`,
    breakMinutes: 30,
    ...overrides,
  }
}

async function createSchema() {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Division" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Employee" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "divisionId" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "TimeTrackingRule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "divisionId" TEXT NOT NULL,
      "dailyHours" REAL NOT NULL DEFAULT 8
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "LeaveRequestNew" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "employeeId" TEXT NOT NULL,
      "startDate" DATETIME NOT NULL,
      "endDate" DATETIME NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "isRemoteWork" BOOLEAN NOT NULL DEFAULT false,
      "isDelegation" BOOLEAN NOT NULL DEFAULT false
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "TimeEntry" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "employeeId" TEXT NOT NULL,
      "date" DATETIME NOT NULL,
      "clockIn" DATETIME NOT NULL,
      "clockOut" DATETIME,
      "projectId" TEXT,
      "taskName" TEXT,
      "source" TEXT NOT NULL DEFAULT 'manual',
      "status" TEXT NOT NULL DEFAULT 'pending',
      "approvedById" TEXT,
      "notes" TEXT,
      "totalMinutes" INTEGER,
      "breakMinutes" INTEGER,
      "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "TimeEntry_employeeId_date_key"
    ON "TimeEntry"("employeeId", "date")
  `)
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'walldecor-time-batch-'))
  prisma = new PrismaClient({
    datasources: {
      db: { url: `file:${join(tempDir, 'time-batch.db')}` },
    },
  })
  await createSchema()

  vi.doMock('@/lib/prisma', () => ({ prisma }))
  ;({ POST: postBatch } = await import('@/app/api/hr/time-tracking/batch/route'))
})

beforeEach(async () => {
  vi.restoreAllMocks()
  mockGetServerSession.mockResolvedValue({
    user: {
      id: 'admin-user',
      name: 'Admin',
      email: 'admin@test.pl',
      role: 'ADMIN',
      employeeId: null,
    },
    expires: '',
  })

  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "fail_second_time_entry"')
  await prisma.timeEntry.deleteMany()
  await prisma.leaveRequestNew.deleteMany()
  await prisma.$executeRawUnsafe('DELETE FROM "TimeTrackingRule"')
  await prisma.$executeRawUnsafe('DELETE FROM "Employee"')
  await prisma.$executeRawUnsafe('DELETE FROM "Division"')
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Division" ("id", "name")
    VALUES ('JAG', 'Jagiellonska')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Employee" ("id", "divisionId", "active")
    VALUES ('employee-1', 'JAG', true)
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "TimeTrackingRule" ("id", "divisionId", "dailyHours")
    VALUES ('rule-a', 'JAG', 7.5)
  `)
})

afterAll(async () => {
  await prisma?.$disconnect()
  vi.doUnmock('@/lib/prisma')
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('time tracking batch transaction integration', () => {
  it('retries a conflict and writes canonical UTC date with recalculated overtime', async () => {
    const conflict = Object.assign(new Error('Write conflict'), { code: 'P2034' })
    const transactionSpy = vi.spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(conflict)

    const response = await postBatch(request([
      row('2026-07-02', {
        clockIn: '2026-07-02T06:00:00.000Z',
        clockOut: '2026-07-02T16:00:00.000Z',
      }),
    ]))
    const persisted = await prisma.timeEntry.findFirstOrThrow()

    expect(response.status).toBe(200)
    expect(transactionSpy).toHaveBeenCalledTimes(2)
    expect({
      date: persisted.date.toISOString(),
      totalMinutes: persisted.totalMinutes,
      breakMinutes: persisted.breakMinutes,
      overtimeMinutes: persisted.overtimeMinutes,
      source: persisted.source,
      status: persisted.status,
    }).toEqual({
      date: '2026-07-02T00:00:00.000Z',
      totalMinutes: 600,
      breakMinutes: 30,
      overtimeMinutes: 120,
      source: 'bulk',
      status: 'pending',
    })
  })

  it('rolls back every row when a later insert fails', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "fail_second_time_entry"
      BEFORE INSERT ON "TimeEntry"
      WHEN NEW."totalMinutes" = 540
      BEGIN
        SELECT RAISE(ABORT, 'forced second time-entry failure');
      END
    `)

    await expect(postBatch(request([
      row('2026-07-02'),
      row('2026-07-03', {
        clockOut: '2026-07-03T17:00:00.000Z',
      }),
    ]))).rejects.toThrow()

    expect(await prisma.timeEntry.count()).toBe(0)
  })
})
