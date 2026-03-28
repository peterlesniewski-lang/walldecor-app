import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmployeeForm } from './employee-form'

export default async function NewEmployeePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/hr/employees')

  const [divisions, departments, managers] = await Promise.all([
    prisma.division.findMany({ orderBy: { name: 'asc' } }),
    prisma.department.findMany({ orderBy: { name: 'asc' } }),
    prisma.employee.findMany({
      where: { active: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }),
  ])

  return (
    <div className="p-6 lg:p-8 bg-[var(--wd-off-white)] min-h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/hr/employees"
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--wd-border)] hover:bg-[var(--wd-surface-2)] transition-colors"
        >
          <svg className="w-4 h-4 text-[var(--wd-text-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--wd-text-primary)]">Nowy pracownik</h1>
          <p className="text-sm" style={{ color: 'var(--wd-text-muted)' }}>Wypełnij dane nowego pracownika</p>
        </div>
      </div>

      {/* Form card */}
      <div className="bg-white border border-[var(--wd-border)] rounded-xl shadow-sm p-6 lg:p-8">
        <EmployeeForm
          divisions={divisions}
          departments={departments}
          managers={managers}
        />
      </div>
    </div>
  )
}
