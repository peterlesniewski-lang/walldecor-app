import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { InstallationOrderForm } from '@/components/installations/order-form'

export default async function NewInstallationOrderPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (String(session.user.role) === 'INSTALLER') redirect('/installations')

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, firstName: true, lastName: true, email: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  })

  return <InstallationOrderForm mode="create" employees={employees} />
}
