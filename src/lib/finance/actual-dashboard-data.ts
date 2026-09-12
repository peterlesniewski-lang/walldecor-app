import { prisma } from '@/lib/prisma'
import { dashboardToday, type DashboardPeriod } from '@/lib/finance/actual-dashboard'
import { loadActualDashboardModel } from '@/lib/finance/actual-dashboard-model-data'
import type { AlertNotification, PaymentReminderWithDays } from '@/components/alerts/alerts-widget'

/** Shared server loader for / and /dashboard. Cash and alerts always describe the current state. */
export async function loadActualDashboardData(period: DashboardPeriod, userId: string, now = new Date()) {
  const [model, accounts, receivables, latestLiability, settings, notifications, reminders] = await Promise.all([
    loadActualDashboardModel(period, now),
    prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { order: 'asc' }, include: { salonCashSettings: { select: { costCenterId: true } } } }),
    prisma.receivableEntry.findMany({ orderBy: { dueDate: 'asc' } }),
    prisma.cashLiabilitySnapshot.findFirst({ orderBy: { date: 'desc' } }),
    prisma.appSetting.findMany({ where: { key: { in: ['cashThresholdVeryGood', 'cashThresholdGood', 'cashThresholdBad'] } } }),
    prisma.notification.findMany({ where: { userId, type: { in: ['budget_warning', 'budget_critical'] }, isRead: false, createdAt: { gte: new Date(now.getTime() - 7 * 86400000) } }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.paymentReminder.findMany({ where: { active: true } }),
  ])
  const today = dashboardToday(now)
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
