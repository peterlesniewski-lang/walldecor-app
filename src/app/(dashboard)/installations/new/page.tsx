import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { InstallationOrderForm } from '@/components/installations/order-form'
import { INSTALLATION_ROLES, type InstallationRole } from '@/lib/installations/constants'

export default async function NewInstallationOrderPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole)
    ? session.user.role as InstallationRole
    : 'EMPLOYEE'
  if (role === 'INSTALLER' || (role === 'EMPLOYEE' && !session.user.employeeId)) redirect('/installations')

  if (role === 'EMPLOYEE') {
    const employee = await prisma.employee.findUnique({
      where: { id: session.user.employeeId! },
      select: { active: true },
    })
    if (!employee?.active) redirect('/installations')
  }

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  })

  return <InstallationOrderForm
    mode="create"
    employees={employees}
    primaryEmployeeIdLocked={role === 'EMPLOYEE' ? session.user.employeeId ?? undefined : undefined}
  />
}
