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
import {
  getWarsawBusinessDate,
  getWarsawBusinessDateQueryRange,
} from '@/lib/hr/business-date'
import { runSerializableTransactionWithRetry } from '@/lib/hr/serializable-transaction'

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

const mockGetServerSession = vi.mocked(getServerSession)

let tempDir = ''
let databaseUrl = ''
let prisma: PrismaClient
let postBatch: typeof import('@/app/api/hr/time-tracking/batch/route').POST

class BlockingApprovedLeaveError extends Error {}
class WorkedTimeConflictError extends Error {}

function createClient() {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  })
}

function createOneShotGate(parties: number) {
  let arrivals = 0
  let release: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    release = resolve
  })

  return async () => {
    if (arrivals < parties) {
      arrivals++
      if (arrivals === parties) release()
    }
    await ready
  }
}

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
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 100')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "AppSetting" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" TEXT NOT NULL,
      "updatedAt" DATETIME NOT NULL
    )
  `)
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
      "dailyHours" REAL NOT NULL DEFAULT 8,
      "overtimeThreshold" REAL NOT NULL DEFAULT 8
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
      "isDelegation" BOOLEAN NOT NULL DEFAULT false,
      "updatedAt" DATETIME NOT NULL
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
  databaseUrl = `file:${join(tempDir, 'time-batch.db')}`
  prisma = createClient()
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
  await prisma.$executeRawUnsafe('DELETE FROM "AppSetting"')
  await prisma.$executeRawUnsafe(`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt")
    VALUES ('hr_overtime_threshold_minutes', '480', CURRENT_TIMESTAMP)
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Division" ("id", "name")
    VALUES ('JAG', 'Jagiellonska')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Employee" ("id", "divisionId", "active")
    VALUES ('employee-1', 'JAG', true)
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "TimeTrackingRule" (
      "id",
      "divisionId",
      "dailyHours",
      "overtimeThreshold"
    )
    VALUES ('rule-a', 'JAG', 7.5, 8)
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
      overtimeMinutes: 90,
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

  it('serializes leave approval against worked-time creation so both cannot commit', async () => {
    const date = new Date('2026-07-06T00:00:00.000Z')
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "LeaveRequestNew" (
          "id",
          "employeeId",
          "startDate",
          "endDate",
          "status",
          "isRemoteWork",
          "isDelegation",
          "updatedAt"
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      'leave-concurrent',
      'employee-1',
      date,
      date,
      'pending',
      false,
      false,
      new Date('2026-07-01T00:00:00.000Z')
    )

    const approvalClient = createClient()
    const timeEntryClient = createClient()

    await Promise.all([
      approvalClient.$queryRawUnsafe('PRAGMA busy_timeout = 100'),
      timeEntryClient.$queryRawUnsafe('PRAGMA busy_timeout = 100'),
    ])

    const approveLeave = () => runSerializableTransactionWithRetry(
      () => approvalClient.$transaction(
        async (tx) => {
          const dateRange = getWarsawBusinessDateQueryRange(date)
          const entries = await tx.timeEntry.findMany({
            where: {
              employeeId: 'employee-1',
              date: dateRange,
            },
            select: { date: true },
          })

          if (entries.some(
            (entry) =>
              getWarsawBusinessDate(entry.date).isoDate === '2026-07-06'
          )) {
            throw new WorkedTimeConflictError()
          }

          const transition = await tx.leaveRequestNew.updateMany({
            where: { id: 'leave-concurrent', status: 'pending' },
            data: { status: 'approved' },
          })
          if (transition.count !== 1) throw new WorkedTimeConflictError()
        },
        {
          isolationLevel: 'Serializable',
          maxWait: 1_000,
          timeout: 1_000,
        }
      ),
      { initialDelayMs: 0, maxAttempts: 5 }
    )

    const createWorkedTime = () => runSerializableTransactionWithRetry(
      () => timeEntryClient.$transaction(
        async (tx) => {
          const blockingLeaves = await tx.leaveRequestNew.findMany({
            where: {
              employeeId: 'employee-1',
              status: 'approved',
              isRemoteWork: false,
              isDelegation: false,
              startDate: { lte: date },
              endDate: { gte: date },
            },
            select: { id: true },
          })

          if (blockingLeaves.length > 0) {
            throw new BlockingApprovedLeaveError()
          }

          await tx.timeEntry.create({
            data: {
              employeeId: 'employee-1',
              date,
              clockIn: new Date('2026-07-06T06:00:00.000Z'),
              clockOut: new Date('2026-07-06T14:00:00.000Z'),
              source: 'bulk',
              status: 'pending',
              totalMinutes: 480,
              breakMinutes: 30,
              overtimeMinutes: 0,
            },
          })
        },
        {
          isolationLevel: 'Serializable',
          maxWait: 1_000,
          timeout: 1_000,
        }
      ),
      { initialDelayMs: 0, maxAttempts: 5 }
    )

    try {
      /*
       * SQLite serializes writers at database level. With Prisma's interactive
       * transactions here, placing a two-party gate after both predicate reads
       * deadlocks because the second callback waits before reaching its read.
       * Instead, two clients first prove they can make the stale decisions, then
       * the loser gets a deterministic P2034 and retries a real Serializable
       * transaction against the winner's committed state.
       */
      const afterPreflightRead = createOneShotGate(2)
      const [initialEntries, initialBlockingLeaves] = await Promise.all([
        approvalClient.timeEntry.findMany({
          where: { employeeId: 'employee-1', date },
          select: { id: true },
        }).then(async (entries) => {
          await afterPreflightRead()
          return entries
        }),
        timeEntryClient.leaveRequestNew.findMany({
          where: {
            employeeId: 'employee-1',
            status: 'approved',
            startDate: { lte: date },
            endDate: { gte: date },
          },
          select: { id: true },
        }).then(async (leaves) => {
          await afterPreflightRead()
          return leaves
        }),
      ])
      expect(initialEntries).toEqual([])
      expect(initialBlockingLeaves).toEqual([])

      await approveLeave()

      const conflict = Object.assign(new Error('Write conflict'), { code: 'P2034' })
      const transactionSpy = vi.spyOn(timeEntryClient, '$transaction')
        .mockRejectedValueOnce(conflict)

      await expect(createWorkedTime()).rejects.toBeInstanceOf(
        BlockingApprovedLeaveError
      )
      expect(transactionSpy).toHaveBeenCalledTimes(2)
      transactionSpy.mockRestore()

      let [leave, entryCount] = await Promise.all([
        prisma.leaveRequestNew.findUniqueOrThrow({
          where: { id: 'leave-concurrent' },
          select: { status: true },
        }),
        prisma.timeEntry.count({
          where: { employeeId: 'employee-1', date },
        }),
      ])

      expect({ leaveStatus: leave.status, entryCount }).toEqual({
        leaveStatus: 'approved',
        entryCount: 0,
      })
      expect(leave.status === 'approved' && entryCount === 1).toBe(false)

      await prisma.leaveRequestNew.updateMany({
        where: { id: 'leave-concurrent' },
        data: { status: 'pending' },
      })
      await createWorkedTime()
      await expect(approveLeave()).rejects.toBeInstanceOf(
        WorkedTimeConflictError
      )

      ;[leave, entryCount] = await Promise.all([
        prisma.leaveRequestNew.findUniqueOrThrow({
          where: { id: 'leave-concurrent' },
          select: { status: true },
        }),
        prisma.timeEntry.count({
          where: { employeeId: 'employee-1', date },
        }),
      ])
      expect({ leaveStatus: leave.status, entryCount }).toEqual({
        leaveStatus: 'pending',
        entryCount: 1,
      })
      expect(leave.status === 'approved' && entryCount === 1).toBe(false)
    } finally {
      await Promise.all([
        approvalClient.$disconnect(),
        timeEntryClient.$disconnect(),
      ])
    }
  })
})
