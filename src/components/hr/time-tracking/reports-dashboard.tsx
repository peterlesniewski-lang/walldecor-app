'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Download, BarChart2, Users, Clock, FolderKanban, TrendingUp, FileText } from 'lucide-react'
import { EmployeeSelect } from '@/components/hr/employees/employee-select'
import { formatDuration } from '@/lib/hr/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Division {
  id: string
  name: string
}

interface Project {
  id: string
  name: string
  code: string
}

interface TimecardEntry {
  date: string
  clockIn: string | null
  clockOut: string | null
  totalMinutes: number
  breakMinutes: number
  netMinutes: number
  overtimeMinutes: number
  status: string
  projectName: string | null
  notes: string | null
}

interface TimecardSummary {
  totalDays: number
  totalMinutes: number
  breakMinutes: number
  netMinutes: number
  overtimeMinutes: number
}

interface TimecardData {
  employee: { id: string; firstName: string; lastName: string }
  month: string
  entries: TimecardEntry[]
  summary: TimecardSummary
}

interface AttendanceEmployee {
  id: string
  firstName: string
  lastName: string
  divisionName: string | null
  presentDays: number
  totalMinutes: number
  netMinutes: number
  overtimeMinutes: number
  absenceDays: number
}

interface OvertimeEmployee {
  employee: { id: string; firstName: string; lastName: string }
  totalOvertimeMinutes: number
  approvedRequests: number
  pendingRequests: number
  timeOffMinutes: number
  paymentMinutes: number
}

interface ProjectRow {
  project: { id: string; name: string; code: string }
  totalMinutes: number
  employees: Array<{ id: string; firstName: string; lastName: string; minutes: number; percentage: number }>
}

interface PlanVsActualRow {
  employee: { id: string; firstName: string; lastName: string }
  plannedMinutes: number
  actualMinutes: number
  diffMinutes: number
  percentage: number
}

interface EmployeeListItem {
  id: string
  firstName: string
  lastName: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PL_MONTHS = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
]

