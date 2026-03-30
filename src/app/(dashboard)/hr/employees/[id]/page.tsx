import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmployeeAvatar } from '@/components/hr/employees/employee-avatar'
import { EmployeeTabs } from './employee-tabs'
import { EmployeeActions } from './employee-actions'
import { getWeekRange } from '@/lib/hr/utils'
import { LeaveTabClient } from '@/components/hr/employees/leave-tab-client'

// ─── Types ────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> }

// ─── Info row helper ─────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 border-b border-[var(--wd-border)] last:border-0">
      <span className="data-label">{label}</span>
      <span className="text-sm text-[var(--wd-text-primary)]">{value ?? '—'}</span>
    </div>
  )
}

function EmploymentTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-sm text-[var(--wd-text-muted)]">—</span>
  const styles: Record<string, string> = {
    UoP: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    B2B: 'bg-sky-50 text-sky-700 border-sky-200',
    UZ: 'bg-amber-50 text-amber-700 border-amber-200',
    UoD: 'bg-violet-50 text-violet-700 border-violet-200',
  }
  const cls = styles[type] ?? 'bg-stone-50 text-stone-600 border-stone-200'
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {type}
    </span>
  )
}

// ─── Tab content components ───────────────────────────────────────────────────

type EmployeeWithRelations = Awaited<ReturnType<typeof fetchEmployee>>

