import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canViewEmployeeRecord } from '@/lib/hr/access'
import {
  getWarsawBusinessDate,
  getWarsawBusinessDateQueryRange,
  toWarsawBusinessDateUtcMidnight,
} from '@/lib/hr/business-date'
import { timeEntryBatchMutationSchema } from '@/lib/hr/schemas'
import { validateTimeMutationRow } from '@/lib/hr/time-tracking/batch-policy'

const DUPLICATE_DATE_ERROR = 'Data występuje w żądaniu więcej niż raz'
const ENTRY_OWNERSHIP_ERROR = 'Wpis nie istnieje lub nie należy do wybranego pracownika'
const ENTRY_DATE_ERROR = 'Wskazany wpis należy do innej daty'
const ENTRY_EXISTS_ERROR = 'Wpis dla tego pracownika i dnia już istnieje'
const APPROVED_LEAVE_ERROR = 'Zatwierdzony urlop blokuje utworzenie wpisu dla tego dnia'

type BatchRow = {
  entryId?: string
  date: string
  clockIn: string
  clockOut: string
  breakMinutes: number
}

type ValidRow = {
  index: number
  row: BatchRow
  clockIn: Date
  clockOut: Date
  canonicalDate: Date
  totalMinutes: number
  breakMinutes: number
}

type SavedRow = {
  index: number
  date: string
  entryId: string
}

class TimeEntryUniqueConflictError extends Error {
  constructor(readonly rowIndex: number) {
    super('Time entry employee/date uniqueness conflict')
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'P2002'
  )
}

