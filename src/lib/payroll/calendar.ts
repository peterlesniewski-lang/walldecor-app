import { createHash } from 'node:crypto'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import { payrollMonthKey, periodFirstDay, periodLastDay, type PayrollPeriod } from './period'
import type { OvertimeResolution, PayrollBasis } from './types'

// Pure derivation of the payroll inputs from the existing HR calendar and base salaries.
// Nothing here writes hours: the calendar (TimeEntry) stays the single source of recorded time.

export type CalendarTimeEntry = {
  id: string
  date: Date
  status: string
  clockOut: Date | null
  totalMinutes: number | null
  breakMinutes: number | null
  overtimeMinutes: number
}

export type CalendarOvertimeRequest = {
  date: Date
  status: string
  resolution: string | null
}

export type BaseSalaryRow = {
  id: string
  amountGrosze: number
  basis: string
  effectiveFrom: string
  revokedAt: Date | null
}

export type ExistingOvertimeLine = {
  timeEntryId: string
  resolution: string | null
  resolutionSource: string | null
}

export type BaseSegment = {
  baseSalaryId: string
  from: string
  amountGrosze: number
  basis: PayrollBasis
}

export type DerivedOvertimeLine = {
  timeEntryId: string
  date: string
  overtimeMinutes: number
  entryStatus: 'pending' | 'approved' | 'rejected'
  isSaturday: boolean
  resolution: OvertimeResolution | null
  resolutionSource: 'OVERTIME_REQUEST' | 'ADMIN' | null
}

export type CalendarSnapshot = {
  lines: DerivedOvertimeLine[]
  approvedWorkedMinutes: number
  pendingEntryCount: number
  openEntryCount: number
  baseSegments: BaseSegment[]
  baseSalaryGrosze: number | null
  baseBasis: PayrollBasis | null
  fingerprint: string
}

const REQUEST_RESOLUTION: Record<string, OvertimeResolution> = {
  payment: 'PAYOUT',
  time_off: 'TIME_OFF',
}

function normalizeEntryStatus(status: string): DerivedOvertimeLine['entryStatus'] {
  return status === 'approved' || status === 'rejected' ? status : 'pending'
}

function isSaturday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6
}

/** Base salary rows that apply to the period: the one in force on day 1 plus changes within the month. */
export function resolveBaseSegments(rows: BaseSalaryRow[], period: PayrollPeriod): BaseSegment[] {
  const first = periodFirstDay(period)
  const last = periodLastDay(period)
  const active = rows
    .filter((row) => row.revokedAt === null && row.effectiveFrom <= last)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

  const inForceAtStart = active.filter((row) => row.effectiveFrom <= first).at(-1)
  const changesInMonth = active.filter((row) => row.effectiveFrom > first)

  return [...(inForceAtStart ? [inForceAtStart] : []), ...changesInMonth].map((row) => ({
    baseSalaryId: row.id,
    from: row.effectiveFrom < first ? first : row.effectiveFrom,
    amountGrosze: row.amountGrosze,
    basis: row.basis as PayrollBasis,
  }))
}

function defaultResolutionFromRequests(
  date: string,
  requests: CalendarOvertimeRequest[]
): OvertimeResolution | null {
  const resolutions = new Set(
    requests
      .filter((request) => request.status === 'approved' && request.resolution)
      .filter((request) => getWarsawBusinessDate(request.date).isoDate === date)
      .map((request) => REQUEST_RESOLUTION[request.resolution as string])
      .filter(Boolean)
  )
  // Conflicting approved requests for one day are left for the administrator to decide.
  return resolutions.size === 1 ? [...resolutions][0] : null
}

export function buildCalendarSnapshot(input: {
  period: PayrollPeriod
  entries: CalendarTimeEntry[]
  overtimeRequests: CalendarOvertimeRequest[]
  baseSalaries: BaseSalaryRow[]
  existingLines?: ExistingOvertimeLine[]
}): CalendarSnapshot {
  const monthKey = payrollMonthKey(input.period)
  const existing = new Map((input.existingLines ?? []).map((line) => [line.timeEntryId, line]))

  const monthEntries = input.entries
    .map((entry) => ({ entry, isoDate: getWarsawBusinessDate(entry.date).isoDate }))
    .filter(({ isoDate }) => isoDate.startsWith(`${monthKey}-`))
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate) || a.entry.id.localeCompare(b.entry.id))

  let approvedWorkedMinutes = 0
  let pendingEntryCount = 0
  let openEntryCount = 0
  const lines: DerivedOvertimeLine[] = []

  for (const { entry, isoDate } of monthEntries) {
    const status = normalizeEntryStatus(entry.status)
    if (entry.clockOut === null) openEntryCount++
    if (status === 'pending') pendingEntryCount++
    if (status === 'approved') {
      approvedWorkedMinutes += Math.max(0, (entry.totalMinutes ?? 0) - (entry.breakMinutes ?? 0))
    }
    if (entry.overtimeMinutes <= 0) continue

    const previous = existing.get(entry.id)
    const requestResolution = defaultResolutionFromRequests(isoDate, input.overtimeRequests)
    let resolution: OvertimeResolution | null = null
    let resolutionSource: DerivedOvertimeLine['resolutionSource'] = null
    if (previous?.resolutionSource === 'ADMIN' && previous.resolution) {
      resolution = previous.resolution as OvertimeResolution
      resolutionSource = 'ADMIN'
    } else if (requestResolution) {
      resolution = requestResolution
      resolutionSource = 'OVERTIME_REQUEST'
    }

    lines.push({
      timeEntryId: entry.id,
      date: isoDate,
      overtimeMinutes: entry.overtimeMinutes,
      entryStatus: status,
      isSaturday: isSaturday(isoDate),
      resolution,
      resolutionSource,
    })
  }

  const baseSegments = resolveBaseSegments(input.baseSalaries, input.period)
  const latestBase = baseSegments.at(-1) ?? null

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      entries: monthEntries.map(({ entry, isoDate }) => [
        entry.id,
        isoDate,
        normalizeEntryStatus(entry.status),
        entry.clockOut === null,
        entry.totalMinutes ?? 0,
        entry.breakMinutes ?? 0,
        entry.overtimeMinutes,
      ]),
      requests: lines.map((line) => [line.timeEntryId, defaultResolutionFromRequests(line.date, input.overtimeRequests)]),
      base: baseSegments.map((segment) => [segment.baseSalaryId, segment.from, segment.amountGrosze, segment.basis]),
    }))
    .digest('hex')

  return {
    lines,
    approvedWorkedMinutes,
    pendingEntryCount,
    openEntryCount,
    baseSegments,
    baseSalaryGrosze: latestBase?.amountGrosze ?? null,
    baseBasis: latestBase?.basis ?? null,
    fingerprint,
  }
}
