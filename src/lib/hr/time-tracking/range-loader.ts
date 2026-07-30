import { prisma } from '@/lib/prisma'
import {
  getScopedEmployeeWhere,
  HR_NO_EMPLOYEE_ACCESS_ID,
  type HrSessionLike,
} from '@/lib/hr/access'
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

function formatUtcDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
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
            date: { gte: rangeStart, lte: rangeEnd },
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
            startDate: { lte: rangeEnd },
            endDate: { gte: rangeStart },
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
        date: { gte: rangeStart, lte: rangeEnd },
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

  for (const entry of timeEntries) {
    const dateKey = formatUtcDateKey(entry.date)
    const employeeEntries = entryMap.get(entry.employeeId)
    if (!employeeEntries || !daySet.has(dateKey)) continue

    employeeEntries[dateKey] = {
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

    const current = new Date(Date.UTC(
      leave.startDate.getUTCFullYear(),
      leave.startDate.getUTCMonth(),
      leave.startDate.getUTCDate()
    ))
    const leaveEnd = new Date(Date.UTC(
      leave.endDate.getUTCFullYear(),
      leave.endDate.getUTCMonth(),
      leave.endDate.getUTCDate()
    ))

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
    holidays: customHolidays.map((holiday) => ({
      date: formatUtcDateKey(holiday.date),
      name: holiday.name,
      divisionId: holiday.divisionId,
    })),
    saturdayWorkable: settings.saturdayWorkable,
    standardClockIn: settings.standardClockIn,
    standardClockOut: settings.standardClockOut,
  }
}
