import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { EmployerRatesView } from '@/components/hr/payroll/employer-rates-view'

export default async function EmployerRatesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/hr')
  return <EmployerRatesView />
}
