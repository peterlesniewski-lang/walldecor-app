import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { listInstallationOrders } from '@/lib/installations/order-service'
import { InstallationOrderList } from '@/components/installations/order-list'

export default async function InstallationsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const viewer = await installationViewerFromSession(session)
  const visibleOrders = await listInstallationOrders(prisma, { viewer })
  const canCreate = viewer.role === 'ADMIN' || viewer.role === 'MANAGER' || (viewer.role === 'EMPLOYEE' && viewer.employeeActive === true)

  return <InstallationOrderList orders={visibleOrders} canCreate={canCreate} />
}
