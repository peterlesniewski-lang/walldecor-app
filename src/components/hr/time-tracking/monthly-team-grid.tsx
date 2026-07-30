'use client'

import {
  CheckCircle2,
  Clock3,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { EmployeeAvatar } from '@/components/hr/employees/employee-avatar'
import { dateKeyToLocalNoon } from '@/lib/hr/time-tracking/month'
import type {
  TimeTrackingDayEntry,
  TimeTrackingEmployeeRow,
  TimeTrackingRangeData,
} from '@/lib/hr/time-tracking/types'
import { formatDuration, isPublicHoliday } from '@/lib/hr/utils'

interface MonthlyTeamGridProps {
  days: string[]
  employees: TimeTrackingEmployeeRow[]
  holidays: TimeTrackingRangeData['holidays']
  saturdayWorkable: boolean
  onEditCell: (cell: {
    employeeId: string
    employeeName: string
    date: string
    entry: TimeTrackingDayEntry | null
  }) => void
}

const EMPLOYEE_COLUMN_WIDTH = 176
const DAY_COLUMN_WIDTH = 56
const TOTAL_COLUMN_WIDTH = 88
const DAY_LABELS = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb']
const EMPLOYEE_COLUMN_HEADER_ID = 'monthly-employee-column'
const TOTAL_COLUMN_HEADER_ID = 'monthly-total-column'

const STATUS_DETAILS: Record<string, {
  label: string
  ariaLabel: string
  className: string
  icon: LucideIcon
}> = {
  approved: {
    label: 'Zatwierdzony',
    ariaLabel: 'zatwierdzony',
    className: 'text-emerald-600',
    icon: CheckCircle2,
  },
  pending: {
    label: 'Oczekujący',
    ariaLabel: 'oczekujący',
    className: 'text-amber-600',
    icon: Clock3,
  },
  rejected: {
    label: 'Odrzucony',
    ariaLabel: 'odrzucony',
    className: 'text-red-600',
    icon: XCircle,
  },
}

function leaveLabel(entry: TimeTrackingDayEntry): string | null {
  if (entry.leaveCode) return entry.leaveCode
  if (!entry.leaveType) return null
  return entry.leaveType.length > 6 ? `${entry.leaveType.slice(0, 5)}…` : entry.leaveType
}

function employeeRowHeaderId(employeeId: string): string {
  return `monthly-employee-${employeeId}`
}

function dayColumnHeaderId(day: string): string {
  return `monthly-day-${day}`
}

function getHolidayName(
  day: string,
  divisionId: string | null,
  holidays: TimeTrackingRangeData['holidays']
): string | null {
  const customHoliday = holidays.find((holiday) => (
    holiday.date === day &&
    (holiday.divisionId === null || holiday.divisionId === divisionId)
  ))
  if (customHoliday) return customHoliday.name
  return isPublicHoliday(dateKeyToLocalNoon(day)) ? 'Święto państwowe' : null
}

function getDayState(day: string, saturdayWorkable: boolean) {
  const date = dateKeyToLocalNoon(day)
  const dayOfWeek = date.getDay()
  const isSaturday = dayOfWeek === 6
  const isSunday = dayOfWeek === 0

  return {
    date,
    isSaturday,
    isSunday,
    isWeekend: isSaturday || isSunday,
    isBlockedWeekend: isSunday || (isSaturday && !saturdayWorkable),
  }
}

function getEntryDescription(entry: TimeTrackingDayEntry | undefined): string {
  if (!entry?.id) return 'brak wpisu'

  const parts = [
    entry.totalMinutes == null ? 'brak czasu' : formatDuration(entry.totalMinutes),
  ]
  const status = entry.status ? STATUS_DETAILS[entry.status] : null
  if (status) parts.push(status.ariaLabel)

  const leave = leaveLabel(entry)
  if (leave) parts.push(leave)
  return parts.join(', ')
}

function getNoninteractiveDescription({
  employeeName,
  day,
  entry,
  pureLeave,
  holidayName,
  isSunday,
}: {
  employeeName: string
  day: string
  entry: TimeTrackingDayEntry | undefined
  pureLeave: boolean
  holidayName: string | null
  isSunday: boolean
}): string {
  if (pureLeave && entry) {
    const code = leaveLabel(entry) ?? 'urlop'
    const type = entry.leaveType ? ` - ${entry.leaveType}` : ''
    return `${employeeName}, ${day}: urlop ${code}${type}`
  }
  if (holidayName) {
    return `${employeeName}, ${day}: święto - ${holidayName}`
  }
  return `${employeeName}, ${day}: dzień wolny - ${isSunday ? 'niedziela' : 'sobota'}`
}

function EntryContent({ entry }: { entry: TimeTrackingDayEntry }) {
  const status = entry.status ? STATUS_DETAILS[entry.status] : null
  const StatusIcon = status?.icon
  const leave = leaveLabel(entry)

  if (!entry.id) {
    return (
      <span
        className="max-w-[48px] truncate rounded border px-1 py-0.5 text-[10px] font-semibold leading-none"
        style={{
          backgroundColor: entry.leaveColor ? `${entry.leaveColor}18` : 'var(--wd-surface-2)',
          borderColor: entry.leaveColor ? `${entry.leaveColor}40` : 'var(--wd-border)',
          color: 'var(--muted-foreground)',
        }}
        title={entry.leaveType ?? leave ?? undefined}
      >
        {leave}
      </span>
    )
  }

  return (
    <>
      <span className="flex h-4 items-center justify-center gap-1">
        <span className="num text-[11px] font-semibold leading-none text-[var(--wd-text-primary)]">
          {entry.totalMinutes == null ? '?h' : formatDuration(entry.totalMinutes)}
        </span>
        {status && StatusIcon && (
          <span title={status.label} aria-label={status.label}>
            <StatusIcon className={`h-3 w-3 ${status.className}`} aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="flex h-4 items-center justify-center">
        {leave && (
          <span
            className="max-w-[48px] truncate rounded px-1 py-px text-[9px] font-semibold leading-none"
            style={{
              backgroundColor: entry.leaveColor ? `${entry.leaveColor}18` : 'var(--wd-surface-2)',
              color: 'var(--muted-foreground)',
            }}
            title={entry.leaveType ?? leave}
          >
            {leave}
          </span>
        )}
      </span>
    </>
  )
}

export function MonthlyTeamGrid({
  days,
  employees,
  holidays,
  saturdayWorkable,
  onEditCell,
}: MonthlyTeamGridProps) {
  const tableWidth = (
    EMPLOYEE_COLUMN_WIDTH +
    days.length * DAY_COLUMN_WIDTH +
    TOTAL_COLUMN_WIDTH
  )

  return (
    <div
      data-testid="monthly-team-grid"
      className="min-h-80 overflow-x-auto rounded-lg border border-[var(--wd-border)] bg-white"
    >
      <table
        aria-label="Miesięczna ewidencja zespołu"
        className="border-collapse text-xs"
        style={{
          tableLayout: 'fixed',
          width: `${tableWidth}px`,
          minWidth: `${tableWidth}px`,
        }}
      >
        <colgroup>
          <col style={{ width: `${EMPLOYEE_COLUMN_WIDTH}px` }} />
          {days.map((day) => (
            <col key={day} style={{ width: `${DAY_COLUMN_WIDTH}px` }} />
          ))}
          <col style={{ width: `${TOTAL_COLUMN_WIDTH}px` }} />
        </colgroup>

        <thead>
          <tr className="h-14 border-b-2 border-[var(--wd-border)] bg-[var(--wd-surface-2)]">
            <th
              id={EMPLOYEE_COLUMN_HEADER_ID}
              data-testid="monthly-employee-header"
              scope="col"
              className="sticky left-0 z-30 h-14 border-r border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-3 text-left text-[10px] font-semibold uppercase text-[var(--muted-foreground)]"
              style={{ width: `${EMPLOYEE_COLUMN_WIDTH}px` }}
            >
              Pracownik
            </th>
            {days.map((day) => {
              const { date, isWeekend } = getDayState(day, saturdayWorkable)
              return (
                <th
                  id={dayColumnHeaderId(day)}
                  key={day}
                  scope="col"
                  className={`h-14 border-r border-[var(--wd-border)] px-1 text-center ${
                    isWeekend ? 'bg-[var(--wd-off-white)]' : ''
                  }`}
                  style={{ width: `${DAY_COLUMN_WIDTH}px` }}
                >
                  <span className="block text-[9px] font-semibold uppercase leading-3 text-[var(--muted-foreground)]">
                    {DAY_LABELS[date.getDay()]}
                  </span>
                  <span className="num block text-xs font-semibold leading-4 text-[var(--wd-text-primary)]">
                    {date.getDate()}
                  </span>
                </th>
              )
            })}
            <th
              id={TOTAL_COLUMN_HEADER_ID}
              scope="col"
              className="h-14 px-2 text-center text-[10px] font-semibold uppercase text-[var(--muted-foreground)]"
              style={{ width: `${TOTAL_COLUMN_WIDTH}px` }}
            >
              Łącznie
            </th>
          </tr>
        </thead>

        <tbody>
          {employees.length === 0 ? (
            <tr className="h-20">
              <td
                colSpan={days.length + 2}
                className="text-center text-xs text-[var(--muted-foreground)]"
              >
                Brak pracowników do wyświetlenia
              </td>
            </tr>
          ) : employees.map((employee) => {
            const employeeName = `${employee.firstName} ${employee.lastName}`
            const monthlyTotal = days.reduce(
              (sum, day) => sum + (employee.entries[day]?.totalMinutes ?? 0),
              0
            )

            return (
              <tr
                key={employee.id}
                className="group h-14 border-b border-[var(--wd-border)] last:border-b-0"
              >
                <th
                  id={employeeRowHeaderId(employee.id)}
                  data-testid={`monthly-employee-cell-${employee.id}`}
                  scope="row"
                  className="sticky left-0 z-20 h-14 border-r border-[var(--wd-border)] bg-white px-2.5 group-hover:bg-[var(--wd-off-white)]"
                  style={{ width: `${EMPLOYEE_COLUMN_WIDTH}px` }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <EmployeeAvatar
                      firstName={employee.firstName}
                      lastName={employee.lastName}
                      size="sm"
                      avatarUrl={employee.avatarUrl}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium leading-4 text-[var(--wd-text-primary)]">
                        {employee.lastName} {employee.firstName[0]}.
                      </div>
                      {employee.divisionName && (
                        <div className="truncate text-[10px] leading-3 text-[var(--muted-foreground)]">
                          {employee.divisionName}
                        </div>
                      )}
                    </div>
                  </div>
                </th>

                {days.map((day) => {
                  const entry = employee.entries[day]
                  const hasEntry = Boolean(entry?.id)
                  const hasLeave = Boolean(entry?.leaveCode || entry?.leaveType)
                  const pureLeave = hasLeave && !hasEntry
                  const dayState = getDayState(day, saturdayWorkable)
                  const holidayName = getHolidayName(day, employee.divisionId, holidays)
                  const blocked = dayState.isBlockedWeekend || Boolean(holidayName)
                  const editable = hasEntry || (!blocked && !pureLeave)
                  const description = getEntryDescription(entry)
                  const noninteractiveDescription = !editable
                    ? getNoninteractiveDescription({
                        employeeName,
                        day,
                        entry,
                        pureLeave,
                        holidayName,
                        isSunday: dayState.isSunday,
                      })
                    : null

                  const stateBackground = holidayName
                    ? 'bg-red-50/60'
                    : dayState.isBlockedWeekend
                      ? 'bg-[var(--wd-surface-2)]'
                      : dayState.isSaturday
                        ? 'bg-orange-50/50'
                        : 'bg-white'

                  return (
                    <td
                      key={day}
                      data-testid={`monthly-cell-${employee.id}-${day}`}
                      headers={`${employeeRowHeaderId(employee.id)} ${dayColumnHeaderId(day)}`}
                      className={`h-14 border-r border-[var(--wd-border)] p-0 text-center align-middle ${stateBackground}`}
                      style={{
                        width: `${DAY_COLUMN_WIDTH}px`,
                        minWidth: `${DAY_COLUMN_WIDTH}px`,
                        maxWidth: `${DAY_COLUMN_WIDTH}px`,
                      }}
                    >
                      {editable ? (
                        <button
                          type="button"
                          aria-label={`${employeeName}, ${day}: ${description}`}
                          onClick={() => onEditCell({
                            employeeId: employee.id,
                            employeeName,
                            date: day,
                            entry: entry ?? null,
                          })}
                          className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 outline-none transition-colors hover:bg-[var(--wd-off-white)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--wd-dark)]"
                        >
                          {entry?.id ? (
                            <EntryContent entry={entry} />
                          ) : (
                            <span className="text-xs text-[var(--muted-foreground)]">—</span>
                          )}
                        </button>
                      ) : (
                        <div
                          className="flex h-14 w-14 items-center justify-center"
                          title={holidayName ?? undefined}
                        >
                          <span className="sr-only">{noninteractiveDescription}</span>
                          <div aria-hidden="true" className="flex items-center justify-center">
                            {pureLeave && entry ? (
                              <EntryContent entry={entry} />
                            ) : holidayName ? (
                              <span className="text-[9px] font-semibold leading-3 text-[var(--muted-foreground)]">
                                Święto
                              </span>
                            ) : (
                              <span className="text-[9px] font-medium leading-3 text-[var(--muted-foreground)]">
                                Wolne
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  )
                })}

                <td
                  data-testid={`monthly-total-${employee.id}`}
                  headers={`${employeeRowHeaderId(employee.id)} ${TOTAL_COLUMN_HEADER_ID}`}
                  className="num h-14 bg-white px-2 text-center text-xs font-semibold text-[var(--wd-text-primary)] group-hover:bg-[var(--wd-off-white)]"
                  style={{ width: `${TOTAL_COLUMN_WIDTH}px` }}
                >
                  {formatDuration(monthlyTotal)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
