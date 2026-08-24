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
import type { Session } from 'next-auth'
import { PrismaClient } from '@/generated/prisma'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'

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
let createTimeEntryBatchHandler:
  typeof import('@/app/api/hr/time-tracking/batch/route').createTimeEntryBatchHandler
let createTimeEntryFillHandler:
  typeof import('@/app/api/hr/time-tracking/monthly/fill/route').createTimeEntryFillHandler
let createLeaveApprovalHandler:
  typeof import('@/app/api/hr/leave-requests/[id]/approve/route').createLeaveApprovalHandler
let createManualTimeEntryHandler:
  typeof import('@/app/api/hr/time-tracking/route').createManualTimeEntryHandler
let createClockInHandler:
  typeof import('@/app/api/hr/time-tracking/clock-in/route').createClockInHandler
let createBulkTimeEntryHandler:
  typeof import('@/app/api/hr/time-tracking/bulk/route').createBulkTimeEntryHandler

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

function fillRequest(rows: Array<Record<string, unknown>>) {
  return new NextRequest('http://localhost/api/hr/time-tracking/monthly/fill', {
    method: 'POST',
    body: JSON.stringify({
      employeeId: 'employee-1',
      rows,
      overwrite: true,
      preview: false,
    }),
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

async function insertPendingLeave(id: string, date: string) {
  const storedDate = new Date(`${date}T00:00:00.000Z`)
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO "LeaveRequestNew" (
        "id",
        "employeeId",
        "leaveTypeId",
        "startDate",
        "endDate",
        "days",
        "status",
        "isRemoteWork",
        "isDelegation",
        "createdAt",
        "updatedAt"
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    id,
    'employee-1',
    'leave-type-ub',
    storedDate,
    storedDate,
    1,
    'pending',
    false,
    false,
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-07-01T00:00:00.000Z')
  )
}

async function assertWriterApprovalRace({
  leaveId,
  date,
  writerSession,
  createWriter,
  writerRequest,
}: {
  leaveId: string
  date: string
  writerSession: Session
  createWriter: (
    db: PrismaClient,
    getSession: () => Promise<Session | null>
  ) => (req: NextRequest) => Promise<Response>
  writerRequest: NextRequest
}) {
  await insertPendingLeave(leaveId, date)

  const approvalClient = createClient()
  const writerClient = createClient()
  const startTogether = createOneShotGate(2)
  const adminSession: Session = {
    user: {
      id: 'admin-user',
      name: 'Admin',
      email: 'admin@test.pl',
      role: 'ADMIN',
      employeeId: null,
    },
    expires: '',
  }

  await Promise.all([
    approvalClient.$queryRawUnsafe('PRAGMA busy_timeout = 1000'),
    writerClient.$queryRawUnsafe('PRAGMA busy_timeout = 1000'),
  ])

  const approveLeave = createLeaveApprovalHandler({
    prisma: approvalClient,
    getSession: async () => {
      await startTogether()
      return adminSession
    },
  })
  const writeTime = createWriter(writerClient, async () => {
    await startTogether()
    return writerSession
  })

  try {
    const [approvalResponse, writerResponse] = await Promise.all([
      approveLeave(
        new NextRequest(
          `http://localhost/api/hr/leave-requests/${leaveId}/approve`,
          { method: 'PATCH' }
        ),
        { params: Promise.resolve({ id: leaveId }) }
      ),
      writeTime(writerRequest),
    ])
    const [leave, timeEntries] = await Promise.all([
      prisma.leaveRequestNew.findUniqueOrThrow({
        where: { id: leaveId },
        select: { status: true },
      }),
      prisma.timeEntry.findMany({
        where: { employeeId: 'employee-1' },
        select: { date: true },
      }),
    ])
    const logicalDayEntries = timeEntries.filter(
      (entry) => getWarsawBusinessDate(entry.date).isoDate === date
    )

    expect([200, 409]).toContain(approvalResponse.status)
    expect([200, 201, 409]).toContain(writerResponse.status)
    expect([
      { leaveStatus: 'approved', entryCount: 0 },
      { leaveStatus: 'pending', entryCount: 1 },
    ]).toContainEqual({
      leaveStatus: leave.status,
      entryCount: logicalDayEntries.length,
    })
    expect(
      leave.status === 'approved' && logicalDayEntries.length > 0
    ).toBe(false)
  } finally {
    await Promise.all([
      approvalClient.$disconnect(),
      writerClient.$disconnect(),
    ])
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
      "firstName" TEXT NOT NULL,
      "lastName" TEXT NOT NULL,
      "userId" TEXT,
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
    CREATE TABLE "LeaveType" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "color" TEXT NOT NULL DEFAULT '#3B82F6',
      "tracksBalance" BOOLEAN NOT NULL DEFAULT true,
      "parentId" TEXT
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "LeaveRequestNew" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "employeeId" TEXT NOT NULL,
      "leaveTypeId" TEXT NOT NULL,
      "startDate" DATETIME NOT NULL,
      "endDate" DATETIME NOT NULL,
      "days" REAL NOT NULL,
      "hours" REAL,
      "isOnDemand" BOOLEAN NOT NULL DEFAULT false,
      "isRemoteWork" BOOLEAN NOT NULL DEFAULT false,
      "isDelegation" BOOLEAN NOT NULL DEFAULT false,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "approverId" TEXT,
      "approvedAt" DATETIME,
      "rejectionNote" TEXT,
      "substituteId" TEXT,
      "notifySubstitute" BOOLEAN NOT NULL DEFAULT false,
      "note" TEXT,
      "attachments" TEXT,
      "gcalEventId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Break" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "timeEntryId" TEXT NOT NULL,
      "startTime" DATETIME NOT NULL,
      "endTime" DATETIME,
      "type" TEXT NOT NULL DEFAULT 'break'
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "CustomHoliday" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "date" DATETIME NOT NULL,
      "divisionId" TEXT,
      "isRecurring" BOOLEAN NOT NULL DEFAULT false,
      "country" TEXT NOT NULL DEFAULT 'PL'
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Notification" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "link" TEXT,
      "isRead" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'walldecor-time-batch-'))
  databaseUrl = `file:${join(tempDir, 'time-batch.db')}`
  prisma = createClient()
  await createSchema()

  vi.doMock('@/lib/prisma', () => ({ prisma }))
  ;({
    POST: postBatch,
    createTimeEntryBatchHandler,
  } = await import('@/app/api/hr/time-tracking/batch/route'))
  ;({
    createLeaveApprovalHandler,
  } = await import('@/app/api/hr/leave-requests/[id]/approve/route'))
  ;({
    createTimeEntryFillHandler,
  } = await import('@/app/api/hr/time-tracking/monthly/fill/route'))
  ;({
    createManualTimeEntryHandler,
  } = await import('@/app/api/hr/time-tracking/route'))
  ;({
    createClockInHandler,
  } = await import('@/app/api/hr/time-tracking/clock-in/route'))
  ;({
    createBulkTimeEntryHandler,
  } = await import('@/app/api/hr/time-tracking/bulk/route'))
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
  await prisma.customHoliday.deleteMany()
  await prisma.$executeRawUnsafe('DELETE FROM "LeaveType"')
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
    INSERT INTO "Employee" (
      "id",
      "firstName",
      "lastName",
      "userId",
      "divisionId",
      "active"
    )
    VALUES ('employee-1', 'Jan', 'Kowalski', NULL, 'JAG', true)
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
  await prisma.$executeRawUnsafe(`
    INSERT INTO "LeaveType" (
      "id",
      "name",
      "code",
      "color",
      "tracksBalance",
      "parentId"
    )
    VALUES ('leave-type-ub', 'Urlop bezpłatny', 'UB', '#64748B', false, NULL)
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

  it('rolls back the whole working-day fill when a later insert fails', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "fail_second_time_entry"
      BEFORE INSERT ON "TimeEntry"
      WHEN NEW."totalMinutes" = 540
      BEGIN
        SELECT RAISE(ABORT, 'forced second time-entry failure');
      END
    `)
    const fillWorkedTime = createTimeEntryFillHandler({
      prisma,
      getSession: async () => ({
        user: {
          id: 'admin-user',
          name: 'Admin',
          email: 'admin@test.pl',
          role: 'ADMIN',
          employeeId: null,
        },
        expires: '',
      }),
      getHrSettings: async () => ({
        saturdayWorkable: true,
        standardClockIn: '08:00',
        standardClockOut: '16:00',
        overtimeThresholdMinutes: 480,
      }),
    })

    await expect(fillWorkedTime(fillRequest([
      row('2026-07-02'),
      row('2026-07-03', {
        clockOut: '2026-07-03T17:00:00.000Z',
      }),
    ]))).rejects.toThrow()

    expect(await prisma.timeEntry.count()).toBe(0)
  })

  it.each([
    {
      name: 'manual writer',
      leaveId: 'leave-manual-concurrent',
      date: '2026-07-08',
      writerSession: {
        user: {
          id: 'admin-user',
          name: 'Admin',
          email: 'admin@test.pl',
          role: 'ADMIN',
          employeeId: null,
        },
        expires: '',
      } satisfies Session,
      prepare: async () => undefined,
      createWriter: (
        db: PrismaClient,
        getSession: () => Promise<Session | null>
      ) => createManualTimeEntryHandler({ prisma: db, getSession }),
      writerRequest: new NextRequest('http://localhost/api/hr/time-tracking', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: 'employee-1',
          date: '2026-07-08',
          clockIn: '2026-07-08T06:00:00.000Z',
          clockOut: '2026-07-08T14:00:00.000Z',
        }),
      }),
    },
    {
      name: 'clock-in writer',
      leaveId: 'leave-clock-concurrent',
      date: '2026-07-09',
      writerSession: {
        user: {
          id: 'employee-user',
          name: 'Employee',
          email: 'employee@test.pl',
          role: 'EMPLOYEE',
          employeeId: 'employee-1',
        },
        expires: '',
      } satisfies Session,
      prepare: async () => {
        await prisma.$executeRawUnsafe(
          'UPDATE "Employee" SET "userId" = ? WHERE "id" = ?',
          'employee-user',
          'employee-1'
        )
      },
      createWriter: (
        db: PrismaClient,
        getSession: () => Promise<Session | null>
      ) => createClockInHandler({
        prisma: db,
        getSession,
        now: () => new Date('2026-07-09T06:00:00.000Z'),
      }),
      writerRequest: new NextRequest('http://localhost/api/hr/time-tracking/clock-in', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    },
    {
      name: 'legacy bulk writer',
      leaveId: 'leave-bulk-concurrent',
      date: '2026-07-10',
      writerSession: {
        user: {
          id: 'admin-user',
          name: 'Admin',
          email: 'admin@test.pl',
          role: 'ADMIN',
          employeeId: null,
        },
        expires: '',
      } satisfies Session,
      prepare: async () => undefined,
      createWriter: (
        db: PrismaClient,
        getSession: () => Promise<Session | null>
      ) => createBulkTimeEntryHandler({ prisma: db, getSession }),
      writerRequest: new NextRequest('http://localhost/api/hr/time-tracking/bulk', {
        method: 'POST',
        body: JSON.stringify({
          employeeIds: ['employee-1'],
          startDate: '2026-07-10',
          endDate: '2026-07-10',
          clockInUtc: '2026-07-10T06:00:00.000Z',
          clockOutUtc: '2026-07-10T14:00:00.000Z',
          skipWeekends: false,
        }),
      }),
    },
  ])('runs actual approve and $name concurrently without committing both states', async ({
    leaveId,
    date,
    writerSession,
    prepare,
    createWriter,
    writerRequest,
  }) => {
    await prepare()
    await assertWriterApprovalRace({
      leaveId,
      date,
      writerSession,
      createWriter,
      writerRequest,
    })
  })

  it('runs actual approve and batch handlers concurrently without committing both states', async () => {
    const date = new Date('2026-07-06T00:00:00.000Z')
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "LeaveRequestNew" (
          "id",
          "employeeId",
          "leaveTypeId",
          "startDate",
          "endDate",
          "days",
          "status",
          "isRemoteWork",
          "isDelegation",
          "createdAt",
          "updatedAt"
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      'leave-concurrent',
      'employee-1',
      'leave-type-ub',
      date,
      date,
      1,
      'pending',
      false,
      false,
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z')
    )

    const approvalClient = createClient()
    const timeEntryClient = createClient()
    const startTogether = createOneShotGate(2)
    const session = {
      user: {
        id: 'admin-user',
        name: 'Admin',
        email: 'admin@test.pl',
        role: 'ADMIN' as const,
        employeeId: null,
      },
      expires: '',
    }
    const getSession = async () => {
      await startTogether()
      return session
    }

    await Promise.all([
      approvalClient.$queryRawUnsafe('PRAGMA busy_timeout = 1000'),
      timeEntryClient.$queryRawUnsafe('PRAGMA busy_timeout = 1000'),
    ])

    const approveLeave = createLeaveApprovalHandler({
      prisma: approvalClient,
      getSession,
    })
    const createWorkedTime = createTimeEntryBatchHandler({
      prisma: timeEntryClient,
      getSession,
      getHrSettings: async () => ({
        saturdayWorkable: true,
        standardClockIn: '08:00',
        standardClockOut: '16:00',
        overtimeThresholdMinutes: 480,
      }),
    })

    try {
      const [approvalResponse, batchResponse] = await Promise.all([
        approveLeave(
          new NextRequest(
            'http://localhost/api/hr/leave-requests/leave-concurrent/approve',
            { method: 'PATCH' }
          ),
          { params: Promise.resolve({ id: 'leave-concurrent' }) }
        ),
        createWorkedTime(request([row('2026-07-06')])),
      ])
      const [leave, timeEntries] = await Promise.all([
        prisma.leaveRequestNew.findUniqueOrThrow({
          where: { id: 'leave-concurrent' },
          select: { status: true },
        }),
        prisma.timeEntry.findMany({
          where: { employeeId: 'employee-1' },
          select: { date: true },
        }),
      ])
      const logicalDayEntries = timeEntries.filter(
        (entry) => getWarsawBusinessDate(entry.date).isoDate === '2026-07-06'
      )

      expect(batchResponse.status).toBe(200)
      expect([200, 409]).toContain(approvalResponse.status)
      expect([
        { leaveStatus: 'approved', entryCount: 0 },
        { leaveStatus: 'pending', entryCount: 1 },
      ]).toContainEqual({
        leaveStatus: leave.status,
        entryCount: logicalDayEntries.length,
      })
      expect(
        leave.status === 'approved' && logicalDayEntries.length > 0
      ).toBe(false)
    } finally {
      await Promise.all([
        approvalClient.$disconnect(),
        timeEntryClient.$disconnect(),
      ])
    }
  })

  it('runs actual approve and fill handlers concurrently without committing both states', async () => {
    const date = new Date('2026-07-07T00:00:00.000Z')
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO "LeaveRequestNew" (
          "id",
          "employeeId",
          "leaveTypeId",
          "startDate",
          "endDate",
          "days",
          "status",
          "isRemoteWork",
          "isDelegation",
          "createdAt",
          "updatedAt"
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      'leave-fill-concurrent',
      'employee-1',
      'leave-type-ub',
      date,
      date,
      1,
      'pending',
      false,
      false,
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z')
    )

    const approvalClient = createClient()
    const fillClient = createClient()
    const startTogether = createOneShotGate(2)
    const session = {
      user: {
        id: 'admin-user',
        name: 'Admin',
        email: 'admin@test.pl',
        role: 'ADMIN' as const,
        employeeId: null,
      },
      expires: '',
    }
    const getSession = async () => {
      await startTogether()
      return session
    }

    await Promise.all([
      approvalClient.$queryRawUnsafe('PRAGMA busy_timeout = 1000'),
      fillClient.$queryRawUnsafe('PRAGMA busy_timeout = 1000'),
    ])

    const approveLeave = createLeaveApprovalHandler({
      prisma: approvalClient,
      getSession,
    })
    const fillWorkedTime = createTimeEntryFillHandler({
      prisma: fillClient,
      getSession,
      getHrSettings: async () => ({
        saturdayWorkable: true,
        standardClockIn: '08:00',
        standardClockOut: '16:00',
        overtimeThresholdMinutes: 480,
      }),
    })

    try {
      const [approvalResponse, fillResponse] = await Promise.all([
        approveLeave(
          new NextRequest(
            'http://localhost/api/hr/leave-requests/leave-fill-concurrent/approve',
            { method: 'PATCH' }
          ),
          { params: Promise.resolve({ id: 'leave-fill-concurrent' }) }
        ),
        fillWorkedTime(fillRequest([row('2026-07-07')])),
      ])
      const [leave, timeEntries] = await Promise.all([
        prisma.leaveRequestNew.findUniqueOrThrow({
          where: { id: 'leave-fill-concurrent' },
          select: { status: true },
        }),
        prisma.timeEntry.findMany({
          where: { employeeId: 'employee-1' },
          select: { date: true },
        }),
      ])
      const logicalDayEntries = timeEntries.filter(
        (entry) => getWarsawBusinessDate(entry.date).isoDate === '2026-07-07'
      )

      expect([200, 409]).toContain(approvalResponse.status)
      expect([200, 409]).toContain(fillResponse.status)
      expect([
        { leaveStatus: 'approved', entryCount: 0 },
        { leaveStatus: 'pending', entryCount: 1 },
      ]).toContainEqual({
        leaveStatus: leave.status,
        entryCount: logicalDayEntries.length,
      })
      expect(
        leave.status === 'approved' && logicalDayEntries.length > 0
      ).toBe(false)
    } finally {
      await Promise.all([
        approvalClient.$disconnect(),
        fillClient.$disconnect(),
      ])
    }
  })
})
