import { COST_CENTER_CHANNELS, CHANNEL_LABELS, type RevenueChannel } from '@/lib/validations/revenue'
import { FINANCE_COST_CENTERS, type FinanceCostCenterId } from '@/lib/finance/company-health'
import { buildRealizedCostSummary, type RealizedActualEntryInput, type RealizedCostEventInput } from '@/lib/finance/realized-costs'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export interface DashboardPeriod { year: number; month: number }
export type DashboardSearchParams = { year?: string | string[]; month?: string | string[] }
export interface DashboardRevenue extends DashboardPeriod {
  costCenterId: string
  channel: string
  amount: number
  asOfDate?: string | null
}
export interface DashboardChannel {
  costCenterId: string
  channel: string
  label: string
  amount: number | null
  asOfDate: string | null
  status: 'missing' | 'unknown' | 'partial' | 'complete'
}
export interface DashboardMonth {
  month: number
  revenue: number | null
  costs: number
  result: number | null
  hasCosts: boolean
  periodClosed: boolean
  pendingDocumentCount: number
  costsConfirmed: boolean
  complete: boolean
  partialMonth: boolean
  futureMonth: boolean
  channels: DashboardChannel[]
}
export interface DashboardInput {
  period: DashboardPeriod
  today: string
  revenue: DashboardRevenue[]
  previousRevenue: DashboardRevenue[]
  actualEntries: RealizedActualEntryInput[]
  costEvents: RealizedCostEventInput[]
  previousActualEntries: RealizedActualEntryInput[]
  previousCostEvents: RealizedCostEventInput[]
  waitingInvoices: Array<{ currency: string; grossAmount: number; reportingGrossAmount?: number | null }>
  /** Explicit company-level confirmation; never inferred from the existence of a cost row. */
  closedPeriods?: DashboardPeriod[]
  /** Active invoices/cost documents awaiting a decision, for both compared years. */
  pendingCostPeriods?: Array<DashboardPeriod & { count: number }>
}

export function dashboardToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Both routes use the same strict period contract; an invalid query never broadens the report. */
export function resolveDashboardPeriod(query: DashboardSearchParams, now = new Date()): { ok: true; period: DashboardPeriod } | { ok: false; error: string } {
  const today = dashboardToday(now)
  const currentYear = Number(today.slice(0, 4))
  const currentMonth = Number(today.slice(5, 7))
  const validYear = query.year === undefined || (typeof query.year === 'string' && /^\d{4}$/.test(query.year) && Number(query.year) >= 2020 && Number(query.year) <= 2100)
  const validMonth = query.month === undefined || (typeof query.month === 'string' && /^(0?[1-9]|1[0-2])$/.test(query.month))
  if (!validYear || !validMonth) return { ok: false, error: 'Wybierz rok od 2020 do 2100 i miesiąc od 1 do 12.' }
  const year = query.year === undefined ? currentYear : Number(query.year)
  const month = query.month === undefined ? (year === currentYear ? currentMonth : year < currentYear ? 12 : 1) : Number(query.month)
  return { ok: true, period: { year, month } }
}

function monthKey(year: number, month: number) { return `${year}-${String(month).padStart(2, '0')}` }
function sum(values: number[]) { return roundMoney(values.reduce((total, amount) => total + amount, 0)) }

function channelRows(rows: DashboardRevenue[], year: number, month: number, today: string): DashboardChannel[] {
  const expected = Object.entries(COST_CENTER_CHANNELS).flatMap(([costCenterId, channels]) => channels.map((channel) => ({ costCenterId, channel })))
  const extras = rows.filter((row) => !expected.some((item) => item.costCenterId === row.costCenterId && item.channel === row.channel))
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  return [...expected, ...extras].map(({ costCenterId, channel }) => {
    const row = rows.find((item) => item.costCenterId === costCenterId && item.channel === channel)
    const asOfDate = row?.asOfDate ?? null
    const validDate = asOfDate != null && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate)
      && asOfDate >= `${monthKey(year, month)}-01` && asOfDate <= lastDay && asOfDate <= today
    return {
      costCenterId, channel, label: CHANNEL_LABELS[channel as RevenueChannel] ?? channel,
      amount: row?.amount ?? null, asOfDate: validDate ? asOfDate : null,
      status: !row ? 'missing' : !validDate ? 'unknown' : asOfDate === lastDay ? 'complete' : 'partial',
    }
  })
}

