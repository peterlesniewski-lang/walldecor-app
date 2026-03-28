'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays, LayoutTemplate, Copy, Plus } from 'lucide-react'
import { EmployeeAvatar } from '@/components/hr/employees/employee-avatar'
import { ScheduleEntryModal } from './schedule-entry-modal'
import { ScheduleTemplateModal } from './schedule-template-modal'
import { ScheduleCopyModal } from './schedule-copy-modal'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleEntry {
  id: string
  startTime: string
  endTime: string
  breakMinutes: number
  type: 'regular' | 'overtime' | 'on-call'
}

export interface LeaveInfo {
  name: string
  color: string
  code: string
}

export interface EmployeeRow {
  id: string
  firstName: string
  lastName: string
  divisionId: string | null
  schedules: Record<string, ScheduleEntry>
  leaves: Record<string, LeaveInfo>
}

export interface Division {
  id: string
  name: string
}

interface ScheduleCalendarProps {
  userRole: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  divisions: Division[]
  initialMonth: string // "YYYY-MM"
  employees: EmployeeRow[]
  holidays: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PL_MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]
const PL_DAYS_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb']

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

function parseMonth(month: string): { year: number; monthIdx: number; days: number } {
  const [y, m] = month.split('-').map(Number)
  return { year: y, monthIdx: m - 1, days: new Date(y, m, 0).getDate() }
}

