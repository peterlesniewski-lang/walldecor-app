import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PnlView } from '@/components/shared/pnl-view'

interface PageProps {
  searchParams: Promise<{ year?: string; costCenterId?: string }>
}

export default async function ActualsPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { year: yearParam, costCenterId: ccParam } = await searchParams
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  const costCenterId = ccParam ?? 'GLOBAL'
  const isGlobal = costCenterId === 'GLOBAL'
  const where = isGlobal ? { year } : { year, costCenterId }

  const [rawRevenuePlan, rawRevenueReal, rawBudget] = await Promise.all([
    prisma.revenueBudget.findMany({ where }),
    prisma.revenue.findMany({ where }),
    prisma.budgetEntry.findMany({ where }),
  ])

  const planIncomeByMonth = new Array(12).fill(0) as number[]
  for (const r of rawRevenuePlan) planIncomeByMonth[r.month - 1] += r.amount

  const realIncomeByMonth = new Array(12).fill(0) as number[]
  for (const r of rawRevenueReal) realIncomeByMonth[r.month - 1] += r.amount

  const planExpensesByMonth = new Array(12).fill(0) as number[]
  for (const e of rawBudget) planExpensesByMonth[e.month - 1] += e.amount

  const realExpensesByMonth = new Array(12).fill(0) as number[]
  for (const e of rawBudget) realExpensesByMonth[e.month - 1] += e.amount

  return (
    <PnlView
      planIncomeByMonth={planIncomeByMonth}
      realIncomeByMonth={realIncomeByMonth}
      planExpensesByMonth={planExpensesByMonth}
      realExpensesByMonth={realExpensesByMonth}
      year={year}
      costCenterId={costCenterId}
    />
  )
}
