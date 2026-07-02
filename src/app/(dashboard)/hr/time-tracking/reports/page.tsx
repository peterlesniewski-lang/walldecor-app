import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ReportsDashboard } from '@/components/hr/time-tracking/reports-dashboard'

export default async function ReportsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user.role
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    redirect('/hr')
  }

  const managerDivisionId =
    role === 'MANAGER' && session.user.employeeId
      ? (await prisma.employee.findUnique({
          where: { id: session.user.employeeId },
          select: { divisionId: true },
        }))?.divisionId ?? null
      : null
  const divisions = await prisma.division.findMany({
    where: role === 'MANAGER' ? { id: managerDivisionId ?? '__hr_no_division_access__' } : {},
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="p-6 lg:p-8" style={{ background: 'var(--wd-off-white)', minHeight: '100%' }}>
      {/* Header */}
      <div className="mb-6">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{ color: 'var(--wd-dark)', fontFamily: 'var(--font-jakarta)' }}
        >
          Raporty czasu pracy
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--wd-text-muted)' }}>
          Analizuj czas pracy, obecność, nadgodziny i realizację planów
        </p>
      </div>

      {/* Dashboard */}
      <div
        className="rounded-2xl p-6"
        style={{
          background: 'var(--wd-white)',
          boxShadow: 'var(--card-shadow)',
          border: '1px solid var(--wd-border)',
        }}
      >
        <ReportsDashboard divisions={divisions} />
      </div>
    </div>
  )
}
