'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Calendar, Plus, Check } from 'lucide-react'
import { EmployeeAvatar } from '@/components/hr/employees/employee-avatar'
import { TimeEntryEditModal } from './time-entry-edit-modal'
import { BulkAddModal } from './bulk-add-modal'
import { formatDuration } from '@/lib/hr/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DayEntry {
  id?: string
  clockIn?: string
  clockOut?: string | null
  totalMinutes?: number | null
  status?: string
  leaveType?: string
  leaveColor?: string
}

interface EmployeeRow {
  id: string
  firstName: string
  lastName: string
  divisionId: string | null
  divisionName: string | null
  avatarUrl: string | null
  entries: Record<string, DayEntry>
}

interface WeeklyData {
  weekStart: string
  weekEnd: string
  days: string[]
  employees: EmployeeRow[]
  dailyTotals: Record<string, number>
}

interface Division {
  id: string
  name: string
}

interface WeeklyTimesheetProps {
  userRole: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  divisions: Division[]
  initialWeek: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PL_DAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd']
const PL_MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

function dayLabel(dateStr: string): { dow: string; day: number; month: string } {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  return { dow: PL_DAYS[dow], day: d.getDate(), month: PL_MONTHS[d.getMonth()] }
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00')
  return d.getDay() === 0 || d.getDay() === 6
}

function isToday(dateStr: string): boolean {
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  return dateStr === todayStr
}

function getCurrentIsoWeek(): string {
  const now = new Date()
  const dow = now.getDay() === 0 ? 7 : now.getDay()
  const mon = new Date(now)
  mon.setDate(now.getDate() - dow + 1)
  mon.setHours(0, 0, 0, 0)

  // ISO week number
  const jan4 = new Date(mon.getFullYear(), 0, 4)
  const jan4Dow = jan4.getDay() === 0 ? 7 : jan4.getDay()
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - jan4Dow + 1)
  const weekNum = Math.round((mon.getTime() - week1Mon.getTime()) / (7 * 24 * 3600 * 1000)) + 1
  return `${mon.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

function getAdjacentWeek(week: string, delta: number): string {
  const match = week.match(/^(\d{4})-W(\d{2})$/)
  if (!match) return getCurrentIsoWeek()
  const year = parseInt(match[1], 10)
  const weekNum = parseInt(match[2], 10)

  const jan4 = new Date(year, 0, 4)
  const jan4Dow = jan4.getDay() === 0 ? 7 : jan4.getDay()
  const week1Mon = new Date(jan4)
  week1Mon.setDate(jan4.getDate() - jan4Dow + 1)
  const targetMon = new Date(week1Mon)
  targetMon.setDate(week1Mon.getDate() + (weekNum - 1 + delta) * 7)
  targetMon.setHours(0, 0, 0, 0)

  // Re-compute ISO week for the new date (handles year boundaries)
  const newYear = targetMon.getFullYear()
  const newJan4 = new Date(newYear, 0, 4)
  const newJan4Dow = newJan4.getDay() === 0 ? 7 : newJan4.getDay()
  const newWeek1Mon = new Date(newJan4)
  newWeek1Mon.setDate(newJan4.getDate() - newJan4Dow + 1)
  const newWeekNum = Math.round((targetMon.getTime() - newWeek1Mon.getTime()) / (7 * 24 * 3600 * 1000)) + 1
  return `${newYear}-W${String(newWeekNum).padStart(2, '0')}`
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const s = new Date(weekStart + 'T12:00:00')
  const e = new Date(weekEnd + 'T12:00:00')
  return `${s.getDate()} ${PL_MONTHS[s.getMonth()]} – ${e.getDate()} ${PL_MONTHS[e.getMonth()]} ${e.getFullYear()}`
}

function totalMinutesForEmployee(employee: EmployeeRow, days: string[]): number {
  return days.reduce((sum, d) => sum + (employee.entries[d]?.totalMinutes ?? 0), 0)
}

// ─── Cell rendering ───────────────────────────────────────────────────────────

function EntryCell({
  entry,
  isWknd,
  isCurrentDay,
  onClick,
}: {
  entry: DayEntry | undefined
  isWknd: boolean
  isCurrentDay: boolean
  onClick: () => void
}) {
  if (isWknd) {
    return (
      <td
        onClick={onClick}
        className="text-center align-middle cursor-pointer transition-colors"
        style={{
          background: isCurrentDay ? 'rgba(228,220,209,0.25)' : 'var(--wd-surface-2)',
          padding: '6px 4px',
          minWidth: '68px',
          borderRight: '1px solid var(--wd-border)',
        }}
      >
        <span className="text-[var(--wd-text-muted)] text-xs">—</span>
      </td>
    )
  }

  if (!entry || (!entry.id && !entry.leaveType)) {
    return (
      <td
        onClick={onClick}
        className="text-center align-middle cursor-pointer hover:bg-[var(--wd-off-white)] transition-colors group"
        style={{
          background: isCurrentDay ? 'rgba(228,220,209,0.15)' : 'transparent',
          padding: '6px 4px',
          minWidth: '68px',
          borderRight: '1px solid var(--wd-border)',
        }}
      >
        <span
          className="text-[var(--wd-text-muted)] text-xs group-hover:opacity-60"
        >—</span>
      </td>
    )
  }

  const isLeave = entry.status === 'leave' && !entry.id
  const isApproved = entry.status === 'approved'

  return (
    <td
      onClick={onClick}
      className="align-middle cursor-pointer transition-colors hover:brightness-95"
      style={{
        background: isCurrentDay ? 'rgba(228,220,209,0.15)' : 'transparent',
        padding: '6px 4px',
        minWidth: '68px',
        borderRight: '1px solid var(--wd-border)',
      }}
    >
      <div className="flex flex-col items-center gap-0.5">
        {/* Leave badge */}
        {isLeave && entry.leaveType && (
          <span
            className="px-1.5 py-0.5 rounded text-xs font-medium leading-tight"
            style={{
              background: entry.leaveColor ? `${entry.leaveColor}20` : '#EFF6FF',
              color: entry.leaveColor ?? '#3B82F6',
              border: `1px solid ${entry.leaveColor ? `${entry.leaveColor}40` : '#BFDBFE'}`,
            }}
          >
            {entry.leaveType.length > 8 ? entry.leaveType.slice(0, 7) + '…' : entry.leaveType}
          </span>
        )}

        {/* Time entry */}
        {entry.id && (
          <>
            <span
              className="text-xs font-semibold num leading-tight"
              style={{ color: isApproved ? '#16A34A' : 'var(--wd-text-primary)' }}
            >
              {entry.totalMinutes ? formatDuration(entry.totalMinutes) : '?h'}
            </span>
            {isApproved && (
              <Check className="w-3 h-3 text-emerald-500 mt-0.5" />
            )}
            {entry.leaveType && (
              <span
                className="px-1 py-px rounded text-[10px] font-medium"
                style={{
                  background: entry.leaveColor ? `${entry.leaveColor}15` : '#EFF6FF',
                  color: entry.leaveColor ?? '#3B82F6',
                }}
              >
                {entry.leaveType.length > 6 ? entry.leaveType.slice(0, 5) + '…' : entry.leaveType}
              </span>
            )}
          </>
        )}
      </div>
    </td>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function WeeklyTimesheet({ userRole, divisions, initialWeek }: WeeklyTimesheetProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const currentWeek = searchParams.get('week') ?? initialWeek ?? getCurrentIsoWeek()
  const [divisionFilter, setDivisionFilter] = useState(searchParams.get('divisionId') ?? '')
  const [data, setData] = useState<WeeklyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState<{
    employeeId: string
    employeeName: string
    date: string
    entry: DayEntry | null
  } | null>(null)
  const [bulkModal, setBulkModal] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ week: currentWeek })
      if (divisionFilter) params.set('divisionId', divisionFilter)
      const res = await fetch(`/api/hr/time-tracking/weekly?${params.toString()}`)
      if (!res.ok) return
      const json = await res.json() as WeeklyData
      setData(json)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [currentWeek, divisionFilter])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const navigateWeek = (delta: number) => {
    const newWeek = getAdjacentWeek(currentWeek, delta)
    const params = new URLSearchParams(searchParams.toString())
    params.set('week', newWeek)
    router.push(`?${params.toString()}`)
  }

  const goToday = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('week', getCurrentIsoWeek())
    router.push(`?${params.toString()}`)
  }

  const handleDivisionChange = (val: string) => {
    setDivisionFilter(val)
    const params = new URLSearchParams(searchParams.toString())
    if (val) params.set('divisionId', val)
    else params.delete('divisionId')
    router.push(`?${params.toString()}`)
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div
          className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--wd-sand)', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  const { days, employees, dailyTotals, weekStart, weekEnd } = data

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Division filter */}
        <select
          value={divisionFilter}
          onChange={(e) => handleDivisionChange(e.target.value)}
          className="px-3 py-2 rounded-lg border text-sm"
          style={{
            borderColor: 'var(--wd-border)',
            background: 'var(--wd-white)',
            color: 'var(--wd-text-primary)',
          }}
        >
          <option value="">Wszystkie oddziały</option>
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        {/* Week navigation */}
        <div
          className="flex items-center gap-1 rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-white)' }}
        >
          <button
            onClick={() => navigateWeek(-1)}
            className="p-2 hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" style={{ color: 'var(--wd-text-muted)' }} />
          </button>
          <div
            className="px-4 py-2 text-sm font-medium border-x"
            style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-text-primary)', minWidth: '200px', textAlign: 'center' }}
          >
            {formatWeekLabel(weekStart, weekEnd)}
          </div>
          <button
            onClick={() => navigateWeek(1)}
            className="p-2 hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <ChevronRight className="w-4 h-4" style={{ color: 'var(--wd-text-muted)' }} />
          </button>
        </div>

        {/* Today button */}
        <button
          onClick={goToday}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors hover:bg-[var(--wd-surface-2)]"
          style={{ borderColor: 'var(--wd-border)', color: 'var(--wd-text-muted)' }}
        >
          <Calendar className="w-3.5 h-3.5" />
          Dziś
        </button>

        <div className="flex-1" />

        {/* Bulk add */}
        {(userRole === 'ADMIN' || userRole === 'MANAGER') && (
          <button
            onClick={() => setBulkModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{ background: 'var(--wd-dark)', color: '#fff' }}
          >
            <Plus className="w-4 h-4" />
            Dodaj zbiorczo
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div
        className="rounded-xl overflow-hidden border"
        style={{
          border: '1px solid var(--wd-border)',
          background: 'var(--wd-white)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <div className="overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ background: 'var(--wd-surface-2)', borderBottom: '2px solid var(--wd-border)' }}>
                {/* Employee column */}
                <th
                  className="text-left"
                  style={{
                    padding: '10px 12px',
                    fontWeight: 600,
                    fontSize: '0.6875rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--wd-text-muted)',
                    minWidth: '180px',
                    borderRight: '1px solid var(--wd-border)',
                  }}
                >
                  Pracownik
                </th>

                {/* Day columns */}
                {days.map((day) => {
                  const { dow, day: d, month } = dayLabel(day)
                  const isSunday = new Date(day + 'T12:00:00').getDay() === 0
                  const today = isToday(day)
                  return (
                    <th
                      key={day}
                      className="text-center"
                      style={{
                        padding: '8px 4px',
                        fontWeight: 600,
                        fontSize: '0.6875rem',
                        color: today ? 'var(--wd-dark)' : 'var(--wd-text-muted)',
                        background: today ? 'rgba(228,220,209,0.3)' : isSunday ? 'var(--wd-surface-2)' : undefined,
                        minWidth: '68px',
                        borderRight: '1px solid var(--wd-border)',
                      }}
                    >
                      <div style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>{dow}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.75rem', color: today ? 'var(--wd-dark)' : undefined }}>
                        {d} {month}
                      </div>
                    </th>
                  )
                })}

                {/* Total column */}
                <th
                  className="text-center"
                  style={{
                    padding: '10px 12px',
                    fontWeight: 600,
                    fontSize: '0.6875rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--wd-text-muted)',
                    minWidth: '80px',
                  }}
                >
                  Łącznie
                </th>
              </tr>
            </thead>

            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td
                    colSpan={days.length + 2}
                    className="text-center py-12"
                    style={{ color: 'var(--wd-text-muted)' }}
                  >
                    Brak pracowników do wyświetlenia
                  </td>
                </tr>
              ) : (
                employees.map((emp) => {
                  const weekTotal = totalMinutesForEmployee(emp, days)
                  return (
                    <tr
                      key={emp.id}
                      className="border-b hover:bg-[var(--wd-off-white)] transition-colors"
                      style={{ borderColor: 'var(--wd-border)' }}
                    >
                      {/* Employee info */}
                      <td
                        style={{
                          padding: '8px 12px',
                          borderRight: '1px solid var(--wd-border)',
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          <EmployeeAvatar
                            firstName={emp.firstName}
                            lastName={emp.lastName}
                            size="sm"
                            avatarUrl={emp.avatarUrl}
                          />
                          <div>
                            <div className="font-medium text-xs leading-tight" style={{ color: 'var(--wd-text-primary)' }}>
                              {emp.lastName} {emp.firstName[0]}.
                            </div>
                            {emp.divisionName && (
                              <div className="text-[10px] leading-tight mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
                                {emp.divisionName}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Day cells */}
                      {days.map((day) => (
                        <EntryCell
                          key={day}
                          entry={emp.entries[day]}
                          isWknd={new Date(day + 'T12:00:00').getDay() === 0}  // Sunday only
                          isCurrentDay={isToday(day)}
                          onClick={() => {
                            const dayOfWeek = new Date(day + 'T12:00:00').getDay()
                            if (dayOfWeek === 0) return  // Block Sunday only; Saturday is clickable
                            setEditModal({
                              employeeId: emp.id,
                              employeeName: `${emp.firstName} ${emp.lastName}`,
                              date: day,
                              entry: emp.entries[day] ?? null,
                            })
                          }}
                        />
                      ))}

                      {/* Weekly total */}
                      <td
                        className="text-center"
                        style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem' }}
                      >
                        {weekTotal > 0 ? (
                          <span className="num" style={{ color: 'var(--wd-text-primary)' }}>
                            {formatDuration(weekTotal)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--wd-text-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>

            {/* Daily totals footer */}
            <tfoot>
              <tr style={{ background: 'var(--wd-surface-2)', borderTop: '2px solid var(--wd-border)' }}>
                <td
                  style={{
                    padding: '8px 12px',
                    fontWeight: 700,
                    fontSize: '0.6875rem',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--wd-text-muted)',
                    borderRight: '1px solid var(--wd-border)',
                  }}
                >
                  Suma
                </td>
                {days.map((day) => {
                  const total = dailyTotals[day] ?? 0
                  const wknd = isWeekend(day)
                  return (
                    <td
                      key={day}
                      className="text-center"
                      style={{
                        padding: '8px 4px',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        color: wknd ? 'var(--wd-text-muted)' : total > 0 ? 'var(--wd-text-primary)' : 'var(--wd-text-muted)',
                        borderRight: '1px solid var(--wd-border)',
                      }}
                    >
                      {total > 0 ? <span className="num">{formatDuration(total)}</span> : '—'}
                    </td>
                  )
                })}
                <td
                  className="text-center"
                  style={{
                    padding: '8px 12px',
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    color: 'var(--wd-text-primary)',
                  }}
                >
                  <span className="num">
                    {formatDuration(Object.values(dailyTotals).reduce((a, b) => a + b, 0))}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Employee count */}
      <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
        {employees.length} {employees.length === 1 ? 'pracownik' : 'pracowników'} · tydzień {currentWeek}
      </p>

      {/* ── Edit Modal ── */}
      {editModal && (
        <TimeEntryEditModal
          employeeId={editModal.employeeId}
          employeeName={editModal.employeeName}
          date={editModal.date}
          entry={editModal.entry}
          userRole={userRole}
          onClose={() => setEditModal(null)}
          onSaved={() => void fetchData()}
        />
      )}

      {/* ── Bulk Modal ── */}
      {bulkModal && (
        <BulkAddModal
          weekStart={weekStart}
          weekEnd={weekEnd}
          employees={employees}
          onClose={() => setBulkModal(false)}
          onCreated={() => void fetchData()}
        />
      )}
    </div>
  )
}
