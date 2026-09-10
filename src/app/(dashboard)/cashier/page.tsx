import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveCashierActor } from '@/lib/cashier/access'
import { CashierError } from '@/lib/cashier/errors'
import { CashierView } from '@/components/cashier/cashier-view'

export default async function CashierPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  try { await resolveCashierActor(prisma, session.user.id) } catch (error) {
    if (!(error instanceof CashierError)) throw error
    return <section><h1 className="text-2xl font-bold">Kasa salonu</h1><p role="alert" className="mt-4">{error.message}</p></section>
  }
  return <CashierView />
}
