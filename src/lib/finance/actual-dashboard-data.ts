import { prisma } from '@/lib/prisma'
import { buildActualDashboard, dashboardToday, type DashboardPeriod } from '@/lib/finance/actual-dashboard'
import type { AlertNotification, PaymentReminderWithDays } from '@/components/alerts/alerts-widget'

/** Shared server loader for / and /dashboard. Cash and alerts always describe the current state. */
export async function loadActualDashboardData(period: DashboardPeriod, userId: string, now = new Date()) {
  const { year, month } = period
  const throughSelectedMonth = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year, month, 1)) }
  const previousThroughMonth = { gte: new Date(Date.UTC(year - 1, 0, 1)), lt: new Date(Date.UTC(year - 1, month, 1)) }
  const parts = { include: { tags: { include: { tag: true } }, allocations: true } }
  const [revenue, previousRevenue, actualEntries, previousActualEntries, costEvents, previousCostEvents,
    pendingInvoices, accounts, receivables, latestLiability, settings, notifications, reminders, closedPeriods, pendingCostEvents] = await Promise.all([
    prisma.revenue.findMany({ where: { year, month: { lte: month } } }),
    prisma.revenue.findMany({ where: { year: year - 1, month: { lte: month } } }),
    prisma.actualEntry.findMany({ where: { year, month: { lte: month } }, include: { subCategory: { select: { isFixed: true } } } }),
    prisma.actualEntry.findMany({ where: { year: year - 1, month: { lte: month } }, include: { subCategory: { select: { isFixed: true } } } }),
    prisma.costEvent.findMany({ where: { status: 'APPROVED', eventDate: throughSelectedMonth }, include: { parts } }),
    prisma.costEvent.findMany({ where: { status: 'APPROVED', eventDate: previousThroughMonth }, include: { parts } }),
    prisma.ksefInvoice.findMany({
      where: { status: { in: ['NEW', 'MAPPED'] }, documentStatus: { not: 'CANCELLED' }, OR: [{ issueDate: throughSelectedMonth }, { issueDate: previousThroughMonth }] },
      select: { id: true, issueDate: true, grossAmount: true, reportingGrossAmount: true, currency: true },
    }),
    prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { order: 'asc' }, include: { salonCashSettings: { select: { costCenterId: true } } } }),
    prisma.receivableEntry.findMany({ orderBy: { dueDate: 'asc' } }),
    prisma.cashLiabilitySnapshot.findFirst({ orderBy: { date: 'desc' } }),
    prisma.appSetting.findMany({ where: { key: { in: ['cashThresholdVeryGood', 'cashThresholdGood', 'cashThresholdBad'] } } }),
    prisma.notification.findMany({ where: { userId, type: { in: ['budget_warning', 'budget_critical'] }, isRead: false, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.paymentReminder.findMany({ where: { active: true } }),
    prisma.financePeriodClose.findMany({ where: { year: { in: [year, year - 1] }, month: { lte: month } }, select: { year: true, month: true } }),
    prisma.costEvent.findMany({
      // VOID is retained audit history after unapproval, not an unresolved draft.
      where: { status: 'DRAFT', documentStatus: { not: 'CANCELLED' }, OR: [{ eventDate: throughSelectedMonth }, { eventDate: previousThroughMonth }] },
      select: { id: true, sourceInvoiceId: true, eventDate: true },
    }),
  ])
  const today = dashboardToday(now)
  // Dates are document/business dates stored in UTC, matching recognized-cost month selection.
  const waitingInvoices = pendingInvoices.filter((invoice) => invoice.issueDate.getUTCFullYear() === year && invoice.issueDate.getUTCMonth() + 1 === month)
  const pendingByPeriod = new Map<string, { year: number; month: number; documents: Set<string> }>()
  const addPending = (date: Date, documentId: string) => {
    const documentYear = date.getUTCFullYear()
    const documentMonth = date.getUTCMonth() + 1
    const key = `${documentYear}-${documentMonth}`
    const entry = pendingByPeriod.get(key) ?? { year: documentYear, month: documentMonth, documents: new Set<string>() }
    entry.documents.add(documentId)
    pendingByPeriod.set(key, entry)
  }
  for (const invoice of pendingInvoices) addPending(invoice.issueDate, `invoice:${invoice.id}`)
  for (const event of pendingCostEvents) addPending(event.eventDate, event.sourceInvoiceId ? `invoice:${event.sourceInvoiceId}` : `event:${event.id}`)
  const pendingCostPeriods = [...pendingByPeriod.values()].map(({ year: pendingYear, month: pendingMonth, documents }) => ({ year: pendingYear, month: pendingMonth, count: documents.size }))
  const model = buildActualDashboard({ period, today, revenue, previousRevenue, actualEntries, previousActualEntries, costEvents, previousCostEvents, waitingInvoices, closedPeriods, pendingCostPeriods })
  let eurRate: number | null = null
  let eurRateDate: string | null = null
  if (accounts.some((account) => account.currency === 'EUR' && account.balance !== 0)) {
    try {
      const response = await fetch('https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json', { signal: AbortSignal.timeout(3000), next: { revalidate: 3600 } })
      if (response.ok) {
        const body = await response.json() as { rates?: Array<{ mid?: number; effectiveDate?: string }> }
        const rate = body.rates?.[0]
        if (typeof rate?.mid === 'number' && Number.isFinite(rate.mid) && rate.mid > 0 && typeof rate.effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rate.effectiveDate)) {
          eurRate = rate.mid
          eurRateDate = rate.effectiveDate
        }
      }
    } catch {
      // Missing rates are surfaced by the view; no invented conversion.
    }
  }
  const threshold = (key: string, fallback: number) => {
    const value = settings.find((row) => row.key === key)?.value
    const parsed = value === undefined ? NaN : Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
  const budgetAlerts: AlertNotification[] = notifications.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
  const paymentAlerts: PaymentReminderWithDays[] = []
  const businessToday = new Date(`${today}T00:00:00Z`)
  for (const reminder of reminders) {
    const currentYear = businessToday.getUTCFullYear()
    const currentMonth = businessToday.getUTCMonth()
    const dueInMonth = (monthIndex: number) => new Date(Date.UTC(currentYear, monthIndex, Math.min(reminder.dayOfMonth, new Date(Date.UTC(currentYear, monthIndex + 1, 0)).getUTCDate())))
    let nextDue = dueInMonth(currentMonth)
    if (nextDue < businessToday) nextDue = dueInMonth(currentMonth + 1)
    const daysUntilDue = Math.round((nextDue.getTime() - businessToday.getTime()) / 86400000)
    if (daysUntilDue <= reminder.alertDaysInAdvance && daysUntilDue >= 0) paymentAlerts.push({ ...reminder, daysUntilDue })
  }
  return {
    model,
    cashAccounts: accounts.map(({ salonCashSettings, ...account }) => ({ ...account, managedByCashier: salonCashSettings !== null })),
    receivables, latestLiability,
    thresholds: { cashThresholdVeryGood: threshold('cashThresholdVeryGood', 300000), cashThresholdGood: threshold('cashThresholdGood', 200000), cashThresholdBad: threshold('cashThresholdBad', 100000) },
    eurRate, eurRateDate, budgetAlerts, paymentAlerts,
  }
}
