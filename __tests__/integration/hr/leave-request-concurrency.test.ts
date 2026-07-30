import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@/generated/prisma'
import { runSerializableTransactionWithRetry } from '@/lib/hr/serializable-transaction'

const EMPLOYEE_ID = 'employee-concurrency'
const VL_TYPE_ID = 'leave-type-vl'
const VLD_TYPE_ID = 'leave-type-vld'
const BALANCE_ID = 'balance-vl-2026'
const YEAR = 2026

class OverlappingLeaveError extends Error {}
class LifecycleConflictError extends Error {}

let tempDir = ''
let databaseUrl = ''
let prisma: PrismaClient

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

async function reserveLeave(
  client: PrismaClient,
  requestId: string,
  afterOverlapRead: () => Promise<void>
) {
  const startDate = new Date('2026-07-27T00:00:00.000Z')
  const endDate = new Date('2026-07-27T00:00:00.000Z')

  return runSerializableTransactionWithRetry(
    () =>
      client.$transaction(
        async (tx) => {
          const overlap = await tx.leaveRequestNew.findFirst({
            where: {
              employeeId: EMPLOYEE_ID,
              status: { notIn: ['cancelled', 'rejected'] },
              startDate: { lte: endDate },
              endDate: { gte: startDate },
            },
            select: { id: true },
          })

          await afterOverlapRead()
          if (overlap) throw new OverlappingLeaveError()

          const balance = await tx.leaveBalanceNew.findUnique({
            where: {
              employeeId_leaveTypeId_year: {
                employeeId: EMPLOYEE_ID,
                leaveTypeId: VL_TYPE_ID,
                year: YEAR,
              },
            },
          })
          if (!balance) throw new Error('Missing leave balance')
          if (
            balance.totalDays - balance.usedDays - balance.pendingDays <
            1
          ) {
            throw new Error('Insufficient leave balance')
          }

          await tx.leaveRequestNew.create({
            data: {
              id: requestId,
              employeeId: EMPLOYEE_ID,
              leaveTypeId: VLD_TYPE_ID,
              startDate,
              endDate,
              days: 1,
              isOnDemand: true,
              status: 'pending',
            },
          })
          await tx.leaveBalanceNew.update({
            where: { id: BALANCE_ID },
            data: { pendingDays: { increment: 1 } },
          })
        },
        {
          isolationLevel: 'Serializable',
          maxWait: 1_000,
          timeout: 1_000,
        }
      ),
    { initialDelayMs: 0 }
  )
}

async function approveLeave(
  client: PrismaClient,
  requestId: string,
  beforeTransition: () => Promise<void>
) {
  return runSerializableTransactionWithRetry(
    () =>
      client.$transaction(
        async (tx) => {
          await beforeTransition()

          const transition = await tx.leaveRequestNew.updateMany({
            where: { id: requestId, status: 'pending' },
            data: {
              status: 'approved',
              approvedAt: new Date('2026-07-20T12:00:00.000Z'),
            },
          })
          if (transition.count !== 1) throw new LifecycleConflictError()

          const balance = await tx.leaveBalanceNew.findUniqueOrThrow({
            where: { id: BALANCE_ID },
          })
          if (balance.pendingDays < 1) {
            throw new Error('Pending leave balance underflow')
          }

          await tx.leaveBalanceNew.update({
            where: { id: BALANCE_ID },
            data: {
              pendingDays: { decrement: 1 },
              usedDays: { increment: 1 },
            },
          })
        },
        {
          isolationLevel: 'Serializable',
          maxWait: 1_000,
          timeout: 1_000,
        }
      ),
    { initialDelayMs: 0 }
  )
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'walldecor-leave-concurrency-'))
  databaseUrl = `file:${join(tempDir, 'concurrency.db')}`
  prisma = createClient()

  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 100')
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
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "LeaveRequestNew_employeeId_fkey"
        FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
      CONSTRAINT "LeaveRequestNew_leaveTypeId_fkey"
        FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(
    'INSERT INTO "Employee" ("id") VALUES (?)',
    EMPLOYEE_ID
  )
  await prisma.$executeRawUnsafe(
    'INSERT INTO "LeaveType" ("id") VALUES (?), (?)',
    VL_TYPE_ID,
    VLD_TYPE_ID
  )
  await prisma.leaveBalanceNew.create({
    data: {
      id: BALANCE_ID,
      employeeId: EMPLOYEE_ID,
      leaveTypeId: VL_TYPE_ID,
      year: YEAR,
      totalDays: 20,
    },
  })
})

afterEach(async () => {
  await prisma.leaveRequestNew.deleteMany()
  await prisma.leaveBalanceNew.update({
    where: { id: BALANCE_ID },
    data: { totalDays: 20, usedDays: 0, pendingDays: 0 },
  })
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
})

describe('leave request Serializable concurrency', () => {
  it('stores one of two overlapping reservations and increments pending once', async () => {
    const firstClient = createClient()
    const secondClient = createClient()
    const afterOverlapRead = createOneShotGate(2)

    try {
      const results = await Promise.allSettled([
        reserveLeave(firstClient, 'request-concurrent-a', afterOverlapRead),
        reserveLeave(secondClient, 'request-concurrent-b', afterOverlapRead),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((result) => result.status === 'rejected')
      expect(rejected).toMatchObject({
        reason: expect.any(OverlappingLeaveError),
      })

      const [requests, balance] = await Promise.all([
        prisma.leaveRequestNew.findMany(),
        prisma.leaveBalanceNew.findUniqueOrThrow({
          where: { id: BALANCE_ID },
        }),
      ])

      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        leaveTypeId: VLD_TYPE_ID,
        days: 1,
        isOnDemand: true,
        status: 'pending',
      })
      expect(balance.pendingDays).toBe(1)
      expect(balance.usedDays).toBe(0)
    } finally {
      await Promise.all([
        firstClient.$disconnect(),
        secondClient.$disconnect(),
      ])
    }
  })

  it('allows one concurrent lifecycle transition and mutates balance once', async () => {
    await prisma.leaveRequestNew.create({
      data: {
        id: 'request-lifecycle',
        employeeId: EMPLOYEE_ID,
        leaveTypeId: VLD_TYPE_ID,
        startDate: new Date('2026-07-27T00:00:00.000Z'),
        endDate: new Date('2026-07-27T00:00:00.000Z'),
        days: 1,
        isOnDemand: true,
        status: 'pending',
      },
    })
    await prisma.leaveBalanceNew.update({
      where: { id: BALANCE_ID },
      data: { pendingDays: 1 },
    })

    const firstClient = createClient()
    const secondClient = createClient()
    const beforeTransition = createOneShotGate(2)

    try {
      const results = await Promise.allSettled([
        approveLeave(firstClient, 'request-lifecycle', beforeTransition),
        approveLeave(secondClient, 'request-lifecycle', beforeTransition),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((result) => result.status === 'rejected')
      expect(rejected).toMatchObject({
        reason: expect.any(LifecycleConflictError),
      })

      const [request, balance] = await Promise.all([
        prisma.leaveRequestNew.findUniqueOrThrow({
          where: { id: 'request-lifecycle' },
        }),
        prisma.leaveBalanceNew.findUniqueOrThrow({
          where: { id: BALANCE_ID },
        }),
      ])

      expect(request.status).toBe('approved')
      expect(balance.pendingDays).toBe(0)
      expect(balance.usedDays).toBe(1)
    } finally {
      await Promise.all([
        firstClient.$disconnect(),
        secondClient.$disconnect(),
      ])
    }
  })
})
