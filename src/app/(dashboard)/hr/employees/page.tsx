import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmployeeAvatar } from '@/components/hr/employees/employee-avatar'
import { EmployeeFilters } from '@/components/hr/employees/employee-filters'
import { EmployeeRowActions } from '@/components/hr/employees/employee-row-actions'
import { Suspense } from 'react'

// ─── Badges ──────────────────────────────────────────────────────────────────

function EmploymentTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-[var(--wd-text-muted)]">—</span>

  const styles: Record<string, string> = {
    UoP: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    B2B: 'bg-sky-50 text-sky-700 border-sky-200',
    UZ: 'bg-amber-50 text-amber-700 border-amber-200',
    UoD: 'bg-violet-50 text-violet-700 border-violet-200',
  }
  const cls = styles[type] ?? 'bg-stone-50 text-stone-600 border-stone-200'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {type}
    </span>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Aktywny
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-600 border border-red-200">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
      Nieaktywny
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface SearchParams {
  divisionId?: string
  departmentId?: string
  status?: string
  employmentType?: string
  search?: string
  page?: string
  showHidden?: string
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const sp = await searchParams
  const isAdmin = session.user.role === 'ADMIN'

  const page = Math.max(1, parseInt(sp.page ?? '1', 10))
  const limit = 20
  const skip = (page - 1) * limit

  const showHidden = isAdmin && sp.showHidden === 'true'

  // Build filters
  type WhereClause = {
    divisionId?: string
    departmentId?: string
    employmentType?: string
    active?: boolean
    OR?: Array<{ firstName?: { contains: string }; lastName?: { contains: string }; email?: { contains: string } }>
  }

  const where: WhereClause = {}
  if (sp.divisionId) where.divisionId = sp.divisionId
  if (sp.departmentId) where.departmentId = sp.departmentId
  if (sp.employmentType) where.employmentType = sp.employmentType
  if (sp.status === 'active') where.active = true
  else if (sp.status === 'inactive') where.active = false
  else if (!showHidden) where.active = true
  if (sp.search) {
    where.OR = [
      { firstName: { contains: sp.search } },
      { lastName: { contains: sp.search } },
      { email: { contains: sp.search } },
    ]
  }

  const [employees, total, divisions] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        division: true,
        department: true,
        positionRef: true,
        costCenter: true,
      },
    }),
    prisma.employee.count({ where }),
    prisma.division.findMany({ orderBy: { name: 'asc' } }),
  ])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">Pracownicy</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            {total} {total === 1 ? 'pracownik' : total < 5 ? 'pracownicy' : 'pracowników'} w systemie
            {showHidden && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200">
                Widoczni ukryci
              </span>
            )}
          </p>
        </div>
        {isAdmin && (
          <Link
            href="/hr/employees/new"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors bg-[var(--wd-dark)] text-white hover:bg-[#2E2E2E]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Dodaj pracownika
          </Link>
        )}
      </div>

      {/* Card */}
      <div className="bg-white border border-[var(--wd-border)] rounded-xl shadow-sm overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-[var(--wd-border)]">
          <Suspense fallback={null}>
            <EmployeeFilters divisions={divisions} isAdmin={isAdmin} />
          </Suspense>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {employees.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
                Brak pracowników spełniających kryteria wyszukiwania.
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Pracownik</th>
                  <th>Stanowisko</th>
                  <th>Oddział</th>
                  <th>Umowa</th>
                  <th>Status</th>
                  {isAdmin && <th className="w-12" />}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="cursor-pointer">
                    <td>
                      <Link
                        href={`/hr/employees/${emp.id}`}
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                      >
                        <EmployeeAvatar
                          firstName={emp.firstName}
                          lastName={emp.lastName}
                          size="md"
                          avatarUrl={emp.avatarUrl}
                        />
                        <div>
                          <div className="font-medium text-[var(--wd-text-primary)]">
                            {emp.firstName} {emp.lastName}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                            {emp.email}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="text-sm text-[var(--wd-text-primary)]">
                      {emp.positionRef?.name ?? emp.position ?? '—'}
                    </td>
                    <td className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>
                      {emp.division?.name ?? emp.costCenter?.name ?? '—'}
                    </td>
                    <td>
                      <EmploymentTypeBadge type={emp.employmentType} />
                    </td>
                    <td>
                      <StatusBadge active={emp.active} />
                    </td>
                    {isAdmin && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <EmployeeRowActions
                          employeeId={emp.id}
                          employeeName={`${emp.firstName} ${emp.lastName}`}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--wd-border)]">
            <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
              Strona {page} z {totalPages} ({total} wyników)
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined) as [string, string][]), page: String(page - 1) }).toString()}`}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors"
                >
                  Poprzednia
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== undefined) as [string, string][]), page: String(page + 1) }).toString()}`}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors"
                >
                  Następna
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
