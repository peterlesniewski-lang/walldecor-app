'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Users,
  Monitor,
  UserX,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveType {
  id: string
  name: string
  code: string
  color: string
}

interface LeaveEntry {
  id: string
  startDate: string
  endDate: string
  days: number
  status: 'approved' | 'pending'
  isRemoteWork: boolean
  isDelegation: boolean
  leaveType: LeaveType
}

interface EmployeeRow {
  id: string
  firstName: string
  lastName: string
  divisionId: string | null
  leaves: LeaveEntry[]
}

interface Holiday {
  date: string
  name: string
}

interface CalendarData {
  employees: EmployeeRow[]
  holidays: Holiday[]
  month: string
  daysInMonth: number
}

interface SummaryData {
  present: number
  remote: number
  absent: number
  plannedNext: number
  total: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PL_DAYS_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb']
const PL_MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function parseMonth(monthStr: string): { year: number; month: number } {
  const [y, m] = monthStr.split('-').map(Number)
  return { year: y, month: m }
}

function getDayOfWeek(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getDay()
}

function isWeekendDay(dow: number): boolean {
  return dow === 0 || dow === 6
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function prevMonth(monthStr: string): string {
  const { year, month } = parseMonth(monthStr)
  const d = new Date(year, month - 2, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

function nextMonth(monthStr: string): string {
  const { year, month } = parseMonth(monthStr)
  const d = new Date(year, month, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

function currentMonthStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode
  value: number
  label: string
  percent?: number
  accent?: string
}

function KpiCard({ icon, value, label, percent, accent = 'var(--wd-sand)' }: KpiCardProps) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border p-4 bg-white min-w-[140px]"
      style={{ borderColor: 'var(--wd-border)' }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: accent }}>{icon}</span>
        <span className="text-2xl font-black tabular-nums" style={{ color: 'var(--wd-dark)', fontFamily: 'var(--font-mono, monospace)' }}>
          {value}
        </span>
      </div>
      <p className="text-xs font-medium" style={{ color: 'var(--wd-text-muted)' }}>{label}</p>
      {percent !== undefined && (
        <div className="mt-1 h-1 w-full rounded-full" style={{ background: 'var(--wd-surface-2)' }}>
          <div
            className="h-1 rounded-full transition-all"
            style={{ width: `${Math.min(100, percent)}%`, background: accent }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Filter Toggle ────────────────────────────────────────────────────────────

interface FilterState {
  showAbsent: boolean
  showPresent: boolean
  showRemote: boolean
  showPlanned: boolean
}

// ─── Absence Popover ──────────────────────────────────────────────────────────

interface AbsencePopoverProps {
  leave: LeaveEntry
  employeeName: string
  children: React.ReactNode
}

function AbsencePopover({ leave, employeeName, children }: AbsencePopoverProps) {
  const statusLabel =
    leave.status === 'approved' ? 'Zatwierdzony' : 'Oczekujący'
  const statusColor =
    leave.status === 'approved' ? '#16a34a' : '#d97706'

  const formatDate = (isoStr: string) => {
    const [y, m, d] = isoStr.split('-')
    return `${d}.${m}.${y}`
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-72 p-0 shadow-lg"
        style={{ border: '1px solid var(--wd-border)', borderRadius: '10px', overflow: 'hidden' }}
        sideOffset={4}
      >
        {/* Header strip with leave type color */}
        <div
          className="px-4 py-3"
          style={{ background: leave.leaveType.color + '18', borderBottom: '1px solid var(--wd-border)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-white text-xs font-bold"
              style={{ background: leave.leaveType.color }}
            >
              {leave.leaveType.code}
            </span>
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--wd-dark)' }}>{employeeName}</p>
              <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>{leave.leaveType.name}</p>
            </div>
          </div>
        </div>
        {/* Body */}
        <div className="px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--wd-text-muted)' }}>Okres</span>
            <span className="font-medium" style={{ color: 'var(--wd-dark)' }}>
              {formatDate(leave.startDate)} – {formatDate(leave.endDate)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--wd-text-muted)' }}>Liczba dni</span>
            <span className="font-medium" style={{ color: 'var(--wd-dark)' }}>{leave.days} {leave.days === 1 ? 'dzień' : 'dni'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--wd-text-muted)' }}>Status</span>
            <span className="flex items-center gap-1 font-medium" style={{ color: statusColor }}>
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: statusColor }}
              />
              {statusLabel}
            </span>
          </div>
          {leave.isRemoteWork && (
            <div className="flex items-center gap-1 text-xs mt-1 px-2 py-1 rounded-md" style={{ background: 'var(--wd-surface-2)', color: 'var(--wd-text-muted)' }}>
              <Monitor size={12} />
              Praca zdalna
            </div>
          )}
          {leave.isDelegation && (
            <div className="flex items-center gap-1 text-xs mt-1 px-2 py-1 rounded-md" style={{ background: 'var(--wd-surface-2)', color: 'var(--wd-text-muted)' }}>
              <CalendarDays size={12} />
              Delegacja
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Calendar Cell ────────────────────────────────────────────────────────────

interface CellLeave {
  leave: LeaveEntry
  isStart: boolean
  isEnd: boolean
}

function CalendarCell({
  dayStr,
  cellLeave,
  employeeName,
  isWeekend,
  isHoliday,
  isToday,
  filters,
}: {
  dayStr: string
  cellLeave: CellLeave | null
  employeeName: string
  isWeekend: boolean
  isHoliday: boolean
  isToday: boolean
  filters: FilterState
}) {
  let bg = 'transparent'
  if (isHoliday) bg = 'rgb(254 242 242)'
  else if (isWeekend) bg = 'var(--wd-surface-2)'

  if (!cellLeave) {
    return (
      <td
        style={{
          background: bg,
          width: 28,
          minWidth: 28,
          padding: 0,
          borderRight: '1px solid var(--wd-border)',
          borderBottom: '1px solid var(--wd-border)',
          position: 'relative',
        }}
      >
        {isToday && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--wd-sand)' }} />
        )}
      </td>
    )
  }

  const { leave, isStart, isEnd } = cellLeave

  // Filter logic
  const show =
    (leave.isRemoteWork && filters.showRemote) ||
    (!leave.isRemoteWork && leave.status === 'approved' && filters.showAbsent) ||
    (leave.status === 'pending' && filters.showPlanned)

  if (!show) {
    return (
      <td
        style={{
          background: bg,
          width: 28,
          minWidth: 28,
          padding: 0,
          borderRight: '1px solid var(--wd-border)',
          borderBottom: '1px solid var(--wd-border)',
          position: 'relative',
        }}
      >
        {isToday && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--wd-sand)' }} />
        )}
      </td>
    )
  }

  const color = leave.isRemoteWork ? '#3B82F6' : leave.leaveType.color
  // Pending = slightly transparent / dashed look
  const opacity = leave.status === 'pending' ? 0.65 : 0.9

  const borderRadius =
    isStart && isEnd
      ? '4px'
      : isStart
      ? '4px 0 0 4px'
      : isEnd
      ? '0 4px 4px 0'
      : '0'

  return (
    <td
      style={{
        background: bg,
        width: 28,
        minWidth: 28,
        padding: '2px 0',
        borderRight: '1px solid var(--wd-border)',
        borderBottom: '1px solid var(--wd-border)',
        position: 'relative',
      }}
    >
      {isToday && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'var(--wd-sand)', zIndex: 2 }} />
      )}
      <AbsencePopover leave={leave} employeeName={employeeName}>
        <button
          className="block w-full h-full cursor-pointer transition-opacity hover:opacity-100"
          style={{
            background: color,
            opacity,
            borderRadius,
            height: 20,
            border: leave.status === 'pending' ? `1px dashed ${color}` : 'none',
          }}
          aria-label={`${leave.leaveType.name} — ${employeeName}`}
        >
          {isStart && (
            <span
              className="text-white truncate block px-1"
              style={{ fontSize: 9, fontWeight: 600, lineHeight: '20px', letterSpacing: '0.02em' }}
            >
              {leave.leaveType.code}
            </span>
          )}
        </button>
      </AbsencePopover>
    </td>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface AbsenceCalendarProps {
  initialData: CalendarData
  initialMonth: string
  initialSummary: SummaryData
}

export function AbsenceCalendar({ initialData, initialMonth, initialSummary }: AbsenceCalendarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [calData, setCalData] = useState<CalendarData>(initialData)
  const [summary, setSummary] = useState<SummaryData>(initialSummary)
  const [month, setMonth] = useState(initialMonth)
  const [loading, setLoading] = useState(false)

  const [filters, setFilters] = useState<FilterState>({
    showAbsent: true,
    showPresent: true,
    showRemote: true,
    showPlanned: true,
  })

  const today = todayStr()
  const { year, month: monthNum } = parseMonth(month)

  const tableScrollRef = useRef<HTMLDivElement>(null)

  const fetchCalendar = useCallback(async (m: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/hr/leave/calendar?month=${m}`)
      if (res.ok) {
        const data = await res.json() as CalendarData
        setCalData(data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSummary = useCallback(async () => {
    const res = await fetch(`/api/hr/leave/summary?date=${today}`)
    if (res.ok) {
      const data = await res.json() as SummaryData
      setSummary(data)
    }
  }, [today])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  const navigateMonth = (newMonth: string) => {
    setMonth(newMonth)
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', newMonth)
    router.push(`?${params.toString()}`, { scroll: false })
    fetchCalendar(newMonth)
  }

  // Build day array for the month
  const days = Array.from({ length: calData.daysInMonth }, (_, i) => i + 1)

  // Holiday lookup
  const holidayMap = new Map<string, string>()
  for (const h of calData.holidays) {
    holidayMap.set(h.date, h.name)
  }

  // Precompute: for each employee, build a map of dayStr → CellLeave
  function buildLeaveLookup(employee: EmployeeRow): Map<string, CellLeave> {
    const map = new Map<string, CellLeave>()
    for (const leave of employee.leaves) {
      const start = new Date(leave.startDate + 'T12:00:00')
      const end = new Date(leave.endDate + 'T12:00:00')
      const cursor = new Date(start)
      while (cursor <= end) {
        const ds = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(cursor.getDate())}`
        map.set(ds, {
          leave,
          isStart: ds === leave.startDate,
          isEnd: ds === leave.endDate,
        })
        cursor.setDate(cursor.getDate() + 1)
      }
    }
    return map
  }

  const filterButton = (key: keyof FilterState, label: string, color: string) => {
    const active = filters[key]
    return (
      <button
        key={key}
        onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
        style={
          active
            ? { background: 'var(--wd-dark)', color: '#fff' }
            : { border: '1px solid var(--wd-border)', color: 'var(--wd-text-muted)', background: 'transparent' }
        }
      >
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ background: active ? color : 'var(--wd-border)' }}
        />
        {label}
      </button>
    )
  }

  const prevMonthStr = prevMonth(month)
  const nextMonthStr = nextMonth(month)
  const { month: prevM } = parseMonth(prevMonthStr)
  const { month: nextM } = parseMonth(nextMonthStr)

  return (
    <div className="flex flex-col gap-6">
      {/* ── KPI Row ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <KpiCard
          icon={<Users size={18} />}
          value={summary.present}
          label="Obecni w firmie"
          percent={summary.total > 0 ? Math.round((summary.present / summary.total) * 100) : 0}
          accent="var(--wd-sand)"
        />
        <KpiCard
          icon={<Monitor size={18} />}
          value={summary.remote}
          label="Praca zdalna"
          percent={summary.total > 0 ? Math.round((summary.remote / summary.total) * 100) : 0}
          accent="#3B82F6"
        />
        <KpiCard
          icon={<UserX size={18} />}
          value={summary.absent}
          label="Nieobecni"
          percent={summary.total > 0 ? Math.round((summary.absent / summary.total) * 100) : 0}
          accent="#EF4444"
        />
        <KpiCard
          icon={<CalendarClock size={18} />}
          value={summary.plannedNext}
          label="Planowane (7 dni)"
          accent="#8B5CF6"
        />
      </div>

      {/* ── Calendar Panel ────────────────────────────────────────────────── */}
      <div
        className="rounded-xl border bg-white overflow-hidden"
        style={{ borderColor: 'var(--wd-border)' }}
      >
        {/* Header: nav + filters */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          {/* Month navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigateMonth(prevMonthStr)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--wd-surface-2)]"
              style={{ color: 'var(--wd-text-muted)', border: '1px solid var(--wd-border)' }}
            >
              <ChevronLeft size={14} />
              {PL_MONTHS[prevM - 1]}
            </button>
            <h2 className="text-base font-bold px-2" style={{ color: 'var(--wd-dark)', minWidth: 160, textAlign: 'center' }}>
              {PL_MONTHS[monthNum - 1]} {year}
            </h2>
            <button
              onClick={() => navigateMonth(nextMonthStr)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--wd-surface-2)]"
              style={{ color: 'var(--wd-text-muted)', border: '1px solid var(--wd-border)' }}
            >
              {PL_MONTHS[nextM - 1]}
              <ChevronRight size={14} />
            </button>
            <button
              onClick={() => navigateMonth(currentMonthStr())}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium ml-1 transition-colors hover:bg-[var(--wd-surface-2)]"
              style={{ color: 'var(--wd-text-muted)', border: '1px solid var(--wd-border)' }}
            >
              Dziś
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {filterButton('showAbsent', 'Nieobecni', '#EF4444')}
            {filterButton('showPresent', 'Obecni', '#22C55E')}
            {filterButton('showRemote', 'Praca zdalna', '#3B82F6')}
            {filterButton('showPlanned', 'Pokaż plany', '#8B5CF6')}
          </div>
        </div>

        {/* Loading indicator */}
        {loading && (
          <div className="h-0.5 w-full overflow-hidden" style={{ background: 'var(--wd-surface-2)' }}>
            <div
              className="h-full animate-pulse"
              style={{ background: 'var(--wd-sand)', width: '40%', animation: 'loading-bar 1s ease-in-out infinite' }}
            />
          </div>
        )}

        {/* Table scroll wrapper */}
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '100%' }}>
            <thead>
              {/* Day numbers row */}
              <tr>
                {/* Sticky employee column header */}
                <th
                  className="sticky left-0 z-20 bg-white text-left px-4 py-2 text-xs font-semibold"
                  style={{
                    color: 'var(--wd-text-muted)',
                    borderRight: '1px solid var(--wd-border)',
                    borderBottom: '1px solid var(--wd-border)',
                    width: 160,
                    minWidth: 160,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    fontSize: 10,
                  }}
                >
                  Pracownik
                </th>
                {days.map((d) => {
                  const ds = `${year}-${pad(monthNum)}-${pad(d)}`
                  const dow = getDayOfWeek(year, monthNum, d)
                  const isWeekend = isWeekendDay(dow)
                  const isHoliday = holidayMap.has(ds)
                  const isToday = ds === today
                  const holidayName = holidayMap.get(ds)

                  return (
                    <th
                      key={d}
                      style={{
                        width: 28,
                        minWidth: 28,
                        padding: '2px 0',
                        textAlign: 'center',
                        borderRight: '1px solid var(--wd-border)',
                        borderBottom: '1px solid var(--wd-border)',
                        background: isHoliday
                          ? 'rgb(254 242 242)'
                          : isWeekend
                          ? 'var(--wd-surface-2)'
                          : isToday
                          ? 'rgba(228,220,209,0.3)'
                          : 'white',
                        position: 'relative',
                      }}
                    >
                      {/* Holiday name */}
                      {holidayName && (
                        <span
                          title={holidayName}
                          style={{
                            display: 'block',
                            fontSize: 7,
                            color: '#DC2626',
                            lineHeight: '10px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: 26,
                            fontWeight: 600,
                            letterSpacing: '0',
                          }}
                        >
                          {holidayName.slice(0, 3).toUpperCase()}
                        </span>
                      )}
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          fontWeight: isToday ? 800 : isWeekend ? 400 : 600,
                          color: isToday
                            ? 'var(--wd-dark)'
                            : isHoliday
                            ? '#DC2626'
                            : isWeekend
                            ? 'var(--wd-text-muted)'
                            : 'var(--wd-dark)',
                          lineHeight: '16px',
                        }}
                      >
                        {pad(d)}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 9,
                          color: isWeekend || isHoliday ? 'var(--wd-text-muted)' : 'var(--wd-text-muted)',
                          lineHeight: '12px',
                          fontWeight: 500,
                        }}
                      >
                        {PL_DAYS_SHORT[dow]}
                      </span>
                      {/* Today indicator */}
                      {isToday && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            height: 2,
                            background: 'var(--wd-sand)',
                          }}
                        />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {calData.employees.map((emp, idx) => {
                const leaveLookup = buildLeaveLookup(emp)
                const bgRow = idx % 2 === 1 ? 'var(--wd-surface-2)' : 'white'

                return (
                  <tr key={emp.id} style={{ background: bgRow }}>
                    {/* Sticky employee name */}
                    <td
                      className="sticky left-0 z-10"
                      style={{
                        background: bgRow,
                        borderRight: '1px solid var(--wd-border)',
                        borderBottom: '1px solid var(--wd-border)',
                        padding: '0 12px',
                        width: 160,
                        minWidth: 160,
                        height: 30,
                      }}
                    >
                      <span
                        className="text-sm font-medium truncate block"
                        style={{ color: 'var(--wd-dark)', fontSize: 12 }}
                      >
                        {emp.lastName} {emp.firstName.charAt(0)}.
                      </span>
                    </td>

                    {days.map((d) => {
                      const ds = `${year}-${pad(monthNum)}-${pad(d)}`
                      const dow = getDayOfWeek(year, monthNum, d)
                      const weekend = isWeekendDay(dow)
                      const holiday = holidayMap.has(ds)
                      const cellLeave = leaveLookup.get(ds) ?? null

                      return (
                        <CalendarCell
                          key={d}
                          dayStr={ds}
                          cellLeave={cellLeave}
                          employeeName={`${emp.firstName} ${emp.lastName}`}
                          isWeekend={weekend}
                          isHoliday={holiday}
                          isToday={ds === today}
                          filters={filters}
                        />
                      )
                    })}
                  </tr>
                )
              })}

              {calData.employees.length === 0 && (
                <tr>
                  <td
                    colSpan={calData.daysInMonth + 1}
                    className="text-center py-10 text-sm"
                    style={{ color: 'var(--wd-text-muted)' }}
                  >
                    Brak pracowników do wyświetlenia
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div
          className="flex flex-wrap items-center gap-4 px-5 py-3 border-t"
          style={{ borderColor: 'var(--wd-border)' }}
        >
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wd-text-muted)', fontSize: 10 }}>
            Legenda
          </span>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--wd-text-muted)' }}>
            <span className="inline-block w-5 h-3 rounded-sm" style={{ background: '#3B82F6' }} />
            Praca zdalna
          </span>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--wd-text-muted)' }}>
            <span className="inline-block w-5 h-3 rounded-sm" style={{ background: 'var(--wd-surface-2)', border: '1px solid var(--wd-border)' }} />
            Weekend
          </span>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--wd-text-muted)' }}>
            <span className="inline-block w-5 h-3 rounded-sm" style={{ background: 'rgb(254 242 242)' }} />
            Święto
          </span>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--wd-text-muted)' }}>
            <span
              className="inline-block w-5 h-3 rounded-sm"
              style={{ background: '#EF4444', opacity: 0.65, border: '1px dashed #EF4444' }}
            />
            Plan (oczekujący)
          </span>
        </div>
      </div>
    </div>
  )
}
