import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessInstallationOrder } from '@/lib/installations/access'
import { INSTALLATION_ROLES, type InstallationRole } from '@/lib/installations/constants'
import { getInstallationOrder } from '@/lib/installations/order-service'
import { InstallationOrderDetail } from '@/components/installations/order-detail'

type Params = { params: Promise<{ id: string }> }

export default async function InstallationOrderPage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { id } = await params
  const order = await getInstallationOrder(prisma, id)
  if (!order) notFound()

  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole)
    ? session.user.role as InstallationRole
    : 'EMPLOYEE'
  if (!canAccessInstallationOrder({ role, employeeId: session.user.employeeId }, order)) notFound()

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  })

  return <InstallationOrderDetail order={order} employees={employees} />
}
