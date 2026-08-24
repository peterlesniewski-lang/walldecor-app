import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { InstallationOrderForm } from '@/components/installations/order-form'
import { isInstallationViewerAuthorized } from '@/lib/installations/access'
import { installationViewerFromSession } from '@/lib/installations/http-access'

export default async function NewInstallationOrderPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const viewer = await installationViewerFromSession(session)
  if (!isInstallationViewerAuthorized(viewer) || viewer.role === 'INSTALLER') redirect('/installations')

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  })

  return <InstallationOrderForm
    mode="create"
    employees={employees}
    primaryEmployeeIdLocked={viewer.role === 'EMPLOYEE' ? viewer.employeeId ?? undefined : undefined}
  />
}
