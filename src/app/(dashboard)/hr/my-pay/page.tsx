import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getOwnPayrollStatements } from '@/lib/payroll/contracts'
import { MyPayView } from '@/components/hr/payroll/my-pay-view'

// Own pay only: employeeId comes from the session, never from the URL. Employer cost is not shown.
export default async function MyPayPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const employeeId = session.user.employeeId ?? null
  const statements = employeeId ? await getOwnPayrollStatements(prisma, employeeId) : []
  return (
    <MyPayView
      hasEmployeeProfile={employeeId !== null}
      statements={statements.map((statement) => ({
        year: statement.year,
        month: statement.month,
        versionNumber: statement.versionNumber,
        approvedAt: statement.approvedAt.toISOString(),
        finalGrossGrosze: statement.finalGrossGrosze,
        finalNetGrosze: statement.finalNetGrosze,
      }))}
    />
  )
}
