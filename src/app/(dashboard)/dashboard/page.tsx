import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DashboardView } from '@/components/shared/dashboard-view'
import { buildRealizedCostSummary, costEventYearDateRange } from '@/lib/finance/realized-costs'

interface PageProps {
  searchParams: Promise<{ year?: string }>
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/finance')

  const { year: yearParam } = await searchParams
  const now = new Date()
  const todayYear = now.getFullYear()
  const year = yearParam ? parseInt(yearParam, 10) : todayYear
  const currentMonth = year === todayYear ? now.getMonth() + 1 : 12

  // Fetch all cost centers in parallel
  const costCenters = ['JAG', 'PUL', 'GLOBAL'] as const

  const prevYear = year - 1
  const costEventVisibilityFilter = session.user.role !== 'ADMIN' ? { isConfidential: false } : {}

  const [revenuePlans, revenueActuals, actualCosts, costEvents,
         prevRevenuePlans, prevRevenueActuals, prevActualCosts, prevCostEvents,
         cashAccounts, receivables, latestLiability, appSettings] = await Promise.all([
    prisma.revenueBudget.findMany({ where: { year } }),
    prisma.revenue.findMany({ where: { year } }),
    prisma.actualEntry.findMany({
      where: { year },
      include: { subCategory: { select: { isFixed: true } } },
    }),
    prisma.costEvent.findMany({
      where: {
        status: 'APPROVED',
        eventDate: costEventYearDateRange(year),
        ...costEventVisibilityFilter,
      },
      include: {
        parts: {
          include: {
            tags: { include: { tag: true } },
            allocations: true,
          },
        },
      },
    }),
    // Previous year data for YoY comparison
    prisma.revenueBudget.findMany({ where: { year: prevYear } }),
    prisma.revenue.findMany({ where: { year: prevYear } }),
    prisma.actualEntry.findMany({
      where: { year: prevYear },
      include: { subCategory: { select: { isFixed: true } } },
    }),
    prisma.costEvent.findMany({
      where: {
        status: 'APPROVED',
        eventDate: costEventYearDateRange(prevYear),
        ...costEventVisibilityFilter,
      },
      include: {
        parts: {
          include: {
            tags: { include: { tag: true } },
            allocations: true,
          },
        },
      },
    }),
    prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } }),
    prisma.receivableEntry.findMany({ orderBy: { dueDate: 'asc' } }),
    prisma.cashLiabilitySnapshot.findFirst({ orderBy: { date: 'desc' } }),
    prisma.appSetting.findMany({
      where: { key: { in: ['cashThresholdVeryGood', 'cashThresholdGood', 'cashThresholdBad'] } },
    }),
  ])

  // NBP EUR rate
  let eurRate: number | null = null
  let eurRateDate: string | null = null
  try {
    const nbpRes = await fetch('https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json', {
      signal: AbortSignal.timeout(3000),
      next: { revalidate: 3600 },
    })
    if (nbpRes.ok) {
      const nbpData = await nbpRes.json() as { rates: Array<{ mid: number; effectiveDate: string }> }
      eurRate = nbpData.rates[0]?.mid ?? null
      eurRateDate = nbpData.rates[0]?.effectiveDate ?? null
    }
  } catch {
    // fallback: null
  }

  // Cash thresholds
  const thresholds = {
    cashThresholdVeryGood: parseFloat(appSettings.find((s) => s.key === 'cashThresholdVeryGood')?.value ?? '300000'),
    cashThresholdGood: parseFloat(appSettings.find((s) => s.key === 'cashThresholdGood')?.value ?? '200000'),
    cashThresholdBad: parseFloat(appSettings.find((s) => s.key === 'cashThresholdBad')?.value ?? '100000'),
  }

  // Previous year aggregates
  const prevYearTotalIncome = prevRevenueActuals.length > 0
    ? prevRevenueActuals.reduce((s, r) => s + r.amount, 0)
    : prevRevenuePlans.reduce((s, r) => s + r.amount, 0)
  const realizedCosts = buildRealizedCostSummary({ year, actualEntries: actualCosts, costEvents })
  const prevRealizedCosts = buildRealizedCostSummary({
    year: prevYear,
    actualEntries: prevActualCosts,
    costEvents: prevCostEvents,
  })
  const prevYearTotalExpenses = prevRealizedCosts.totalCostsByMonth.reduce((s, e) => s + e, 0)

  // Aggregate by month across all cost centers (or per CC for breakdown)
  const planIncomeByMonth = new Array(12).fill(0) as number[]
  for (const r of revenuePlans) planIncomeByMonth[r.month - 1] += r.amount

  const realIncomeByMonth = new Array(12).fill(0) as number[]
  for (const r of revenueActuals) realIncomeByMonth[r.month - 1] += r.amount

  const fixedCostsByMonth = realizedCosts.fixedCostsByMonth
  const variableCostsByMonth = realizedCosts.variableCostsByMonth
  const realExpensesByMonth = realizedCosts.totalCostsByMonth

  // Per cost center totals (for breakdown)
  const ccBreakdown = costCenters.map((cc) => {
    const planIncome = revenuePlans.filter((r) => r.costCenterId === cc).reduce((s, r) => s + r.amount, 0)
    const realIncome = revenueActuals.filter((r) => r.costCenterId === cc).reduce((s, r) => s + r.amount, 0)
    const realExpenses = realizedCosts.costCenterTotals[cc]
    return { cc, planIncome, realIncome, planExpenses: 0, realExpenses }
  })

  return (
    <DashboardView
      year={year}
      currentMonth={currentMonth}
      planIncomeByMonth={planIncomeByMonth}
      realIncomeByMonth={realIncomeByMonth}
      realExpensesByMonth={realExpensesByMonth}
      fixedCostsByMonth={fixedCostsByMonth}
      variableCostsByMonth={variableCostsByMonth}
      ccBreakdown={ccBreakdown}
      userName={session.user.name ?? ''}
      prevYearTotalIncome={prevYearTotalIncome}
      prevYearTotalExpenses={prevYearTotalExpenses}
      cashAccounts={cashAccounts}
      receivables={receivables}
      latestLiability={latestLiability}
      thresholds={thresholds}
      eurRate={eurRate}
      eurRateDate={eurRateDate}
      isAdmin={session.user.role === 'ADMIN'}
    />
  )
}
