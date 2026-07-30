import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ManagerTimesheet } from '@/components/hr/time-tracking/manager-timesheet'
import { ClockWidget } from '@/components/hr/time-tracking/clock-widget'
import { getWeekRange, getMonthRange, formatDuration } from '@/lib/hr/utils'
import { getHrSettings } from '@/lib/hr/hr-settings'

const DAYS_PL = ['Nie', 'Pon', 'Wto', 'Śro', 'Czw', 'Pią', 'Sob']

function formatTime(date: Date | null | string): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
}

function formatDateShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return `${DAYS_PL[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface SearchParams {
  view?: 'week' | 'month'
  mode?: 'team' | 'employee'
  week?: string
  month?: string
  employeeId?: string
  divisionId?: string
}

export default async function TimeTrackingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const sp = await searchParams
  const role = session.user.role
  const now = new Date()

  // ── ADMIN / MANAGER → manager time views ───────────────────────────────────
  if (role === 'ADMIN' || role === 'MANAGER') {
    const managerDivisionId =
      role === 'MANAGER' && session.user.employeeId
        ? (await prisma.employee.findUnique({
            where: { id: session.user.employeeId },
            select: { divisionId: true },
          }))?.divisionId ?? null
        : null
    const [divisions, hrSettings] = await Promise.all([
      prisma.division.findMany({
        where: role === 'MANAGER' ? { id: managerDivisionId ?? '__hr_no_division_access__' } : {},
        orderBy: { name: 'asc' },
      }),
      getHrSettings(),
    ])

    return (
      <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">Ewidencja czasu pracy</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
              Tygodniowa i miesięczna ewidencja czasu pracy
            </p>
          </div>
        </div>
        <Suspense fallback={
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--wd-sand)', borderTopColor: 'transparent' }} />
          </div>
        }>
          <ManagerTimesheet
            userRole={role}
            divisions={divisions}
            initialView={sp.view === 'month' ? 'month' : 'week'}
            initialMode={sp.mode === 'employee' ? 'employee' : 'team'}
            initialWeek={sp.week ?? null}
            initialMonth={sp.month ?? null}
            initialEmployeeId={sp.employeeId ?? null}
            saturdayWorkable={hrSettings.saturdayWorkable}
          />
        </Suspense>
      </div>
    )
  }

  // ── EMPLOYEE → personal dashboard ─────────────────────────────────────────
  const employee = await prisma.employee.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  })

  if (!employee) {
    return (
      <div className="p-6 lg:p-8">
        <div className="rounded-xl px-6 py-10 text-center" style={{ background: '#fff', border: '1px solid var(--wd-border)' }}>
          <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
            Twoje konto nie jest powiązane z kartą pracownika.
          </p>
        </div>
      </div>
    )
  }

  // ── Week data ──────────────────────────────────────────────────────────────
  const { start: weekStart, end: weekEnd } = getWeekRange(now)
  const weekEntries = await prisma.timeEntry.findMany({
    where: {
      employeeId: employee.id,
      date: { gte: weekStart, lte: weekEnd },
    },
    include: { breaks: true },
    orderBy: { date: 'asc' },
  })

  const weekTotalMinutes = weekEntries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0)
  const weekBreakMinutes = weekEntries.reduce((sum, e) => sum + (e.breakMinutes ?? 0), 0)

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayEntry = weekEntries.find((e) => {
    const d = new Date(e.date)
    d.setHours(0, 0, 0, 0)
    return d.getTime() === today.getTime()
  })

  // ── Month data ─────────────────────────────────────────────────────────────
  const { start: monthStart, end: monthEnd } = getMonthRange(now.getFullYear(), now.getMonth() + 1)
  const monthEntries = await prisma.timeEntry.findMany({
    where: {
      employeeId: employee.id,
      date: { gte: monthStart, lte: monthEnd },
      clockOut: { not: null },
    },
  })

  const monthTotalMinutes = monthEntries.reduce((sum, e) => sum + (e.totalMinutes ?? 0), 0)
  const monthBreakMinutes = monthEntries.reduce((sum, e) => sum + (e.breakMinutes ?? 0), 0)
  const monthOvertimeMinutes = monthEntries.reduce((sum, e) => sum + e.overtimeMinutes, 0)
  const monthNetMinutes = monthTotalMinutes - monthBreakMinutes

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--wd-dark)' }}>
          Czas pracy
        </h1>
        <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
          Ewidencja i monitoring czasu pracy
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Clock widget column */}
        <div className="lg:col-span-1">
          <ClockWidget
            employeeId={employee.id}
            weekStats={{
              totalMinutes: weekTotalMinutes,
              breakMinutes: weekBreakMinutes,
              todayMinutes: todayEntry?.totalMinutes ?? 0,
              todayBreakMinutes: todayEntry?.breakMinutes ?? 0,
            }}
          />
        </div>

        {/* Data columns */}
        <div className="lg:col-span-2 space-y-5">
          {/* Month summary */}
          <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid var(--wd-border)', boxShadow: 'var(--card-shadow)' }}>
            <p className="data-label mb-4">
              {now.toLocaleString('pl-PL', { month: 'long', year: 'numeric' })}
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="data-label mb-1">Brutto</p>
                <p className="text-xl font-light num" style={{ color: '#1E1E1E' }}>{formatDuration(monthTotalMinutes)}</p>
              </div>
              <div>
                <p className="data-label mb-1">Netto</p>
                <p className="text-xl font-light num" style={{ color: '#1E1E1E' }}>{formatDuration(monthNetMinutes)}</p>
              </div>
              <div>
                <p className="data-label mb-1">Nadgodziny</p>
                <p className="text-xl font-light num" style={{ color: monthOvertimeMinutes > 0 ? '#D97706' : '#1E1E1E' }}>
                  {formatDuration(monthOvertimeMinutes)}
                </p>
              </div>
            </div>
          </div>

          {/* Week table */}
          <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid var(--wd-border)', boxShadow: 'var(--card-shadow)' }}>
            <div className="px-5 pt-5 pb-3">
              <p className="data-label">Bieżący tydzień</p>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Dzień</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th className="text-right">Brutto</th>
                  <th className="text-right">Przerwy</th>
                  <th className="text-right">Netto</th>
                </tr>
              </thead>
              <tbody>
                {weekEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6" style={{ color: 'var(--wd-text-muted)' }}>
                      Brak wpisów w tym tygodniu
                    </td>
                  </tr>
                ) : (
                  weekEntries.map((e) => {
                    const net = (e.totalMinutes ?? 0) - (e.breakMinutes ?? 0)
                    return (
                      <tr key={e.id}>
                        <td className="font-medium">{formatDateShort(e.date)}</td>
                        <td className="num">{formatTime(e.clockIn)}</td>
                        <td className="num">{e.clockOut ? formatTime(e.clockOut) : <span style={{ color: '#34D399' }}>aktywny</span>}</td>
                        <td className="text-right num">{e.totalMinutes ? formatDuration(e.totalMinutes) : '—'}</td>
                        <td className="text-right num">{e.breakMinutes ? formatDuration(e.breakMinutes) : '—'}</td>
                        <td className="text-right num font-medium">{e.totalMinutes ? formatDuration(Math.max(0, net)) : '—'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {weekEntries.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3} className="font-semibold">Suma</td>
                    <td className="text-right num">{formatDuration(weekTotalMinutes)}</td>
                    <td className="text-right num">{formatDuration(weekBreakMinutes)}</td>
                    <td className="text-right num">{formatDuration(Math.max(0, weekTotalMinutes - weekBreakMinutes))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
