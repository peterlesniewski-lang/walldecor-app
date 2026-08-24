import { prisma } from '@/lib/prisma'
import {
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_ID,
  type HrSessionLike,
} from '@/lib/hr/access'
import { getWarsawBusinessDate } from '@/lib/hr/business-date'
import { getHrSettings } from '@/lib/hr/hr-settings'
import type {
  TimeTrackingDayEntry,
  TimeTrackingRangeData,
} from '@/lib/hr/time-tracking/types'

export interface LoadTimeTrackingRangeInput {
  session: HrSessionLike
  start: Date
  end: Date
  divisionId?: string
  departmentId?: string
  employeeId?: string
}

export class TimeTrackingRangeConflictError extends Error {
  readonly code = 'DUPLICATE_TIME_ENTRY_BUSINESS_DATE'
  readonly employeeId: string
  readonly dateKey: string
  readonly entryIds: string[]

  constructor(employeeId: string, dateKey: string, entryIds: string[]) {
    const sortedEntryIds = [...entryIds].sort()
    super(
      `Multiple time entries map to employee ${employeeId} on Warsaw business date ` +
      `${dateKey}: ${sortedEntryIds.join(', ')}`
    )
    this.name = 'TimeTrackingRangeConflictError'
    this.employeeId = employeeId
    this.dateKey = dateKey
    this.entryIds = sortedEntryIds
  }
}

function formatUtcDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function persistedPlainDateKey(date: Date): string {
  return getWarsawBusinessDate(date).isoDate
}

function normalizeCalendarRange(start: Date, end: Date): { rangeStart: Date; rangeEnd: Date } {
  return {
    rangeStart: new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())),
    rangeEnd: new Date(Date.UTC(
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
      23,
      59,
      59,
      999
    )),
  }
}

function widenCalendarQueryRange(
  rangeStart: Date,
  rangeEnd: Date
): { queryStart: Date; queryEnd: Date } {
  const queryStart = new Date(rangeStart)
  queryStart.setUTCDate(queryStart.getUTCDate() - 1)
  const queryEnd = new Date(rangeEnd)
  queryEnd.setUTCDate(queryEnd.getUTCDate() + 1)
  return { queryStart, queryEnd }
}

function dateKeyToUtcDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function buildDateKeys(rangeStart: Date, rangeEnd: Date): string[] {
  const current = new Date(rangeStart)
  const days: string[] = []

  while (current <= rangeEnd) {
    days.push(formatUtcDateKey(current))
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return days
}

function emptyDailyTotals(days: string[]): Record<string, number> {
  return Object.fromEntries(days.map((day) => [day, 0]))
}

function emptyRange(
  rangeStart: Date,
  rangeEnd: Date,
  days: string[],
  settings: Awaited<ReturnType<typeof getHrSettings>>
): TimeTrackingRangeData {
  return {
    startDate: formatUtcDateKey(rangeStart),
    endDate: formatUtcDateKey(rangeEnd),
    days,
    employees: [],
    dailyTotals: emptyDailyTotals(days),
    holidays: [],
    saturdayWorkable: settings.saturdayWorkable,
    standardClockIn: settings.standardClockIn,
    standardClockOut: settings.standardClockOut,
  }
}

export async function loadTimeTrackingRange({
  session,
  start,
  end,
  divisionId,
  departmentId,
  employeeId,
}: LoadTimeTrackingRangeInput): Promise<TimeTrackingRangeData> {
  const { rangeStart, rangeEnd } = normalizeCalendarRange(start, end)
  const { queryStart, queryEnd } = widenCalendarQueryRange(rangeStart, rangeEnd)
  const days = buildDateKeys(rangeStart, rangeEnd)
  const daySet = new Set(days)
  const settingsPromise = getHrSettings()

  const viewerEmployee =
    session.user.role === 'MANAGER' && session.user.employeeId
      ? await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { id: true, divisionId: true, active: true },
        })
      : null

  const employeeWhere: Record<string, unknown> = {
    active: true,
    ...getScopedEmployeeWhere(session, viewerEmployee),
  }

  if (
    employeeWhere.id === HR_NO_EMPLOYEE_ACCESS_ID ||
    (session.user.role === 'MANAGER' && divisionId && viewerEmployee?.divisionId !== divisionId)
  ) {
    return emptyRange(rangeStart, rangeEnd, days, await settingsPromise)
  }

  if (divisionId) employeeWhere.divisionId = divisionId
  if (departmentId) employeeWhere.departmentId = departmentId
  if (employeeId) employeeWhere.id = employeeId

  const employees = await prisma.employee.findMany({
    where: employeeWhere,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      divisionId: true,
      avatarUrl: true,
      division: { select: { name: true } },
    },
  })

  const employeeIds = employees.map((employee) => employee.id)
  const holidayDivisionId = session.user.role === 'MANAGER'
    ? viewerEmployee?.divisionId ?? undefined
    : divisionId

  const [timeEntries, leaveRequests, customHolidays, settings] = await Promise.all([
    employeeIds.length > 0
      ? prisma.timeEntry.findMany({
          where: {
            employeeId: { in: employeeIds },
            date: { gte: queryStart, lte: queryEnd },
          },
          select: {
            id: true,
            employeeId: true,
            date: true,
            clockIn: true,
            clockOut: true,
            totalMinutes: true,
            breakMinutes: true,
            status: true,
          },
        })
      : Promise.resolve([]),
    employeeIds.length > 0
      ? prisma.leaveRequestNew.findMany({
          where: {
            employeeId: { in: employeeIds },
            status: 'approved',
            startDate: { lte: queryEnd },
            endDate: { gte: queryStart },
          },
          select: {
            employeeId: true,
            startDate: true,
            endDate: true,
            leaveType: {
              select: { name: true, code: true, color: true },
            },
          },
        })
      : Promise.resolve([]),
    prisma.customHoliday.findMany({
      where: {
        date: { gte: queryStart, lte: queryEnd },
        ...(holidayDivisionId
          ? { OR: [{ divisionId: null }, { divisionId: holidayDivisionId }] }
          : {}),
      },
      orderBy: { date: 'asc' },
      select: { date: true, name: true, divisionId: true },
    }),
    settingsPromise,
  ])

  const entryMap = new Map<string, Record<string, TimeTrackingDayEntry>>(
    employees.map((employee) => [employee.id, {}])
  )

  const groupedTimeEntries = new Map<string, {
    employeeId: string
    dateKey: string
    entries: Array<(typeof timeEntries)[number]>
  }>()

  for (const entry of timeEntries) {
    const dateKey = persistedPlainDateKey(entry.date)
    if (!entryMap.has(entry.employeeId) || !daySet.has(dateKey)) continue

    const groupKey = `${entry.employeeId}\0${dateKey}`
    const group = groupedTimeEntries.get(groupKey) ?? {
      employeeId: entry.employeeId,
      dateKey,
      entries: [],
    }
    group.entries.push(entry)
    groupedTimeEntries.set(groupKey, group)
  }

  const conflict = Array.from(groupedTimeEntries.values())
    .filter((group) => group.entries.length > 1)
    .sort((left, right) =>
      left.employeeId.localeCompare(right.employeeId) || left.dateKey.localeCompare(right.dateKey)
    )[0]

  if (conflict) {
    throw new TimeTrackingRangeConflictError(
      conflict.employeeId,
      conflict.dateKey,
      conflict.entries.map((entry) => entry.id)
    )
  }

  for (const group of groupedTimeEntries.values()) {
    const entry = group.entries[0]
    const employeeEntries = entryMap.get(group.employeeId)
    if (!employeeEntries) continue

    employeeEntries[group.dateKey] = {
      id: entry.id,
      clockIn: entry.clockIn.toISOString(),
      clockOut: entry.clockOut?.toISOString() ?? null,
      totalMinutes: entry.totalMinutes,
      breakMinutes: entry.breakMinutes,
      status: entry.status,
    }
  }

  for (const leave of leaveRequests) {
    const employeeEntries = entryMap.get(leave.employeeId)
    if (!employeeEntries) continue

    const current = dateKeyToUtcDate(persistedPlainDateKey(leave.startDate))
    const leaveEnd = dateKeyToUtcDate(persistedPlainDateKey(leave.endDate))

    while (current <= leaveEnd) {
      const dateKey = formatUtcDateKey(current)
      if (daySet.has(dateKey)) {
        const existingEntry = employeeEntries[dateKey]
        const leaveMetadata = {
          leaveType: leave.leaveType.name,
          leaveCode: leave.leaveType.code,
          leaveColor: leave.leaveType.color,
        }

        employeeEntries[dateKey] = existingEntry
          ? { ...existingEntry, ...leaveMetadata }
          : { ...leaveMetadata, status: 'leave' }
      }
      current.setUTCDate(current.getUTCDate() + 1)
    }
  }

  const dailyTotals = emptyDailyTotals(days)
  for (const day of days) {
    for (const employee of employees) {
      dailyTotals[day] += entryMap.get(employee.id)?.[day]?.totalMinutes ?? 0
    }
  }

  return {
    startDate: formatUtcDateKey(rangeStart),
    endDate: formatUtcDateKey(rangeEnd),
    days,
    employees: employees.map((employee) => ({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      divisionId: employee.divisionId,
      divisionName: employee.division?.name ?? null,
      avatarUrl: employee.avatarUrl,
      entries: entryMap.get(employee.id) ?? {},
    })),
    dailyTotals,
    holidays: customHolidays
      .map((holiday) => ({
        date: persistedPlainDateKey(holiday.date),
        name: holiday.name,
        divisionId: holiday.divisionId,
      }))
      .filter((holiday) => daySet.has(holiday.date)),
    saturdayWorkable: settings.saturdayWorkable,
    standardClockIn: settings.standardClockIn,
    standardClockOut: settings.standardClockOut,
  }
}