/** Report values are actuals only. Presence and freshness are independent of the amount (including zero). */
export function buildActualDashboard(input: DashboardInput) {
  const { year, month } = input.period
  const realized = buildRealizedCostSummary({ year, actualEntries: input.actualEntries, costEvents: input.costEvents })
  const previousRealized = buildRealizedCostSummary({ year: year - 1, actualEntries: input.previousActualEntries, costEvents: input.previousCostEvents })
  const makeMonth = (reportYear: number, reportMonth: number, revenues: DashboardRevenue[], costs: typeof realized): DashboardMonth => {
    const rows = revenues.filter((row) => row.year === reportYear && row.month === reportMonth)
    const channels = channelRows(rows, reportYear, reportMonth, input.today)
    const revenue = rows.length ? sum(rows.map((row) => row.amount)) : null
    const amount = costs.totalCostsByMonth[reportMonth - 1]
    const hasCosts = costs.monthlyRows.some((row) => row.month === reportMonth)
    const partialMonth = monthKey(reportYear, reportMonth) === input.today.slice(0, 7)
    const futureMonth = monthKey(reportYear, reportMonth) > input.today.slice(0, 7)
    const periodClosed = (input.closedPeriods ?? []).some((period) => period.year === reportYear && period.month === reportMonth)
    const pendingDocumentCount = input.pendingCostPeriods === undefined
      ? (reportYear === year && reportMonth === month ? input.waitingInvoices.length : 0)
      : input.pendingCostPeriods.filter((period) => period.year === reportYear && period.month === reportMonth).reduce((total, period) => total + period.count, 0)
    const costsConfirmed = periodClosed && pendingDocumentCount === 0
    return {
      month: reportMonth, revenue, costs: amount, result: revenue === null ? null : roundMoney(revenue - amount), hasCosts,
      periodClosed, pendingDocumentCount, costsConfirmed,
      complete: channels.every((channel) => channel.status === 'complete') && costsConfirmed && !partialMonth && !futureMonth,
      partialMonth, futureMonth, channels,
    }
  }
  const months = Array.from({ length: month }, (_, index) => makeMonth(year, index + 1, input.revenue, realized))
  const selected = months[month - 1]
  const previous = makeMonth(year - 1, month, input.previousRevenue, previousRealized)
  const ytdRevenue = months.some((row) => row.revenue !== null) ? sum(months.map((row) => row.revenue ?? 0)) : null
  const ytdCosts = sum(months.map((row) => row.costs))
  const byCenter = FINANCE_COST_CENTERS.map((costCenterId: FinanceCostCenterId) => {
    const rows = input.revenue.filter((row) => row.year === year && row.month === month && row.costCenterId === costCenterId)
    const revenue = rows.length ? sum(rows.map((row) => row.amount)) : costCenterId === 'GLOBAL' ? 0 : null
    const costRows = realized.monthlyRows.filter((row) => row.month === month && row.costCenterId === costCenterId)
    const costs = sum(costRows.map((row) => row.amount))
    return {
      costCenterId, revenue, costs, result: revenue === null ? null : roundMoney(revenue - costs),
      complete: selected.channels.filter((row) => row.costCenterId === costCenterId).every((row) => row.status === 'complete') && selected.costsConfirmed && !selected.partialMonth && !selected.futureMonth,
    }
  })
  const unconverted = new Map<string, number>()
  let waitingPln = 0
  for (const invoice of input.waitingInvoices) {
    if (invoice.reportingGrossAmount != null) waitingPln += invoice.reportingGrossAmount
    else if (invoice.currency === 'PLN') waitingPln += invoice.grossAmount
    else unconverted.set(invoice.currency, (unconverted.get(invoice.currency) ?? 0) + invoice.grossAmount)
  }
  return {
    period: input.period, today: input.today, selected, months, byCenter,
    ytd: { revenue: ytdRevenue, costs: ytdCosts, result: ytdRevenue === null ? null : roundMoney(ytdRevenue - ytdCosts), complete: months.every((row) => row.complete) },
    yoy: selected.complete && previous.complete ? { previous, revenueDelta: roundMoney(selected.revenue! - previous.revenue!), resultDelta: roundMoney(selected.result! - previous.result!) } : null,
    yoyReason: selected.partialMonth ? 'Miesiąc w toku — bez porównania z pełnym miesiącem poprzedniego roku.' : 'Brak porównywalnych pełnych danych rzeczywistych za oba miesiące: wymagane pełne przychody oraz potwierdzone koszty zamkniętych okresów bez oczekujących dokumentów.',
    waiting: { count: input.waitingInvoices.length, plnAmount: roundMoney(waitingPln), unconverted: [...unconverted].map(([currency, amount]) => ({ currency, amount: roundMoney(amount) })) },
  }
}

export type ActualDashboardModel = ReturnType<typeof buildActualDashboard>
