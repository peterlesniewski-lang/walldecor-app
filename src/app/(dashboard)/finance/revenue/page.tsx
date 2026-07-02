import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { RevenueTabs } from '@/components/shared/revenue-tabs'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string; tab?: string }>
}

export default async function RevenuePage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/finance')

  const { year: yearParam, costCenterId: ccParam, tab: tabParam } = await searchParams
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const costCenterId = ccParam ?? 'GLOBAL'
  const activeTab = tabParam === 'actuals' ? 'actuals' : 'plan'

  const isGlobal = costCenterId === 'GLOBAL'

  const [rawPlan, rawActuals] = await Promise.all([
    prisma.revenueBudget.findMany({ where: isGlobal ? { year } : { year, costCenterId } }),
    prisma.revenue.findMany({ where: isGlobal ? { year } : { year, costCenterId } }),
  ])

  const planEntries: Record<string, number> = {}
  for (const e of rawPlan) {
    const key = `${e.channel}_${e.month}`
    planEntries[key] = (planEntries[key] ?? 0) + e.amount
  }

  const actualEntries: Record<string, number> = {}
  for (const e of rawActuals) {
    const key = `${e.channel}_${e.month}`
    actualEntries[key] = (actualEntries[key] ?? 0) + e.amount
  }

  const canEditPlan = session.user.role === 'ADMIN' && !isGlobal
  const canEditActuals = session.user.role === 'ADMIN' && !isGlobal

  return (
    <RevenueTabs
      planEntries={planEntries}
      actualEntries={actualEntries}
      year={year}
      costCenterId={costCenterId}
      activeTab={activeTab}
      canEditPlan={canEditPlan}
      canEditActuals={canEditActuals}
    />
  )
}