function PersonalDataTab({
  employee,
  isAdmin,
}: {
  employee: NonNullable<EmployeeWithRelations>
  isAdmin: boolean
}) {
  const formatDate = (d: Date | null | undefined) =>
    d ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long' }).format(new Date(d)) : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--wd-text-primary)]">Dane pracownika</h3>
        {isAdmin && (
          <Link
            href={`/hr/employees/${employee.id}/edit`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Edytuj
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
        <div>
          <InfoRow label="Imię i nazwisko" value={`${employee.firstName} ${employee.lastName}`} />
          <InfoRow label="Email" value={employee.email} />
          <InfoRow label="Telefon" value={employee.phone} />
          <div className="flex flex-col gap-0.5 py-3 border-b border-[var(--wd-border)]">
            <span className="data-label">Typ umowy</span>
            <div className="mt-1">
              <EmploymentTypeBadge type={employee.employmentType} />
            </div>
          </div>
          <InfoRow label="Stanowisko" value={employee.positionRef?.name ?? employee.position} />
        </div>
        <div>
          <InfoRow label="Data zatrudnienia" value={formatDate(employee.startDate)} />
          <InfoRow label="Data zakończenia" value={employee.endDate ? formatDate(employee.endDate) : null} />
          <InfoRow label="Centrum kosztów" value={employee.costCenter?.name ?? employee.costCenterId} />
          <InfoRow label="Oddział" value={employee.division?.name} />
          <InfoRow label="Dział" value={employee.department?.name} />
          <InfoRow
            label="Przełożony"
            value={
              employee.manager
                ? `${employee.manager.firstName} ${employee.manager.lastName}`
                : null
            }
          />
        </div>
      </div>
    </div>
  )
}

// ─── TimeEntry type ───────────────────────────────────────────────────────────

type TimeEntryWithProject = {
  id: string
  date: Date
  clockIn: Date
  clockOut: Date | null
  totalMinutes: number | null
  status: string
  project: { id: string; name: string } | null
}

function WorkTimeTab({ entries }: { entries: TimeEntryWithProject[] }) {
  const STATUS_STYLES: Record<string, string> = {
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    rejected: 'bg-red-50 text-red-600 border-red-200',
  }
  const STATUS_LABELS: Record<string, string> = {
    approved: 'Zatwierdzone',
    pending: 'Oczekujące',
    rejected: 'Odrzucone',
  }

  const DAY_SHORT: Record<number, string> = {
    1: 'Pn', 2: 'Wt', 3: 'Śr', 4: 'Cz', 5: 'Pt', 6: 'So', 0: 'Nd',
  }

  function formatDay(date: Date): string {
    const d = new Date(date)
    const dow = DAY_SHORT[d.getDay()] ?? '?'
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    return `${dow} ${day}.${month}`
  }

  function formatDuration(entry: TimeEntryWithProject): string {
    if (entry.totalMinutes != null && entry.totalMinutes > 0) {
      const h = Math.floor(entry.totalMinutes / 60)
      const m = entry.totalMinutes % 60
      return m === 0 ? `${h}h` : `${h}h ${m}m`
    }
    if (entry.clockOut) {
      const mins = Math.round((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 60000)
      const h = Math.floor(mins / 60)
      const m = mins % 60
      return m === 0 ? `${h}h` : `${h}h ${m}m`
    }
    const start = new Date(entry.clockIn)
    return `Od ${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
          style={{ background: 'var(--wd-surface-2)' }}
        >
          <svg className="w-6 h-6" style={{ color: 'var(--wd-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="font-medium text-[var(--wd-text-primary)] mb-1">Brak wpisów</p>
        <p className="text-sm max-w-sm" style={{ color: 'var(--wd-text-muted)' }}>
          Brak wpisów w bieżącym tygodniu
        </p>
      </div>
    )
  }

  // Summary row
  const totalMins = entries.reduce((acc, e) => {
    if (e.totalMinutes != null) return acc + e.totalMinutes
    if (e.clockOut) return acc + Math.round((new Date(e.clockOut).getTime() - new Date(e.clockIn).getTime()) / 60000)
    return acc
  }, 0)
  const totalH = Math.floor(totalMins / 60)
  const totalM = totalMins % 60

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--wd-text-primary)]">Czas pracy — bieżący tydzień</h3>
        <span className="text-sm font-medium num text-[var(--wd-text-primary)]">
          Suma: {totalH}h {totalM > 0 ? `${totalM}m` : ''}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--wd-border)]">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Dzień</th>
              <th>Godziny</th>
              <th>Status</th>
              <th>Projekt</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="font-medium text-[var(--wd-text-primary)] num">
                  {formatDay(entry.date)}
                </td>
                <td className="num text-[var(--wd-text-primary)]">
                  {formatDuration(entry)}
                </td>
                <td>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
                      STATUS_STYLES[entry.status] ?? 'bg-stone-50 text-stone-600 border-stone-200'
                    }`}
                  >
                    {STATUS_LABELS[entry.status] ?? entry.status}
                  </span>
                </td>
                <td className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
                  {entry.project?.name ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// ─── Data fetcher ─────────────────────────────────────────────────────────────

async function fetchEmployee(id: string) {
  return prisma.employee.findUnique({
    where: { id },
    include: {
      division: true,
      department: true,
      team: true,
      positionRef: true,
      costCenter: true,
      manager: { select: { id: true, firstName: true, lastName: true } },
      contracts: { orderBy: { startDate: 'desc' } },
      leaveBalancesNew: {
        include: { leaveType: true },
        orderBy: { year: 'desc' },
      },
      leaveRequestsNew: {
        include: { leaveType: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function EmployeeProfilePage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const employee = await fetchEmployee(id)
  if (!employee) notFound()

  const isAdmin = session.user.role === 'ADMIN'
  const canEditLeave = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'

  // Fetch current week time entries
  const { start, end } = getWeekRange(new Date())
  const timeEntries = await prisma.timeEntry.findMany({
    where: {
      employeeId: employee.id,
      date: { gte: start, lte: end },
    },
    include: { project: true },
    orderBy: { date: 'asc' },
  })

  const tabs = [
    {
      id: 'personal',
      label: 'Dane osobowe',
      content: <PersonalDataTab employee={employee} isAdmin={isAdmin} />,
    },
    {
      id: 'time',
      label: 'Czas pracy',
      content: <WorkTimeTab entries={timeEntries} />,
    },
    {
      id: 'leave',
      label: 'Urlopy',
      content: (
        <LeaveTabClient
          employeeId={employee.id}
          balances={employee.leaveBalancesNew.map((b) => ({
            id: b.id,
            year: b.year,
            totalDays: b.totalDays,
            usedDays: b.usedDays,
            pendingDays: b.pendingDays,
            carriedOver: b.carriedOver,
            leaveType: {
              id: b.leaveType.id,
              name: b.leaveType.name,
              code: b.leaveType.code,
              color: b.leaveType.color,
            },
          }))}
          requests={employee.leaveRequestsNew.map((r) => ({
            id: r.id,
            startDate: r.startDate.toISOString(),
            endDate: r.endDate.toISOString(),
            days: r.days,
            status: r.status,
            leaveType: {
              id: r.leaveType.id,
              name: r.leaveType.name,
              code: r.leaveType.code,
              color: r.leaveType.color,
            },
          }))}
          canEdit={canEditLeave}
        />
      ),
    },
  ]

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/hr/employees"
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4 text-[var(--wd-text-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>

        <div className="flex items-center gap-4 flex-1 min-w-0">
          <EmployeeAvatar
            firstName={employee.firstName}
            lastName={employee.lastName}
            size="lg"
            avatarUrl={employee.avatarUrl}
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--wd-text-primary)] truncate">
              {employee.firstName} {employee.lastName}
            </h1>
            <p className="text-sm truncate" style={{ color: 'var(--wd-text-muted)' }}>
              {employee.positionRef?.name ?? employee.position}
              {employee.division ? ` · ${employee.division.name}` : ''}
            </p>
          </div>
          {/* Active badge */}
          {employee.active ? (
            <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Aktywny
            </span>
          ) : (
            <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              Nieaktywny
            </span>
          )}
        </div>

        {/* Admin actions */}
        {isAdmin && (
          <EmployeeActions
            employeeId={employee.id}
            employeeName={`${employee.firstName} ${employee.lastName}`}
          />
        )}
      </div>

      {/* Main card */}
      <div className="bg-white border border-[var(--wd-border)] rounded-xl shadow-sm p-6">
        <EmployeeTabs tabs={tabs} defaultTab="personal" />
      </div>
    </div>
  )
}
