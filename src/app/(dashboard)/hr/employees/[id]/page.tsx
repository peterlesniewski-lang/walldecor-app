import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmployeeAvatar } from '@/components/hr/employees/employee-avatar'
import { EmployeeTabs } from './employee-tabs'

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

function WorkTimeTab() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'var(--wd-surface-2)' }}
      >
        <svg className="w-6 h-6" style={{ color: 'var(--wd-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <p className="font-medium text-[var(--wd-text-primary)] mb-1">Dane czasu pracy</p>
      <p className="text-sm max-w-sm" style={{ color: 'var(--wd-text-muted)' }}>
        Dane czasu pracy dostępne po implementacji Fazy 2
      </p>
    </div>
  )
}

function LeaveTab({ employee }: { employee: NonNullable<EmployeeWithRelations> }) {
  const balances = employee.leaveBalancesNew
  const requests = employee.leaveRequestsNew

  if (balances.length === 0 && requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
          style={{ background: 'var(--wd-surface-2)' }}
        >
          <svg className="w-6 h-6" style={{ color: 'var(--wd-text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="font-medium text-[var(--wd-text-primary)] mb-1">Brak danych urlopowych</p>
        <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
          Nie przypisano jeszcze salda urlopowego.
        </p>
      </div>
    )
  }

  const STATUS_LABELS: Record<string, string> = {
    pending: 'Oczekujący',
    approved: 'Zatwierdzony',
    rejected: 'Odrzucony',
    cancelled: 'Anulowany',
  }
  const STATUS_STYLES: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-red-50 text-red-600 border-red-200',
    cancelled: 'bg-stone-50 text-stone-600 border-stone-200',
  }

  return (
    <div className="space-y-8">
      {/* Leave balances */}
      {balances.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-[var(--wd-text-primary)] mb-4">Saldo urlopowe</h3>
          <div className="space-y-3">
            {balances.map((b) => {
              const used = b.usedDays + b.pendingDays
              const pct = b.totalDays > 0 ? Math.min(100, (used / b.totalDays) * 100) : 0
              return (
                <div key={b.id} className="p-4 rounded-lg border border-[var(--wd-border)] bg-white">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--wd-text-primary)]">{b.leaveType.name}</span>
                    <span className="text-sm num" style={{ color: 'var(--wd-text-muted)' }}>
                      {b.usedDays} / {b.totalDays} dni
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full" style={{ background: 'var(--wd-surface-2)' }}>
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct > 80 ? '#EF4444' : pct > 60 ? '#F59E0B' : '#10B981',
                      }}
                    />
                  </div>
                  {b.pendingDays > 0 && (
                    <p className="text-xs mt-1" style={{ color: 'var(--wd-text-muted)' }}>
                      {b.pendingDays} dni oczekuje na zatwierdzenie
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent leave requests */}
      {requests.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-[var(--wd-text-primary)] mb-4">Ostatnie wnioski</h3>
          <div className="space-y-2">
            {requests.slice(0, 10).map((r) => {
              const fmt = (d: Date) => new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short' }).format(new Date(d))
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-[var(--wd-border)]"
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--wd-text-primary)]">{r.leaveType.name}</p>
                    <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                      {fmt(r.startDate)} – {fmt(r.endDate)} ({r.days} {r.days === 1 ? 'dzień' : 'dni'})
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_STYLES[r.status] ?? STATUS_STYLES.cancelled}`}
                  >
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
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

  const tabs = [
    {
      id: 'personal',
      label: 'Dane osobowe',
      content: <PersonalDataTab employee={employee} isAdmin={isAdmin} />,
    },
    {
      id: 'time',
      label: 'Czas pracy',
      content: <WorkTimeTab />,
    },
    {
      id: 'leave',
      label: 'Urlopy',
      content: <LeaveTab employee={employee} />,
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
      </div>

      {/* Main card */}
      <div className="bg-white border border-[var(--wd-border)] rounded-xl shadow-sm p-6">
        <EmployeeTabs tabs={tabs} defaultTab="personal" />
      </div>
    </div>
  )
}
