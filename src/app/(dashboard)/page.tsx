import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DashboardView } from '@/components/shared/dashboard-view'
import type { AlertNotification, PaymentReminderWithDays } from '@/components/alerts/alerts-widget'
import { buildRealizedCostSummary, costEventYearDateRange } from '@/lib/finance/realized-costs'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const year = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1 // 1-12

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

  // ─── Alerts data (ADMIN only) ─────────────────────────────────────────────
  let budgetAlerts: AlertNotification[] = []
  let paymentAlerts: PaymentReminderWithDays[] = []

  if (session.user.role === 'ADMIN') {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    // Recent unread budget alerts
    const userId = (session.user as { id?: string }).id
    if (userId) {
      const rawBudgetAlerts = await prisma.notification.findMany({
        where: {
          userId,
          type: { in: ['budget_warning', 'budget_critical'] },
          isRead: false,
          createdAt: { gte: sevenDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })
      budgetAlerts = rawBudgetAlerts.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        link: n.link,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      }))
    }

    // Upcoming payment reminders within alertDaysInAdvance
    const today = new Date()
    const activeReminders = await prisma.paymentReminder.findMany({
      where: { active: true },
    })

    for (const reminder of activeReminders) {
      const day = reminder.dayOfMonth
      const currentYear = today.getFullYear()
      const currentMonth = today.getMonth() + 1
      let nextDueDate = new Date(currentYear, currentMonth - 1, day)
      if (nextDueDate < today) {
        nextDueDate = new Date(currentYear, currentMonth, day)
      }
      const daysUntilDue = Math.ceil(
        (nextDueDate.getTime() - today.getTime()) / 86400000
      )
      if (daysUntilDue <= reminder.alertDaysInAdvance && daysUntilDue >= 0) {
        paymentAlerts.push({
          id: reminder.id,
          name: reminder.name,
          amount: reminder.amount,
          dayOfMonth: reminder.dayOfMonth,
          costCenterId: reminder.costCenterId,
          alertDaysInAdvance: reminder.alertDaysInAdvance,
          daysUntilDue,
        })
      }
    }
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
      budgetAlerts={budgetAlerts}
      paymentAlerts={paymentAlerts}
    />
  )
}
