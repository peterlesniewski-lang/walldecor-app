import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessInstallationOrder } from '@/lib/installations/access'
import { INSTALLATION_ROLES, type InstallationRole } from '@/lib/installations/constants'
import { listInstallationOrders } from '@/lib/installations/order-service'
import { InstallationOrderList } from '@/components/installations/order-list'

export default async function InstallationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = INSTALLATION_ROLES.includes(session.user.role as InstallationRole)
    ? session.user.role as InstallationRole
    : 'EMPLOYEE'
  const orders = await listInstallationOrders(prisma)
  const visibleOrders = orders.filter((order) => canAccessInstallationOrder({ role, employeeId: session.user.employeeId }, order))
  const canCreate = role === 'ADMIN' || role === 'MANAGER' || (role === 'EMPLOYEE' && Boolean(session.user.employeeId))

  return <InstallationOrderList orders={visibleOrders} canCreate={canCreate} />
}
