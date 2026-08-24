import type { Prisma, PrismaClient } from '@/generated/prisma'
import {
  getWarsawBusinessDate,
  getWarsawBusinessDateQueryRange,
  toWarsawBusinessDateUtcMidnight,
} from '@/lib/hr/business-date'
import {
  runSerializableTransactionWithRetry,
  SerializableTransactionConflictError,
} from '@/lib/hr/serializable-transaction'

export class TimeEntryAlreadyExistsError extends Error {}
export class ApprovedLeaveBlocksTimeEntryError extends Error {}
export class OpenTimeEntryExistsError extends Error {}

export class TimeEntryConcurrentWriteError extends Error {
  constructor(readonly cause: unknown) {
    super('Time entry could not be saved because of a concurrent change')
  }
}

interface CreateTimeEntryInput {
  employeeId: string
  date: Date
  data: Omit<Prisma.TimeEntryUncheckedCreateInput, 'employeeId' | 'date'>
  rejectWhenAnyEntryIsOpen?: boolean
}

function leaveOverlapsLogicalDay(
  leave: {
    startDate: Date
    endDate: Date
    isRemoteWork: boolean
    isDelegation: boolean
  },
  logicalDate: string
): boolean {
  if (leave.isRemoteWork || leave.isDelegation) return false

  const startDate = getWarsawBusinessDate(leave.startDate).isoDate
  const endDate = getWarsawBusinessDate(leave.endDate).isoDate
  return startDate <= logicalDate && logicalDate <= endDate
}

function isTimeEntryDateUniqueConstraintError(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    error.code !== 'P2002' ||
    !('meta' in error) ||
    typeof error.meta !== 'object' ||
    error.meta === null
  ) {
    return false
  }

  const meta = error.meta
  return (
    'modelName' in meta &&
    meta.modelName === 'TimeEntry' &&
    'target' in meta &&
    Array.isArray(meta.target) &&
    meta.target.length === 2 &&
    meta.target[0] === 'employeeId' &&
    meta.target[1] === 'date'
  )
}

export async function createTimeEntryRespectingApprovedLeave(
  db: PrismaClient,
  {
    employeeId,
    date,
    data,
    rejectWhenAnyEntryIsOpen = false,
  }: CreateTimeEntryInput
) {
  const businessDate = getWarsawBusinessDate(date)
  const businessDateRange = getWarsawBusinessDateQueryRange(date)
  const canonicalDate = toWarsawBusinessDateUtcMidnight(date)

  try {
    return await runSerializableTransactionWithRetry(() =>
      db.$transaction(async (tx) => {
        if (rejectWhenAnyEntryIsOpen) {
          const openEntry = await tx.timeEntry.findFirst({
            where: { employeeId, clockOut: null },
            select: { id: true },
          })
          if (openEntry) throw new OpenTimeEntryExistsError()
        }

        const [existingCandidates, approvedLeaves] = await Promise.all([
          tx.timeEntry.findMany({
            where: {
              employeeId,
              date: businessDateRange,
            },
            select: { id: true, date: true },
          }),
          tx.leaveRequestNew.findMany({
            where: {
              employeeId,
              status: 'approved',
              isRemoteWork: false,
              isDelegation: false,
              startDate: { lte: businessDateRange.lte },
              endDate: { gte: businessDateRange.gte },
            },
            select: {
              startDate: true,
              endDate: true,
              isRemoteWork: true,
              isDelegation: true,
            },
          }),
        ])

        if (
          existingCandidates.some(
            (entry) =>
              getWarsawBusinessDate(entry.date).isoDate === businessDate.isoDate
          )
        ) {
          throw new TimeEntryAlreadyExistsError()
        }

        if (
          approvedLeaves.some((leave) =>
            leaveOverlapsLogicalDay(leave, businessDate.isoDate)
          )
        ) {
          throw new ApprovedLeaveBlocksTimeEntryError()
        }

        try {
          return await tx.timeEntry.create({
            data: {
              employeeId,
              date: canonicalDate,
              ...data,
            },
            include: { breaks: true },
          })
        } catch (error) {
          if (isTimeEntryDateUniqueConstraintError(error)) {
            throw new TimeEntryAlreadyExistsError()
          }
          throw error
        }
      }, { isolationLevel: 'Serializable' })
    )
  } catch (error) {
    if (error instanceof SerializableTransactionConflictError) {
      throw new TimeEntryConcurrentWriteError(error)
    }
    throw error
  }
}
