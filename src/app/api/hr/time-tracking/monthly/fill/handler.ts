import { NextRequest, NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import type { Prisma, PrismaClient } from '@/generated/prisma'
import { canViewEmployeeRecord } from '@/lib/hr/access'
import {
  getWarsawBusinessDate,
  getWarsawBusinessDateQueryRange,
  toWarsawBusinessDateUtcMidnight,
} from '@/lib/hr/business-date'
import { getHrSettings } from '@/lib/hr/hr-settings'
import { timeEntryFillSchema } from '@/lib/hr/schemas'
import {
  calculateBatchOvertimeMinutes,
  evaluateFillDay,
  type FillDayEvaluation,
  type FillSkipReason,
  validateTimeMutationRow,
} from '@/lib/hr/time-tracking/batch-policy'
import { dateKeyToLocalNoon } from '@/lib/hr/time-tracking/month'
import {
  runSerializableTransactionWithRetry,
  SerializableTransactionConflictError,
} from '@/lib/hr/serializable-transaction'
import { isPublicHoliday } from '@/lib/hr/utils'

const DUPLICATE_DATES_ERROR = 'Duplicate dates are not allowed'
const WRITE_CONFLICT_ERROR =
  'Dane zmieniły się podczas zapisu. Odśwież podgląd i spróbuj ponownie.'

type FillRow = {
  date: string
  clockIn: string
  clockOut: string
  breakMinutes: number
}

type FillReadClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  'timeEntry' | 'leaveRequestNew' | 'customHoliday'
>

type ExistingEntry = {
  id: string
  employeeId: string
  date: Date
}

type ApprovedLeave = {
  startDate: Date
  endDate: Date
  isRemoteWork: boolean
  isDelegation: boolean
}

type FillState = {
  entriesByDate: Map<string, ExistingEntry[]>
  approvedLeaves: ApprovedLeave[]
  holidayDates: Set<string>
}

type EvaluatedRow = {
  input: FillRow
  action: FillDayEvaluation['action']
  reason?: FillSkipReason
  existingEntryId?: string
  clockIn?: Date
  clockOut?: Date
  canonicalDate?: Date
  totalMinutes?: number
  breakMinutes?: number
  overtimeMinutes?: number
}

type FillCounts = {
  eligible: number
  existing: number
  weekends: number
  holidays: number
  approvedLeave: number
  invalid: number
}

export interface TimeEntryFillHandlerDependencies {
  prisma: PrismaClient
  getSession: () => Promise<Session | null>
  getHrSettings: typeof getHrSettings
}

class FillWriteConflictError extends Error {}

function isExactTimeEntryDateUniqueError(error: unknown): boolean {
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
  if (!('modelName' in meta) || meta.modelName !== 'TimeEntry') return false
  if (!('target' in meta) || !Array.isArray(meta.target)) return false
  return (
    meta.target.length === 2 &&
    meta.target[0] === 'employeeId' &&
    meta.target[1] === 'date'
  )
}

function requestedDateRange(dates: string[]): { gte: Date; lte: Date } {
  const sortedDates = [...dates].sort()
  const first = new Date(`${sortedDates[0]}T00:00:00.000Z`)
  const last = new Date(`${sortedDates.at(-1)}T00:00:00.000Z`)
  return {
    gte: getWarsawBusinessDateQueryRange(first).gte,
    lte: getWarsawBusinessDateQueryRange(last).lte,
  }
}

function leaveOverlapsDate(leave: ApprovedLeave, date: string): boolean {
  if (leave.isRemoteWork || leave.isDelegation) return false
  const start = getWarsawBusinessDate(leave.startDate).isoDate
  const end = getWarsawBusinessDate(leave.endDate).isoDate
  return start <= date && date <= end
}

async function loadFillState(
  db: FillReadClient,
  employeeId: string,
  divisionId: string | null,
  dates: string[]
): Promise<FillState> {
  const range = requestedDateRange(dates)
  const [entries, approvedLeaves, holidays] = await Promise.all([
    db.timeEntry.findMany({
      where: { employeeId, date: range },
      select: { id: true, employeeId: true, date: true },
    }),
    db.leaveRequestNew.findMany({
      where: {
        employeeId,
        status: 'approved',
        isRemoteWork: false,
        isDelegation: false,
        startDate: { lte: range.lte },
        endDate: { gte: range.gte },
      },
      select: {
        startDate: true,
        endDate: true,
        isRemoteWork: true,
        isDelegation: true,
      },
    }),
    db.customHoliday.findMany({
      where: {
        date: range,
        OR: [
          { divisionId: null },
          ...(divisionId ? [{ divisionId }] : []),
        ],
      },
      select: { date: true, divisionId: true },
    }),
  ])

  const entriesByDate = new Map<string, ExistingEntry[]>()
  for (const entry of entries) {
    const date = getWarsawBusinessDate(entry.date).isoDate
    const dayEntries = entriesByDate.get(date) ?? []
    dayEntries.push(entry)
    entriesByDate.set(date, dayEntries)
  }

  return {
    entriesByDate,
    approvedLeaves,
    holidayDates: new Set(
      holidays
        .filter((holiday) => (
          holiday.divisionId === null || holiday.divisionId === divisionId
        ))
        .map((holiday) => getWarsawBusinessDate(holiday.date).isoDate)
    ),
  }
}

function evaluateRows(input: {
  rows: FillRow[]
  state: FillState
  saturdayWorkable: boolean
  overwrite: boolean
  overtimeThresholdMinutes: number
}): EvaluatedRow[] {
  const {
    rows,
    state,
    saturdayWorkable,
    overwrite,
    overtimeThresholdMinutes,
  } = input

  return rows.map((row) => {
    const validation = validateTimeMutationRow(row)
    const existingEntries = state.entriesByDate.get(row.date) ?? []
    const duplicatePersistedEntries = existingEntries.length > 1
    const evaluation = evaluateFillDay({
      date: row.date,
      saturdayWorkable,
      isHoliday:
        state.holidayDates.has(row.date) ||
        isPublicHoliday(dateKeyToLocalNoon(row.date)),
      hasApprovedLeave: state.approvedLeaves.some((leave) =>
        leaveOverlapsDate(leave, row.date)
      ),
      hasExistingEntry: existingEntries.length === 1,
      overwrite,
      isValid: validation.valid && !duplicatePersistedEntries,
    })

    if (evaluation.action === 'skip' || !validation.valid) {
      return {
        input: row,
        action: 'skip',
        reason: evaluation.action === 'skip' ? evaluation.reason : 'invalid',
      }
    }

    const clockIn = new Date(row.clockIn)
    return {
      input: row,
      action: evaluation.action,
      existingEntryId: existingEntries[0]?.id,
      clockIn,
      clockOut: new Date(row.clockOut),
      canonicalDate: toWarsawBusinessDateUtcMidnight(clockIn),
      totalMinutes: validation.totalMinutes,
      breakMinutes: validation.breakMinutes,
      overtimeMinutes: calculateBatchOvertimeMinutes({
        date: row.date,
        totalMinutes: validation.totalMinutes,
        breakMinutes: validation.breakMinutes,
        overtimeThresholdMinutes,
      }),
    }
  })
}

function summarizeRows(rows: EvaluatedRow[]): FillCounts {
  const counts: FillCounts = {
    eligible: 0,
    existing: 0,
    weekends: 0,
    holidays: 0,
    approvedLeave: 0,
    invalid: 0,
  }

  for (const row of rows) {
    if (row.action === 'create' || row.action === 'update') {
      counts.eligible += 1
      continue
    }
    if (row.reason === 'existing') counts.existing += 1
    else if (row.reason === 'weekend') counts.weekends += 1
    else if (row.reason === 'holiday') counts.holidays += 1
    else if (row.reason === 'approved_leave') counts.approvedLeave += 1
    else counts.invalid += 1
  }

  return counts
}

function responseRows(rows: EvaluatedRow[]) {
  return rows.map((row) => ({
    date: row.input.date,
    action: row.action,
    ...(row.reason ? { reason: row.reason } : {}),
  }))
}

async function handleTimeEntryFill(
  req: NextRequest,
  {
    prisma: db,
    getSession,
    getHrSettings: loadHrSettings,
  }: TimeEntryFillHandlerDependencies
) {
  const session = await getSession()
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

  const parsed = timeEntryFillSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { employeeId, rows, overwrite, preview } = parsed.data
  const uniqueDates = new Set(rows.map((row) => row.date))
  if (uniqueDates.size !== rows.length) {
    return NextResponse.json({ error: DUPLICATE_DATES_ERROR }, { status: 400 })
  }

  const [targetEmployee, viewerEmployee] = await Promise.all([
    db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, divisionId: true, active: true },
    }),
    session.user.role === 'MANAGER' && session.user.employeeId
      ? db.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : Promise.resolve(null),
  ])

  if (!targetEmployee) {
    return session.user.role === 'MANAGER'
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : NextResponse.json({ error: 'Employee not found' }, { status: 404 })
  }
  if (!canViewEmployeeRecord(session, targetEmployee, viewerEmployee)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [settings, timeRule] = await Promise.all([
    loadHrSettings(),
    targetEmployee.divisionId
      ? db.timeTrackingRule.findFirst({
          where: { divisionId: targetEmployee.divisionId },
          orderBy: { id: 'asc' },
          select: { overtimeThreshold: true },
        })
      : Promise.resolve(null),
  ])
  const ruleThreshold = timeRule
    ? Math.round(timeRule.overtimeThreshold * 60)
    : null
  const overtimeThresholdMinutes =
    ruleThreshold !== null &&
    Number.isFinite(ruleThreshold) &&
    ruleThreshold >= 0
      ? ruleThreshold
      : settings.overtimeThresholdMinutes
  const dates = rows.map((row) => row.date)

  if (preview) {
    const state = await loadFillState(
      db,
      employeeId,
      targetEmployee.divisionId,
      dates
    )
    const evaluated = evaluateRows({
      rows,
      state,
      saturdayWorkable: settings.saturdayWorkable,
      overwrite,
      overtimeThresholdMinutes,
    })
    return NextResponse.json({
      preview: true,
      counts: summarizeRows(evaluated),
      rows: responseRows(evaluated),
      saved: [],
    })
  }

  try {
    const result = await runSerializableTransactionWithRetry(() =>
      db.$transaction(async (tx) => {
        const state = await loadFillState(
          tx,
          employeeId,
          targetEmployee.divisionId,
          dates
        )
        const evaluated = evaluateRows({
          rows,
          state,
          saturdayWorkable: settings.saturdayWorkable,
          overwrite,
          overtimeThresholdMinutes,
        })
        const saved: Array<{ date: string; entryId: string }> = []

        for (const row of evaluated) {
          if (row.action === 'skip') continue
          const data = {
            date: row.canonicalDate!,
            clockIn: row.clockIn!,
            clockOut: row.clockOut!,
            totalMinutes: row.totalMinutes!,
            breakMinutes: row.breakMinutes!,
            overtimeMinutes: row.overtimeMinutes!,
            source: 'bulk',
          }

          try {
            const entry = row.action === 'update'
              ? await tx.timeEntry.update({
                  where: { id: row.existingEntryId! },
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
            saved.push({ date: row.input.date, entryId: entry.id })
          } catch (error) {
            if (isExactTimeEntryDateUniqueError(error)) {
              throw new FillWriteConflictError()
            }
            throw error
          }
        }

        return {
          preview: false,
          counts: summarizeRows(evaluated),
          rows: responseRows(evaluated),
          saved,
        }
      }, { isolationLevel: 'Serializable' })
    )
    return NextResponse.json(result)
  } catch (error) {
    if (
      error instanceof FillWriteConflictError ||
      error instanceof SerializableTransactionConflictError
    ) {
      return NextResponse.json({ error: WRITE_CONFLICT_ERROR }, { status: 409 })
    }
    throw error
  }
}

export function createTimeEntryFillHandler(
  dependencies: TimeEntryFillHandlerDependencies
) {
  return (req: NextRequest) => handleTimeEntryFill(req, dependencies)
}
