import Link from 'next/link'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { DashboardView } from '@/components/shared/dashboard-view'
import { resolveDashboardPeriod, type DashboardSearchParams } from '@/lib/finance/actual-dashboard'
import { loadActualDashboardData } from '@/lib/finance/actual-dashboard-data'

export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/finance')

  const parsed = resolveDashboardPeriod(await searchParams)
  if (!parsed.ok) return (
    <div className="rounded-2xl border border-[var(--wd-border)] bg-white p-6">
      <h1 className="text-xl font-bold">Niepoprawny okres</h1>
      <p role="alert" className="my-3 text-sm text-amber-800">{parsed.error}</p>
      <Link href="/dashboard" className="text-sm font-semibold underline">Pokaż bieżący miesiąc</Link>
    </div>
  )
  const data = await loadActualDashboardData(parsed.period, session.user.id)
  return <DashboardView {...data} userName={session.user.name ?? ''} isAdmin />
}