function currentMonthStr(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const days = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb']
  return `${days[d.getDay()]} ${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

function statusBadge(status: string): React.ReactNode {
  const map: Record<string, string> = {
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
    pending: 'bg-amber-100 text-amber-700',
  }
  const labels: Record<string, string> = {
    approved: 'Zatw.',
    rejected: 'Odrzuc.',
    pending: 'Oczek.',
  }
  const cls = map[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {labels[status] ?? status}
    </span>
  )
}

// ─── Sub-components: Skeletons ─────────────────────────────────────────────────

function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <tbody>
          {Array.from({ length: rows }).map((_, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? 'bg-[var(--wd-surface-2)]' : ''}>
              {Array.from({ length: cols }).map((_, ci) => (
                <td key={ci} className="px-4 py-3">
                  <div
                    className="h-3.5 rounded bg-[var(--wd-border)] animate-pulse"
                    style={{ width: ci === 0 ? '80%' : '60%' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ message = 'Brak danych za wybrany okres' }: { message?: string }) {
  return (
    <div className="py-14 text-center">
      <div
        className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
        style={{ background: 'var(--wd-surface-2)' }}
      >
        <BarChart2 size={22} style={{ color: 'var(--wd-text-muted)' }} />
      </div>
      <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>{message}</p>
    </div>
  )
}

// ─── Filter Panel ─────────────────────────────────────────────────────────────

function FilterPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-wrap gap-3 items-end rounded-xl p-4 mb-4"
      style={{ background: 'var(--wd-white)', border: '1px solid var(--wd-border)' }}
    >
      {children}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-[160px]">
      <label className="data-label">{label}</label>
      {children}
    </div>
  )
}

function MonthSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Last 12 months + current
  const options: string[] = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    options.push(`${y}-${m}`)
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20"
    >
      {options.map((opt) => {
        const [y, m] = opt.split('-')
        return (
          <option key={opt} value={opt}>
            {PL_MONTHS[parseInt(m, 10) - 1]} {y}
          </option>
        )
      })}
    </select>
  )
}

function DivisionSelect({
  value,
  onChange,
  divisions,
}: {
  value: string
  onChange: (v: string) => void
  divisions: Division[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20"
    >
      <option value="">Wszystkie oddziały</option>
      {divisions.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  )
}

function ProjectSelect({
  value,
  onChange,
  projects,
}: {
  value: string
  onChange: (v: string) => void
  projects: Project[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20"
    >
      <option value="">Wszystkie projekty</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
      ))}
    </select>
  )
}

function ExportButton({ href, label = 'Eksport CSV' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] transition-colors hover:bg-[var(--wd-surface-2)] text-[var(--wd-text-primary)] no-underline"
      style={{ textDecoration: 'none' }}
    >
      <Download size={14} />
      <span>{label}</span>
    </a>
  )
}

// ─── Tab: Timecard ─────────────────────────────────────────────────────────────

function TimecardTab({ divisions: _divisions }: { divisions: Division[] }) {
  const [month, setMonth] = useState(currentMonthStr())
  const [employeeId, setEmployeeId] = useState<string | undefined>(undefined)
  const [data, setData] = useState<TimecardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!employeeId) { setData(null); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/reports/timecard?employeeId=${employeeId}&month=${month}`)
      if (!res.ok) { setError('Błąd podczas pobierania danych'); return }
      setData(await res.json())
    } catch {
      setError('Błąd sieci')
    } finally {
      setLoading(false)
    }
  }, [employeeId, month])

  useEffect(() => { fetchData() }, [fetchData])

  const exportUrl = employeeId
    ? `/api/hr/reports/export?type=timecard&month=${month}&employeeId=${employeeId}`
    : '#'

  return (
    <div>
      <FilterPanel>
        <FilterField label="Pracownik">
          <div className="w-64">
            <EmployeeSelect value={employeeId} onChange={setEmployeeId} />
          </div>
        </FilterField>
        <FilterField label="Miesiąc">
          <MonthSelect value={month} onChange={setMonth} />
        </FilterField>
        <div className="flex items-end">
          <ExportButton href={exportUrl} />
        </div>
      </FilterPanel>

      {!employeeId && (
        <EmptyState message="Wybierz pracownika, aby wyświetlić kartę czasu pracy" />
      )}

      {employeeId && loading && <TableSkeleton rows={8} cols={9} />}
      {employeeId && error && (
        <div className="py-6 text-center text-sm text-red-600">{error}</div>
      )}

      {employeeId && !loading && !error && data && (
        <>
          {data.entries.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--wd-border)]">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left">Dzień</th>
                    <th className="px-4 py-3 text-left">Wejście</th>
                    <th className="px-4 py-3 text-left">Wyjście</th>
                    <th className="px-4 py-3 text-right">Brutto</th>
                    <th className="px-4 py-3 text-right">Przerwy</th>
                    <th className="px-4 py-3 text-right">Netto</th>
                    <th className="px-4 py-3 text-right">Nadgodz.</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Projekt</th>
                    <th className="px-4 py-3 text-left">Notatki</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e, i) => (
                    <tr
                      key={e.date}
                      className={i % 2 === 1 ? 'bg-[var(--wd-surface-2)]' : ''}
                    >
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="px-4 py-2.5 num whitespace-nowrap">{formatTime(e.clockIn)}</td>
                      <td className="px-4 py-2.5 num whitespace-nowrap">{formatTime(e.clockOut)}</td>
                      <td className="px-4 py-2.5 num text-right">{formatDuration(e.totalMinutes)}</td>
                      <td className="px-4 py-2.5 num text-right text-[var(--wd-text-muted)]">{formatDuration(e.breakMinutes)}</td>
                      <td className="px-4 py-2.5 num text-right font-semibold">{formatDuration(e.netMinutes)}</td>
                      <td className="px-4 py-2.5 num text-right">
                        {e.overtimeMinutes > 0 ? (
                          <span className="text-amber-600">{formatDuration(e.overtimeMinutes)}</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5">{statusBadge(e.status)}</td>
                      <td className="px-4 py-2.5 text-sm text-[var(--wd-text-muted)]">{e.projectName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-[var(--wd-text-muted)] max-w-[160px] truncate">{e.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--wd-border)] font-semibold bg-[var(--wd-surface-2)]">
                    <td className="px-4 py-2.5" colSpan={3}>
                      Razem — {data.summary.totalDays} dni
                    </td>
                    <td className="px-4 py-2.5 num text-right">{formatDuration(data.summary.totalMinutes)}</td>
                    <td className="px-4 py-2.5 num text-right text-[var(--wd-text-muted)]">{formatDuration(data.summary.breakMinutes)}</td>
                    <td className="px-4 py-2.5 num text-right">{formatDuration(data.summary.netMinutes)}</td>
                    <td className="px-4 py-2.5 num text-right text-amber-600">{formatDuration(data.summary.overtimeMinutes)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Tab: Attendance ──────────────────────────────────────────────────────────

function AttendanceTab({ divisions }: { divisions: Division[] }) {
  const [month, setMonth] = useState(currentMonthStr())
  const [divisionId, setDivisionId] = useState('')
  const [data, setData] = useState<AttendanceEmployee[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ month })
      if (divisionId) params.set('divisionId', divisionId)
      const res = await fetch(`/api/hr/reports/attendance?${params}`)
      if (!res.ok) { setError('Błąd podczas pobierania danych'); return }
      const json = await res.json()
      setData(json.employees ?? [])
    } catch {
      setError('Błąd sieci')
    } finally {
      setLoading(false)
    }
  }, [month, divisionId])

  useEffect(() => { fetchData() }, [fetchData])

  const exportUrl = `/api/hr/reports/export?type=attendance&month=${month}${divisionId ? `&divisionId=${divisionId}` : ''}`

  return (
    <div>
      <FilterPanel>
        <FilterField label="Miesiąc">
          <MonthSelect value={month} onChange={setMonth} />
        </FilterField>
        <FilterField label="Oddział">
          <DivisionSelect value={divisionId} onChange={setDivisionId} divisions={divisions} />
        </FilterField>
        <div className="flex items-end">
          <ExportButton href={exportUrl} />
        </div>
      </FilterPanel>

      {loading && <TableSkeleton rows={6} cols={7} />}
      {error && <div className="py-6 text-center text-sm text-red-600">{error}</div>}
      {!loading && !error && (
        data.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto rounded-xl border border-[var(--wd-border)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left">Pracownik</th>
                  <th className="px-4 py-3 text-left">Oddział</th>
                  <th className="px-4 py-3 text-right">Dni obecności</th>
                  <th className="px-4 py-3 text-right">Brutto</th>
                  <th className="px-4 py-3 text-right">Netto</th>
                  <th className="px-4 py-3 text-right">Nadgodziny</th>
                  <th className="px-4 py-3 text-right">Nieobecności</th>
                </tr>
              </thead>
              <tbody>
                {data.map((emp, i) => (
                  <tr key={emp.id} className={i % 2 === 1 ? 'bg-[var(--wd-surface-2)]' : ''}>
                    <td className="px-4 py-2.5 font-medium">{emp.firstName} {emp.lastName}</td>
                    <td className="px-4 py-2.5 text-[var(--wd-text-muted)]">{emp.divisionName ?? '—'}</td>
                    <td className="px-4 py-2.5 num text-right">{emp.presentDays}</td>
                    <td className="px-4 py-2.5 num text-right">{formatDuration(emp.totalMinutes)}</td>
                    <td className="px-4 py-2.5 num text-right font-semibold">{formatDuration(emp.netMinutes)}</td>
                    <td className="px-4 py-2.5 num text-right">
                      {emp.overtimeMinutes > 0 ? (
                        <span className="text-amber-600">{formatDuration(emp.overtimeMinutes)}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5 num text-right">
                      {emp.absenceDays > 0 ? (
                        <span className="text-blue-600">{emp.absenceDays} dni</span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

// ─── Tab: Overtime ────────────────────────────────────────────────────────────

function OvertimeTab({ divisions }: { divisions: Division[] }) {
  const [month, setMonth] = useState(currentMonthStr())
  const [divisionId, setDivisionId] = useState('')
  const [data, setData] = useState<OvertimeEmployee[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ month })
      if (divisionId) params.set('divisionId', divisionId)
      const res = await fetch(`/api/hr/reports/overtime?${params}`)
      if (!res.ok) { setError('Błąd podczas pobierania danych'); return }
      setData(await res.json())
    } catch {
      setError('Błąd sieci')
    } finally {
      setLoading(false)
    }
  }, [month, divisionId])

  useEffect(() => { fetchData() }, [fetchData])

  const exportUrl = `/api/hr/reports/export?type=overtime&month=${month}${divisionId ? `&divisionId=${divisionId}` : ''}`

  return (
    <div>
      <FilterPanel>
        <FilterField label="Miesiąc">
          <MonthSelect value={month} onChange={setMonth} />
        </FilterField>
        <FilterField label="Oddział">
          <DivisionSelect value={divisionId} onChange={setDivisionId} divisions={divisions} />
        </FilterField>
        <div className="flex items-end">
          <ExportButton href={exportUrl} />
        </div>
      </FilterPanel>

      {loading && <TableSkeleton rows={6} cols={6} />}
      {error && <div className="py-6 text-center text-sm text-red-600">{error}</div>}
      {!loading && !error && (
        data.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto rounded-xl border border-[var(--wd-border)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left">Pracownik</th>
                  <th className="px-4 py-3 text-right">Łącznie nadgodzin</th>
                  <th className="px-4 py-3 text-right">Wnioski zatw.</th>
                  <th className="px-4 py-3 text-right">Oczekujące</th>
                  <th className="px-4 py-3 text-right">Czas wolny</th>
                  <th className="px-4 py-3 text-right">Wypłata</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={row.employee.id} className={i % 2 === 1 ? 'bg-[var(--wd-surface-2)]' : ''}>
                    <td className="px-4 py-2.5 font-medium">{row.employee.firstName} {row.employee.lastName}</td>
                    <td className="px-4 py-2.5 num text-right font-semibold">
                      {row.totalOvertimeMinutes > 0
                        ? <span className="text-amber-600">{formatDuration(row.totalOvertimeMinutes)}</span>
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 num text-right">
                      {row.approvedRequests > 0
                        ? <span className="text-emerald-600">{row.approvedRequests}</span>
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 num text-right">
                      {row.pendingRequests > 0
                        ? <span className="text-amber-600">{row.pendingRequests}</span>
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 num text-right">
                      {row.timeOffMinutes > 0 ? formatDuration(row.timeOffMinutes) : '—'}
                    </td>
                    <td className="px-4 py-2.5 num text-right">
                      {row.paymentMinutes > 0 ? formatDuration(row.paymentMinutes) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

// ─── Tab: Projects ─────────────────────────────────────────────────────────────

function ProjectsTab() {
  const [month, setMonth] = useState(currentMonthStr())
  const [projectId, setProjectId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const [data, setData] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/hr/reports/projects?month=' + currentMonthStr())
      .then((r) => r.json())
      .then((rows: ProjectRow[]) => {
        const seen = new Set<string>()
        const projs: Project[] = []
        for (const row of rows) {
          if (!seen.has(row.project.id)) {
            seen.add(row.project.id)
            projs.push(row.project)
          }
        }
        setProjects(projs)
      })
      .catch(() => {})
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ month })
      if (projectId) params.set('projectId', projectId)
      const res = await fetch(`/api/hr/reports/projects?${params}`)
      if (!res.ok) { setError('Błąd podczas pobierania danych'); return }
      setData(await res.json())
    } catch {
      setError('Błąd sieci')
    } finally {
      setLoading(false)
    }
  }, [month, projectId])

  useEffect(() => { fetchData() }, [fetchData])

  const exportUrl = `/api/hr/reports/export?type=projects&month=${month}${projectId ? `&projectId=${projectId}` : ''}`

  return (
    <div>
      <FilterPanel>
        <FilterField label="Miesiąc">
          <MonthSelect value={month} onChange={setMonth} />
        </FilterField>
        <FilterField label="Projekt">
          <ProjectSelect value={projectId} onChange={setProjectId} projects={projects} />
        </FilterField>
        <div className="flex items-end">
          <ExportButton href={exportUrl} />
        </div>
      </FilterPanel>

      {loading && <TableSkeleton rows={6} cols={5} />}
      {error && <div className="py-6 text-center text-sm text-red-600">{error}</div>}
      {!loading && !error && (
        data.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto rounded-xl border border-[var(--wd-border)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left">Projekt</th>
                  <th className="px-4 py-3 text-left">Pracownik</th>
                  <th className="px-4 py-3 text-right">Godziny</th>
                  <th className="px-4 py-3 text-right">% czasu</th>
                  <th className="px-4 py-3 text-right">Łącznie projekt</th>
                </tr>
              </thead>
              <tbody>
                {data.flatMap((row) =>
                  row.employees.map((emp, ei) => (
                    <tr
                      key={`${row.project.id}-${emp.id}`}
                      className={ei % 2 === 1 ? 'bg-[var(--wd-surface-2)]' : ''}
                    >
                      {ei === 0 ? (
                        <td
                          className="px-4 py-2.5 font-semibold align-top"
                          rowSpan={row.employees.length}
                          style={{ borderRight: '1px solid var(--wd-border)' }}
                        >
                          <div>{row.project.name}</div>
                          <div className="text-xs text-[var(--wd-text-muted)] font-normal">{row.project.code}</div>
                        </td>
                      ) : null}
                      <td className="px-4 py-2.5">{emp.firstName} {emp.lastName}</td>
                      <td className="px-4 py-2.5 num text-right">{formatDuration(emp.minutes)}</td>
                      <td className="px-4 py-2.5 num text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div
                            className="h-1.5 rounded-full bg-[var(--wd-sand)]"
                            style={{ width: `${Math.min(emp.percentage, 100) * 0.6}px` }}
                          />
                          <span>{emp.percentage}%</span>
                        </div>
                      </td>
                      {ei === 0 ? (
                        <td
                          className="px-4 py-2.5 num text-right font-semibold align-top"
                          rowSpan={row.employees.length}
                          style={{ borderLeft: '1px solid var(--wd-border)' }}
                        >
                          {formatDuration(row.totalMinutes)}
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

// ─── Tab: Plan vs Actual ───────────────────────────────────────────────────────

function PlanVsActualTab({ divisions }: { divisions: Division[] }) {
  const [month, setMonth] = useState(currentMonthStr())
  const [divisionId, setDivisionId] = useState('')
  const [data, setData] = useState<PlanVsActualRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ month })
      if (divisionId) params.set('divisionId', divisionId)
      const res = await fetch(`/api/hr/reports/plan-vs-actual?${params}`)
      if (!res.ok) { setError('Błąd podczas pobierania danych'); return }
      setData(await res.json())
    } catch {
      setError('Błąd sieci')
    } finally {
      setLoading(false)
    }
  }, [month, divisionId])

  useEffect(() => { fetchData() }, [fetchData])

  const exportUrl = `/api/hr/reports/export?type=plan-vs-actual&month=${month}${divisionId ? `&divisionId=${divisionId}` : ''}`

  return (
    <div>
      <FilterPanel>
        <FilterField label="Miesiąc">
          <MonthSelect value={month} onChange={setMonth} />
        </FilterField>
        <FilterField label="Oddział">
          <DivisionSelect value={divisionId} onChange={setDivisionId} divisions={divisions} />
        </FilterField>
        <div className="flex items-end">
          <ExportButton href={exportUrl} />
        </div>
      </FilterPanel>

      {loading && <TableSkeleton rows={6} cols={5} />}
      {error && <div className="py-6 text-center text-sm text-red-600">{error}</div>}
      {!loading && !error && (
        data.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto rounded-xl border border-[var(--wd-border)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left">Pracownik</th>
                  <th className="px-4 py-3 text-right">Zaplanowane</th>
                  <th className="px-4 py-3 text-right">Przepracowane</th>
                  <th className="px-4 py-3 text-right">Różnica</th>
                  <th className="px-4 py-3 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={row.employee.id} className={i % 2 === 1 ? 'bg-[var(--wd-surface-2)]' : ''}>
                    <td className="px-4 py-2.5 font-medium">
                      {row.employee.firstName} {row.employee.lastName}
                    </td>
                    <td className="px-4 py-2.5 num text-right text-[var(--wd-text-muted)]">
                      {formatDuration(row.plannedMinutes)}
                    </td>
                    <td className="px-4 py-2.5 num text-right font-semibold">
                      {formatDuration(row.actualMinutes)}
                    </td>
                    <td className="px-4 py-2.5 num text-right font-semibold">
                      <span className={row.diffMinutes >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                        {row.diffMinutes >= 0 ? '+' : '−'}{formatDuration(Math.abs(row.diffMinutes))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 num text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-[var(--wd-surface-2)] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${row.percentage >= 100 ? 'bg-emerald-500' : row.percentage >= 80 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${Math.min(row.percentage, 100)}%` }}
                          />
                        </div>
                        <span className={`font-semibold ${row.percentage >= 100 ? 'text-emerald-600' : row.percentage >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                          {row.percentage}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

// ─── Tab: Raport PDF ──────────────────────────────────────────────────────────

function PdfTab() {
  const [month, setMonth] = useState(currentMonthStr())
  const [employeeId, setEmployeeId] = useState('all')
  const [employees, setEmployees] = useState<EmployeeListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/hr/employees')
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : (data.employees ?? [])
        setEmployees(list)
      })
      .catch(() => {})
  }, [])

  async function handleDownload() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/hr/reports/monthly-pdf?month=${month}&employeeId=${employeeId}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError((json as { error?: string }).error ?? 'Błąd generowania PDF')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `raport-${month}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Błąd sieci')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <FilterPanel>
        <FilterField label="Miesiąc">
          <MonthSelect value={month} onChange={setMonth} />
        </FilterField>
        <FilterField label="Pracownik">
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-[var(--wd-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 min-w-[200px]"
          >
            <option value="all">Wszyscy pracownicy</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.firstName} {emp.lastName}
              </option>
            ))}
          </select>
        </FilterField>
        <div className="flex items-end">
          <button
            onClick={handleDownload}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'var(--wd-dark)',
              color: 'var(--wd-white)',
              border: '1px solid var(--wd-dark)',
            }}
          >
            <FileText size={14} />
            <span>{loading ? 'Generowanie…' : 'Generuj i pobierz PDF'}</span>
          </button>
        </div>
      </FilterPanel>

      {error && (
        <div className="py-4 px-4 rounded-xl text-sm text-red-700 bg-red-50 border border-red-200">
          {error}
        </div>
      )}

      {!error && !loading && (
        <div
          className="py-12 text-center rounded-xl border border-dashed"
          style={{ borderColor: 'var(--wd-border)', background: 'var(--wd-surface-2)' }}
        >
          <div
            className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'var(--wd-white)', border: '1px solid var(--wd-border)' }}
          >
            <FileText size={22} style={{ color: 'var(--wd-text-muted)' }} />
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--wd-text-primary)' }}>
            Raport miesięczny ewidencji czasu pracy
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--wd-text-muted)' }}>
            Wybierz miesiąc i pracownika, następnie kliknij „Generuj i pobierz PDF"
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            PDF zawiera dzień po dniu: wejścia, wyjścia, godziny, urlopy, sobotnie nadgodziny
          </p>
        </div>
      )}

      {loading && (
        <div className="py-12 text-center">
          <div
            className="w-8 h-8 rounded-full border-2 border-[var(--wd-dark)] border-t-transparent animate-spin mx-auto mb-3"
          />
          <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Generowanie raportu PDF…
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'timecard', label: 'Karta czasu', icon: Clock },
  { id: 'attendance', label: 'Obecność', icon: Users },
  { id: 'overtime', label: 'Nadgodziny', icon: BarChart2 },
  { id: 'projects', label: 'Projektowy', icon: FolderKanban },
  { id: 'plan-vs-actual', label: 'Plan vs Wykonanie', icon: TrendingUp },
  { id: 'pdf-report', label: 'Raport PDF', icon: FileText },
] as const

type TabId = (typeof TABS)[number]['id']

interface ReportsDashboardProps {
  divisions: Division[]
}

export function ReportsDashboard({ divisions }: ReportsDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('timecard')


  return (
    <div>
      {/* Tab bar */}
      <div
        className="flex gap-0 border-b mb-6"
        style={{ borderColor: 'var(--wd-border)' }}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px whitespace-nowrap ${
                isActive
                  ? 'border-[var(--wd-dark)] text-[var(--wd-dark)]'
                  : 'border-transparent text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)] hover:border-[var(--wd-border)]'
              }`}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'timecard' && <TimecardTab divisions={divisions} />}
        {activeTab === 'attendance' && <AttendanceTab divisions={divisions} />}
        {activeTab === 'overtime' && <OvertimeTab divisions={divisions} />}
        {activeTab === 'projects' && <ProjectsTab />}
        {activeTab === 'plan-vs-actual' && <PlanVsActualTab divisions={divisions} />}
        {activeTab === 'pdf-report' && <PdfTab />}
      </div>
    </div>
  )
}
