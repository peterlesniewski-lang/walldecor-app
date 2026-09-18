import { prisma } from '@/lib/prisma'
import { buildActualDashboard, dashboardToday, type ActualDashboardModel, type DashboardPeriod } from '@/lib/finance/actual-dashboard'
import { isActiveInvoiceMoneyRow } from '@/lib/finance/invoice-money-scope'

/** Financial model only. Callers enforce ADMIN access; no cash, alerts or external services are loaded here. */
export async function loadActualDashboardModel(period: DashboardPeriod, now = new Date()): Promise<ActualDashboardModel> {
  const { year, month } = period
  const throughSelectedMonth = { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year, month, 1)) }
  const previousThroughMonth = { gte: new Date(Date.UTC(year - 1, 0, 1)), lt: new Date(Date.UTC(year - 1, month, 1)) }
  const parts = { include: { tags: { include: { tag: true } }, allocations: true } }
  const [revenue, previousRevenue, actualEntries, previousActualEntries, costEvents, previousCostEvents,
    pendingInvoiceRows, closedPeriods, pendingCostEvents] = await Promise.all([
    prisma.revenue.findMany({ where: { year, month: { lte: month } } }),
    prisma.revenue.findMany({ where: { year: year - 1, month: { lte: month } } }),
    prisma.actualEntry.findMany({ where: { year, month: { lte: month } }, include: { subCategory: { select: { isFixed: true } } } }),
    prisma.actualEntry.findMany({ where: { year: year - 1, month: { lte: month } }, include: { subCategory: { select: { isFixed: true } } } }),
    prisma.costEvent.findMany({ where: { status: 'APPROVED', eventDate: throughSelectedMonth }, include: { parts } }),
    prisma.costEvent.findMany({ where: { status: 'APPROVED', eventDate: previousThroughMonth }, include: { parts } }),
    prisma.ksefInvoice.findMany({
      where: { status: { in: ['NEW', 'MAPPED'] }, documentStatus: { not: 'CANCELLED' }, OR: [{ issueDate: throughSelectedMonth }, { issueDate: previousThroughMonth }] },
      select: { id: true, issueDate: true, grossAmount: true, reportingGrossAmount: true, currency: true,
        invoiceImportDraft: { select: { state: true } } },
    }),
    prisma.financePeriodClose.findMany({ where: { year: { in: [year, year - 1] }, month: { lte: month } }, select: { year: true, month: true } }),
    prisma.costEvent.findMany({
      // VOID is retained audit history after unapproval, not an unresolved draft.
      where: { status: 'DRAFT', documentStatus: { not: 'CANCELLED' }, OR: [{ eventDate: throughSelectedMonth }, { eventDate: previousThroughMonth }] },
      select: { id: true, sourceInvoiceId: true, eventDate: true },
    }),
  ])
  // After revoke this row is the previous approved snapshot. OPEN/ARCHIVED
  // imports are handled in the import queue, not as current pending KSeF money.
  const pendingInvoices = pendingInvoiceRows.filter(isActiveInvoiceMoneyRow)
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
  return buildActualDashboard({ period, today: dashboardToday(now), revenue, previousRevenue, actualEntries, previousActualEntries, costEvents, previousCostEvents, waitingInvoices, closedPeriods, pendingCostPeriods })
}
