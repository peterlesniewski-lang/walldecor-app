import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { PayrollSettlementView } from '@/components/hr/payroll/payroll-settlement-view'

export default async function PayrollSettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/hr')

  const { id } = await params
  return <PayrollSettlementView id={id} />
}
