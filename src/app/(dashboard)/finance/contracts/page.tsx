import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { CostContractsView } from '@/components/shared/cost-contracts-view'

export default async function CostContractsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/finance')
  return <CostContractsView />
}