function getCounts(values: Array<string | undefined>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function getRequestedDateRange(dates: string[]): { gte: Date; lte: Date } {
  const sortedDates = [...dates].sort()
  const firstDate = new Date(`${sortedDates[0]}T00:00:00.000Z`)
  const lastDate = new Date(`${sortedDates.at(-1)}T00:00:00.000Z`)

  return {
    gte: getWarsawBusinessDateQueryRange(firstDate).gte,
    lte: getWarsawBusinessDateQueryRange(lastDate).lte,
  }
}

function leaveOverlapsDate(
  leave: { startDate: Date; endDate: Date },
  date: string
): boolean {
  const startDate = getWarsawBusinessDate(leave.startDate).isoDate
  const endDate = getWarsawBusinessDate(leave.endDate).isoDate
  return startDate <= date && date <= endDate
}

async function saveValidRows(
  employeeId: string,
  rows: ValidRow[],
  failedByIndex: Map<number, string>
): Promise<SavedRow[]> {
  let pendingRows = rows

  while (pendingRows.length > 0) {
    try {
      return await prisma.$transaction(async (tx) => {
        const saved: SavedRow[] = []

        for (const candidate of pendingRows) {
          const data = {
            date: candidate.canonicalDate,
            clockIn: candidate.clockIn,
            clockOut: candidate.clockOut,
            totalMinutes: candidate.totalMinutes,
            breakMinutes: candidate.breakMinutes,
            source: 'bulk',
          }

          try {
            const entry = candidate.row.entryId
              ? await tx.timeEntry.update({
                  where: { id: candidate.row.entryId },
                  data,
                  select: { id: true },
                })
              : await tx.timeEntry.create({
                  data: {
                    employeeId,
                    ...data,
                    status: 'pending',
                  },
                  select: { id: true },
                })

            saved.push({
              index: candidate.index,
              date: candidate.row.date,
              entryId: entry.id,
            })
          } catch (error) {
            if (isUniqueConstraintError(error)) {
              throw new TimeEntryUniqueConflictError(candidate.index)
            }
            throw error
          }
        }

        return saved
      })
    } catch (error) {
      if (!(error instanceof TimeEntryUniqueConflictError)) throw error

      failedByIndex.set(error.rowIndex, ENTRY_EXISTS_ERROR)
      pendingRows = pendingRows.filter((candidate) => candidate.index !== error.rowIndex)
    }
  }

  return []
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const parsed = timeEntryBatchMutationSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { employeeId, rows } = parsed.data
  const targetEmployee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, divisionId: true, active: true },
  })
  if (!targetEmployee) {
    return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }

  const viewerEmployee =
    session.user.role === 'MANAGER' && session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null

  if (!canViewEmployeeRecord(session, targetEmployee, viewerEmployee)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const dateCounts = getCounts(rows.map((row) => row.date))
  const requestedDateRange = getRequestedDateRange(rows.map((row) => row.date))
  const referencedEntryIds = rows
    .map((row) => row.entryId)
    .filter((entryId): entryId is string => entryId !== undefined)

  const [existingEntries, approvedLeaves] = await Promise.all([
    prisma.timeEntry.findMany({
      where: {
        OR: [
          ...(referencedEntryIds.length > 0
            ? [{ id: { in: referencedEntryIds } }]
            : []),
          {
            employeeId,
            date: requestedDateRange,
          },
        ],
      },
      select: {
        id: true,
        employeeId: true,
        date: true,
      },
    }),
    prisma.leaveRequestNew.findMany({
      where: {
        employeeId,
        status: 'approved',
        startDate: { lte: requestedDateRange.lte },
        endDate: { gte: requestedDateRange.gte },
      },
      select: {
        startDate: true,
        endDate: true,
      },
    }),
  ])

  const entriesById = new Map(existingEntries.map((entry) => [entry.id, entry]))
  const entriesByDate = new Map<string, typeof existingEntries>()
  for (const entry of existingEntries) {
    if (entry.employeeId !== employeeId) continue
    const date = getWarsawBusinessDate(entry.date).isoDate
    const entries = entriesByDate.get(date) ?? []
    entries.push(entry)
    entriesByDate.set(date, entries)
  }

  const failedByIndex = new Map<number, string>()
  const validRows: ValidRow[] = []

  rows.forEach((row, index) => {
    if ((dateCounts.get(row.date) ?? 0) > 1) {
      failedByIndex.set(index, DUPLICATE_DATE_ERROR)
      return
    }
    const validation = validateTimeMutationRow(row)
    if (!validation.valid) {
      failedByIndex.set(index, validation.error)
      return
    }

    const existingForDate = entriesByDate.get(row.date) ?? []
    if (row.entryId) {
      const referencedEntry = entriesById.get(row.entryId)
      if (!referencedEntry || referencedEntry.employeeId !== employeeId) {
        failedByIndex.set(index, ENTRY_OWNERSHIP_ERROR)
        return
      }
      if (getWarsawBusinessDate(referencedEntry.date).isoDate !== row.date) {
        failedByIndex.set(index, ENTRY_DATE_ERROR)
        return
      }
      if (existingForDate.some((entry) => entry.id !== row.entryId)) {
        failedByIndex.set(index, ENTRY_EXISTS_ERROR)
        return
      }
    } else {
      if (existingForDate.length > 0) {
        failedByIndex.set(index, ENTRY_EXISTS_ERROR)
        return
      }
      if (approvedLeaves.some((leave) => leaveOverlapsDate(leave, row.date))) {
        failedByIndex.set(index, APPROVED_LEAVE_ERROR)
        return
      }
    }

    const clockIn = new Date(row.clockIn)
    validRows.push({
      index,
      row,
      clockIn,
      clockOut: new Date(row.clockOut),
      canonicalDate: toWarsawBusinessDateUtcMidnight(clockIn),
      totalMinutes: validation.totalMinutes,
      breakMinutes: validation.breakMinutes,
    })
  })

  const savedRows = await saveValidRows(employeeId, validRows, failedByIndex)
  const saved = savedRows
    .sort((left, right) => left.index - right.index)
    .map(({ date, entryId }) => ({ date, entryId }))
  const failed = rows.flatMap((row, index) => {
    const error = failedByIndex.get(index)
    return error ? [{ date: row.date, error }] : []
  })

  return NextResponse.json({ saved, failed })
}
