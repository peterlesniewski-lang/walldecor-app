import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DashboardView } from '@/components/shared/dashboard-view'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const year = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1 // 1-12

  // Fetch all cost centers in parallel
  const costCenters = ['JAG', 'PUL', 'GLOBAL']

  const prevYear = year - 1

  const [revenuePlans, revenueActuals, budgets, actualsWithSubcat,
         prevRevenuePlans, prevRevenueActuals, prevBudgets, prevActuals] = await Promise.all([
    prisma.revenueBudget.findMany({ where: { year } }),
    prisma.revenue.findMany({ where: { year } }),
    prisma.budgetEntry.findMany({ where: { year } }),
    prisma.actualEntry.findMany({
      where: { year },
      include: { subCategory: { select: { isFixed: true } } },
    }),
    // Previous year data for YoY comparison
    prisma.revenueBudget.findMany({ where: { year: prevYear } }),
    prisma.revenue.findMany({ where: { year: prevYear } }),
    prisma.budgetEntry.findMany({ where: { year: prevYear } }),
    prisma.actualEntry.findMany({ where: { year: prevYear } }),
  ])

  // Previous year aggregates
  const prevYearTotalIncome = prevRevenueActuals.length > 0
    ? prevRevenueActuals.reduce((s, r) => s + r.amount, 0)
    : prevRevenuePlans.reduce((s, r) => s + r.amount, 0)
  const prevYearTotalExpenses = prevActuals.length > 0
    ? prevActuals.reduce((s, e) => s + e.amount, 0)
    : prevBudgets.reduce((s, e) => s + e.amount, 0)

  // Aggregate by month across all cost centers (or per CC for breakdown)
  const planIncomeByMonth = new Array(12).fill(0) as number[]
  for (const r of revenuePlans) planIncomeByMonth[r.month - 1] += r.amount

  const realIncomeByMonth = new Array(12).fill(0) as number[]
  for (const r of revenueActuals) realIncomeByMonth[r.month - 1] += r.amount

  const planExpensesByMonth = new Array(12).fill(0) as number[]
  for (const e of budgets) planExpensesByMonth[e.month - 1] += e.amount

  const fixedCostsByMonth = new Array(12).fill(0) as number[]
  const variableCostsByMonth = new Array(12).fill(0) as number[]
  for (const e of actualsWithSubcat) {
    if (e.subCategory.isFixed) fixedCostsByMonth[e.month - 1] += e.amount
    else variableCostsByMonth[e.month - 1] += e.amount
  }
  const realExpensesByMonth = fixedCostsByMonth.map((f, i) => f + variableCostsByMonth[i])

  // Per cost center totals (for breakdown)
  const ccBreakdown = costCenters.map((cc) => {
    const planIncome = revenuePlans.filter((r) => r.costCenterId === cc).reduce((s, r) => s + r.amount, 0)
    const realIncome = revenueActuals.filter((r) => r.costCenterId === cc).reduce((s, r) => s + r.amount, 0)
    const planExpenses = budgets.filter((e) => e.costCenterId === cc).reduce((s, e) => s + e.amount, 0)
    const realExpenses = actualsWithSubcat.filter((e) => e.costCenterId === cc).reduce((s, e) => s + e.amount, 0)
    return { cc, planIncome, realIncome, planExpenses, realExpenses }
  })

  return (
    <DashboardView
      year={year}
      currentMonth={currentMonth}
      planIncomeByMonth={planIncomeByMonth}
      realIncomeByMonth={realIncomeByMonth}
      planExpensesByMonth={planExpensesByMonth}
      realExpensesByMonth={realExpensesByMonth}
      fixedCostsByMonth={fixedCostsByMonth}
      variableCostsByMonth={variableCostsByMonth}
      ccBreakdown={ccBreakdown}
      userName={session.user.name ?? ''}
      prevYearTotalIncome={prevYearTotalIncome}
      prevYearTotalExpenses={prevYearTotalExpenses}
    />
  )
}