function calcWorkMinutes(startTime: string, endTime: string, breakMinutes: number): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const total = (eh * 60 + em) - (sh * 60 + sm)
  return Math.max(0, total - breakMinutes)
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}h${m}m`
}

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

function isToday(iso: string): boolean {
  const now = new Date()
  return iso === toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

// ─── Day Cell ─────────────────────────────────────────────────────────────────

interface DayCellProps {
  dateIso: string
  isWeekend: boolean
  isHoliday: boolean
  schedule?: ScheduleEntry
  leave?: LeaveInfo
  onEdit: (dateIso: string, schedule?: ScheduleEntry) => void
}

function DayCell({ dateIso, isWeekend, isHoliday, schedule, leave, onEdit }: DayCellProps) {
  if (leave) {
    return (
      <div
        className="h-full min-h-[52px] flex flex-col items-center justify-center px-1 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity"
        style={{ background: leave.color + '22', border: `1px solid ${leave.color}55` }}
        onClick={() => onEdit(dateIso, schedule)}
        title={leave.name}
      >
        <span className="text-[10px] font-semibold leading-tight text-center" style={{ color: leave.color }}>
          {leave.code}
        </span>
        <span className="text-[9px] leading-tight text-center" style={{ color: leave.color + 'cc' }}>
          urlop
        </span>
      </div>
    )
  }

  if (isHoliday) {
    return (
      <div className="h-full min-h-[52px] flex flex-col items-center justify-center px-1 py-1 rounded"
        style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
        <span className="text-[9px] font-medium text-red-500 text-center leading-tight">święto</span>
      </div>
    )
  }

  if (isWeekend) {
    return (
      <div className="h-full min-h-[52px] flex items-center justify-center px-1 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity"
        style={{ background: 'var(--wd-surface-2)' }}
        onClick={() => onEdit(dateIso, schedule)}>
        {schedule ? (
          <div className="flex flex-col items-center">
            <span className="text-[10px] font-semibold" style={{ color: 'var(--wd-dark)' }}>
              {schedule.startTime}–{schedule.endTime}
            </span>
            <span className="text-[9px]" style={{ color: '#f97316' }}>
              +{fmtHours(calcWorkMinutes(schedule.startTime, schedule.endTime, schedule.breakMinutes))}
            </span>
          </div>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--wd-border)' }}>—</span>
        )}
      </div>
    )
  }

  if (schedule) {
    const mins = calcWorkMinutes(schedule.startTime, schedule.endTime, schedule.breakMinutes)
    const isOvertime = schedule.type === 'overtime' || mins > 480
    const isOnCall = schedule.type === 'on-call'

    if (isOnCall) {
      return (
        <div
          className="h-full min-h-[52px] flex flex-col items-center justify-center px-1 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity"
          style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}
          onClick={() => onEdit(dateIso, schedule)}
        >
          <span className="text-[10px] font-semibold text-blue-700">{schedule.startTime}–{schedule.endTime}</span>
          <span className="text-[9px] text-blue-500">{fmtHours(mins)} dyżur</span>
        </div>
      )
    }

    if (isOvertime) {
      return (
        <div
          className="h-full min-h-[52px] flex flex-col items-center justify-center px-1 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity"
          style={{ background: '#FFF7ED', border: '1px solid #FED7AA' }}
          onClick={() => onEdit(dateIso, schedule)}
        >
          <span className="text-[10px] font-semibold text-orange-800">{schedule.startTime}–{schedule.endTime}</span>
          <span className="text-[9px] text-orange-600">{fmtHours(mins)} +OT</span>
        </div>
      )
    }

    return (
      <div
        className="h-full min-h-[52px] flex flex-col items-center justify-center px-1 py-1 rounded cursor-pointer hover:opacity-80 transition-opacity"
        style={{ background: 'var(--wd-dark)', color: '#fff' }}
        onClick={() => onEdit(dateIso, schedule)}
      >
        <span className="text-[10px] font-semibold">{schedule.startTime}–{schedule.endTime}</span>
        <span className="text-[9px] opacity-70">{fmtHours(mins)}</span>
      </div>
    )
  }

  // Empty — workday, no schedule
  return (
    <div
      className="h-full min-h-[52px] flex items-center justify-center rounded cursor-pointer transition-colors group"
      style={{ border: '1.5px dashed var(--wd-border)' }}
      onClick={() => onEdit(dateIso, undefined)}
    >
      <Plus size={12} className="opacity-0 group-hover:opacity-40 transition-opacity" style={{ color: 'var(--wd-dark)' }} />
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ScheduleCalendar({
  userRole,
  divisions,
  initialMonth,
  employees: initialEmployees,
  holidays: initialHolidays,
}: ScheduleCalendarProps) {
  const [month, setMonth] = useState(initialMonth)
  const [divisionId, setDivisionId] = useState('')
  const [employees, setEmployees] = useState<EmployeeRow[]>(initialEmployees)
  const [holidays, setHolidays] = useState<string[]>(initialHolidays)
  const [loading, setLoading] = useState(false)

  // Modals
  const [entryModal, setEntryModal] = useState<{
    open: boolean
    dateIso: string
    employeeId: string
    employeeName: string
    schedule?: ScheduleEntry
  } | null>(null)
  const [templateModal, setTemplateModal] = useState(false)
  const [copyModal, setCopyModal] = useState(false)

  const { year, monthIdx, days } = parseMonth(month)

  const fetchData = useCallback(async (m: string, div: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ month: m })
      if (div) params.set('divisionId', div)
      const res = await fetch(`/api/hr/schedules?${params}`)
      if (res.ok) {
        const data = await res.json()
        setEmployees(data.employees)
        setHolidays(data.holidays)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Refetch on month/division change (not on mount — server already provided initial data)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (!mounted) { setMounted(true); return }
    fetchData(month, divisionId)
  }, [month, divisionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const holidaySet = new Set(holidays)

  // Day list
  const dayList = Array.from({ length: days }, (_, i) => {
    const d = i + 1
    const iso = toIso(year, monthIdx + 1, d)
    const jsDate = new Date(year, monthIdx, d)
    const dow = jsDate.getDay()
    return {
      d,
      iso,
      dow,
      isWeekend: dow === 0 || dow === 6,
      isHoliday: holidaySet.has(iso),
      isToday: isToday(iso),
      label: PL_DAYS_SHORT[dow],
    }
  })

  function handleEditEntry(empId: string, empName: string, dateIso: string, schedule?: ScheduleEntry) {
    setEntryModal({ open: true, dateIso, employeeId: empId, employeeName: empName, schedule })
  }

  async function handleSaveEntry(data: {
    employeeId: string
    dateIso: string
    startTime: string
    endTime: string
    breakMinutes: number
    type: string
  }) {
    const res = await fetch('/api/hr/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: data.employeeId,
        date: data.dateIso,
        startTime: data.startTime,
        endTime: data.endTime,
        breakMinutes: data.breakMinutes,
        type: data.type,
      }),
    })
    if (res.ok) {
      await fetchData(month, divisionId)
      setEntryModal(null)
    }
    return res.ok
  }

  async function handleDeleteEntry(id: string) {
    const res = await fetch(`/api/hr/schedules?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      await fetchData(month, divisionId)
      setEntryModal(null)
    }
  }

  const canEdit = userRole === 'ADMIN' || userRole === 'MANAGER'

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Month nav */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth(m => shiftMonth(m, -1))}
            className="p-1.5 rounded-md hover:bg-[var(--wd-surface-2)] transition-colors"
            title="Poprzedni miesiąc"
          >
            <ChevronLeft size={16} style={{ color: 'var(--wd-dark)' }} />
          </button>
          <span className="text-sm font-semibold min-w-[140px] text-center" style={{ color: 'var(--wd-dark)' }}>
            {PL_MONTHS[monthIdx]} {year}
          </span>
          <button
            onClick={() => setMonth(m => shiftMonth(m, 1))}
            className="p-1.5 rounded-md hover:bg-[var(--wd-surface-2)] transition-colors"
            title="Następny miesiąc"
          >
            <ChevronRight size={16} style={{ color: 'var(--wd-dark)' }} />
          </button>
        </div>

        {/* Today button */}
        <button
          onClick={() => setMonth(getCurrentMonth())}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-[var(--wd-surface-2)]"
          style={{ color: 'var(--wd-dark)', border: '1px solid var(--wd-border)' }}
        >
          <CalendarDays size={13} />
          Dziś
        </button>

        {/* Division filter */}
        {divisions.length > 0 && (
          <select
            value={divisionId}
            onChange={e => setDivisionId(e.target.value)}
            className="text-xs px-3 py-1.5 rounded-md border focus:outline-none focus:ring-1 focus:ring-[var(--wd-sand)]"
            style={{
              background: 'var(--wd-white)',
              borderColor: 'var(--wd-border)',
              color: 'var(--wd-dark)',
            }}
          >
            <option value="">Wszystkie oddziały</option>
            {divisions.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}

        {canEdit && (
          <div className="flex items-center gap-2 ml-auto">
            {/* Template */}
            <button
              onClick={() => setTemplateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:opacity-90"
              style={{ background: 'var(--wd-sand)', color: 'var(--wd-dark)' }}
            >
              <LayoutTemplate size={13} />
              Szablon
            </button>
            {/* Copy */}
            <button
              onClick={() => setCopyModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: 'var(--wd-white)',
                border: '1px solid var(--wd-border)',
                color: 'var(--wd-dark)',
              }}
            >
              <Copy size={13} />
              Kopiuj grafik
            </button>
          </div>
        )}
      </div>

      {/* ── Calendar Grid ── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--wd-border)', background: 'var(--wd-white)' }}
      >
        <div className={`overflow-x-auto ${loading ? 'opacity-60 pointer-events-none' : ''} transition-opacity`}>
          <table className="w-full border-collapse" style={{ minWidth: `${Math.max(900, days * 80 + 180)}px` }}>
            <thead>
              <tr style={{ background: 'var(--wd-surface-2)' }}>
                {/* Employee column header */}
                <th
                  className="text-left text-xs font-semibold px-3 py-2 sticky left-0 z-10"
                  style={{
                    background: 'var(--wd-surface-2)',
                    color: 'var(--wd-dark)',
                    minWidth: '160px',
                    borderRight: '1px solid var(--wd-border)',
                    borderBottom: '1px solid var(--wd-border)',
                  }}
                >
                  Pracownik
                </th>
                {/* Day columns */}
                {dayList.map(({ d, iso, dow, isWeekend, isHoliday, isToday: isTd, label }) => (
                  <th
                    key={iso}
                    className="text-center px-1 py-1.5 text-xs"
                    style={{
                      minWidth: '76px',
                      borderBottom: isTd
                        ? '2px solid var(--wd-sand)'
                        : '1px solid var(--wd-border)',
                      borderRight: '1px solid var(--wd-border)',
                      background: isHoliday
                        ? '#FEF2F2'
                        : isWeekend
                        ? 'var(--wd-surface-2)'
                        : 'var(--wd-surface-2)',
                      color: isHoliday ? '#DC2626' : isWeekend ? '#94A3B8' : 'var(--wd-dark)',
                      fontWeight: isTd ? 700 : 500,
                    }}
                  >
                    <div>{d}</div>
                    <div className="text-[10px] font-normal opacity-70">{label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td
                    colSpan={days + 1}
                    className="text-center py-12 text-sm"
                    style={{ color: '#94A3B8' }}
                  >
                    Brak pracowników do wyświetlenia
                  </td>
                </tr>
              ) : (
                employees.map((emp, rowIdx) => (
                  <tr
                    key={emp.id}
                    style={{
                      background: rowIdx % 2 === 0 ? 'var(--wd-white)' : 'var(--wd-surface-2)',
                      borderBottom: '1px solid var(--wd-border)',
                    }}
                  >
                    {/* Employee name cell */}
                    <td
                      className="px-3 py-1.5 sticky left-0 z-10"
                      style={{
                        background: rowIdx % 2 === 0 ? 'var(--wd-white)' : 'var(--wd-surface-2)',
                        borderRight: '1px solid var(--wd-border)',
                        minWidth: '160px',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <EmployeeAvatar
                          firstName={emp.firstName}
                          lastName={emp.lastName}
                          avatarUrl={null}
                          size="sm"
                        />
                        <span className="text-xs font-medium truncate" style={{ color: 'var(--wd-dark)' }}>
                          {emp.lastName.slice(0, 8)}{emp.lastName.length > 8 ? '.' : ''}&nbsp;{emp.firstName.slice(0, 1)}.
                        </span>
                      </div>
                    </td>
                    {/* Day cells */}
                    {dayList.map(({ iso, isWeekend, isHoliday }) => (
                      <td
                        key={iso}
                        className="p-1"
                        style={{
                          borderRight: '1px solid var(--wd-border)',
                          verticalAlign: 'top',
                        }}
                      >
                        <DayCell
                          dateIso={iso}
                          isWeekend={isWeekend}
                          isHoliday={isHoliday}
                          schedule={emp.schedules[iso]}
                          leave={emp.leaves[iso]}
                          onEdit={canEdit ? (dateIso, sched) => handleEditEntry(emp.id, `${emp.firstName} ${emp.lastName}`, dateIso, sched) : () => {}}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div
          className="flex flex-wrap gap-4 px-4 py-2.5 border-t text-xs"
          style={{ borderColor: 'var(--wd-border)', color: '#64748B' }}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded" style={{ background: 'var(--wd-dark)', display: 'inline-block' }} />
            Regularne
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-orange-300 bg-orange-100 inline-block" />
            Nadgodziny
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-blue-200 bg-blue-50 inline-block" />
            Dyżur
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-red-200 bg-red-50 inline-block" />
            Święto
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded border border-dashed inline-block" style={{ borderColor: 'var(--wd-border)' }} />
            Brak grafiku (kliknij, aby dodać)
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {entryModal && (
        <ScheduleEntryModal
          open={entryModal.open}
          dateIso={entryModal.dateIso}
          employeeId={entryModal.employeeId}
          employeeName={entryModal.employeeName}
          schedule={entryModal.schedule}
          onClose={() => setEntryModal(null)}
          onSave={handleSaveEntry}
          onDelete={handleDeleteEntry}
        />
      )}

      {templateModal && (
        <ScheduleTemplateModal
          open={templateModal}
          employees={employees}
          currentMonth={month}
          onClose={() => setTemplateModal(false)}
          onApplied={() => { setTemplateModal(false); fetchData(month, divisionId) }}
        />
      )}

      {copyModal && (
        <ScheduleCopyModal
          open={copyModal}
          employees={employees}
          currentMonth={month}
          onClose={() => setCopyModal(false)}
          onCopied={() => { setCopyModal(false); fetchData(month, divisionId) }}
        />
      )}
    </div>
  )
}
