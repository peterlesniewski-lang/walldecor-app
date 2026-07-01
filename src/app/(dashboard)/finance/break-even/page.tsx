import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { BreakEvenView } from '@/components/shared/break-even-view'

export default async function BreakEvenPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) redirect('/finance')

  return <BreakEvenView />
}
