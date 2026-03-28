import { Suspense } from 'react'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ApprovalList, { type LeaveRequestItem } from '@/components/hr/leave/approval-list'
import { ClipboardList, Loader2 } from 'lucide-react'

export default async function LeaveApprovalPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    redirect('/hr/leave')
  }

  // ── Pobierz wnioski ──────────────────────────────────────────────────────
  let divisionIdFilter: string | undefined

  if (role === 'MANAGER' && session.user.employeeId) {
    const managerEmployee = await prisma.employee.findUnique({
      where: { id: session.user.employeeId },
      select: { divisionId: true },
    })
    divisionIdFilter = managerEmployee?.divisionId ?? undefined
  }

  const [rawRequests, employees, leaveTypes] = await Promise.all([
    prisma.leaveRequestNew.findMany({
      where: {
        ...(divisionIdFilter ? { employee: { divisionId: divisionIdFilter } } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            division: { select: { id: true, name: true } },
          },
        },
        leaveType: {
          select: { id: true, name: true, color: true, code: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.employee.findMany({
      where: { active: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { lastName: 'asc' },
    }),
    prisma.leaveType.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
  ])

  // Serialize dates to strings for client component
  const requests: LeaveRequestItem[] = rawRequests.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    leaveTypeId: r.leaveTypeId,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    days: r.days,
    hours: r.hours,
    status: r.status,
    note: r.note,
    rejectionNote: r.rejectionNote,
    approverId: r.approverId,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    isOnDemand: r.isOnDemand,
    isRemoteWork: r.isRemoteWork,
    isDelegation: r.isDelegation,
    employee: {
      id: r.employee.id,
      firstName: r.employee.firstName,
      lastName: r.employee.lastName,
      division: r.employee.division,
    },
    leaveType: {
      id: r.leaveType.id,
      name: r.leaveType.name,
      color: r.leaveType.color,
      code: r.leaveType.code,
    },
  }))

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--wd-sand)', opacity: 0.9 }}
          >
            <ClipboardList size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">
              Akceptacja wniosków urlopowych
            </h1>
            <p className="text-sm mt-0.5 text-[var(--wd-text-muted)]">
              {pendingCount > 0 ? (
                <>
                  <span className="text-amber-600 font-medium">{pendingCount}</span>{' '}
                  {pendingCount === 1 ? 'wniosek oczekuje' : 'wnioski oczekują'} na rozpatrzenie
                </>
              ) : (
                'Wszystkie wnioski zostały rozpatrzone'
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      {requests.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            {
              label: 'Oczekujące',
              count: requests.filter((r) => r.status === 'pending').length,
              color: 'bg-amber-50 border-amber-200 text-amber-700',
            },
            {
              label: 'Zatwierdzone',
              count: requests.filter((r) => r.status === 'approved').length,
              color: 'bg-emerald-50 border-emerald-200 text-emerald-700',
            },
            {
              label: 'Odrzucone',
              count: requests.filter((r) => r.status === 'rejected').length,
              color: 'bg-red-50 border-red-200 text-red-700',
            },
            {
              label: 'Łącznie',
              count: requests.length,
              color: 'bg-[var(--wd-surface-2)] border-[var(--wd-border)] text-[var(--wd-text-primary)]',
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className={`rounded-xl border px-4 py-3 ${stat.color}`}
            >
              <p className="text-2xl font-bold">{stat.count}</p>
              <p className="text-xs font-medium mt-0.5 opacity-80">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Approval list (client component) */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16 gap-2 text-[var(--wd-text-muted)]">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Ładowanie...</span>
          </div>
        }
      >
        <ApprovalList
          initialRequests={requests}
          employees={employees}
          leaveTypes={leaveTypes}
        />
      </Suspense>
    </div>
  )
}
