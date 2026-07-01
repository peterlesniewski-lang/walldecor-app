import { roundMoney } from '@/lib/finance/ksef-inbox'

export interface SupplierSpendInput {
  supplierName: string | null
  supplierNip: string | null
  grossAmount: number
}

export interface CostWarningInvoiceInput {
  status: string
  documentStatus: string
  currency: string
  grossAmount: number
  reportingGrossAmount?: number | null
}

export interface AllocatedCostEventInput {
  parts: Array<{
    grossAmount: number
    allocations: Array<{ costCenterId: string; percent: number }>
  }>
}

export function summarizeSupplierSpend(events: SupplierSpendInput[]) {
  const rows = new Map<string, { key: string; supplierName: string; supplierNip: string | null; grossAmount: number }>()

  for (const event of events) {
    const key = event.supplierNip || event.supplierName || 'Nieznany dostawca'
    const current = rows.get(key)
    if (current) {
      current.grossAmount = roundMoney(current.grossAmount + event.grossAmount)
      continue
    }
    rows.set(key, {
      key,
      supplierName: event.supplierName || 'Nieznany dostawca',
      supplierNip: event.supplierNip,
      grossAmount: roundMoney(event.grossAmount),
    })
  }

  return [...rows.values()].sort((a, b) => b.grossAmount - a.grossAmount)
}

export function buildCostWarningTotal(invoices: CostWarningInvoiceInput[]) {
  return roundMoney(invoices.reduce((sum, invoice) => {
    const needsDecision = invoice.status === 'NEW' || invoice.status === 'MAPPED'
    const unresolvedCorrection = invoice.documentStatus === 'CORRECTION' && invoice.status !== 'APPROVED'
    const unconvertedCurrency = invoice.currency !== 'PLN' && invoice.reportingGrossAmount == null
    return needsDecision || unresolvedCorrection || unconvertedCurrency
      ? sum + invoice.grossAmount
      : sum
  }, 0))
}

export function filterConfidentialCostEvents<T extends { isConfidential: boolean }>(events: T[], role: string | undefined) {
  if (role === 'ADMIN') return events
  return events.filter((event) => !event.isConfidential)
}

export function sumAllocatedCostsByCenter(events: AllocatedCostEventInput[]) {
  const totals: Record<'JAG' | 'PUL' | 'GLOBAL', number> = { JAG: 0, PUL: 0, GLOBAL: 0 }

  for (const event of events) {
    for (const part of event.parts) {
      for (const allocation of part.allocations) {
        if (allocation.costCenterId !== 'JAG' && allocation.costCenterId !== 'PUL' && allocation.costCenterId !== 'GLOBAL') continue
        totals[allocation.costCenterId] = roundMoney(totals[allocation.costCenterId] + part.grossAmount * allocation.percent / 100)
      }
    }
  }

  return totals
}

export interface BreakEvenReportInput {
  revenue: Array<{ costCenterId: string; amount: number }>
  allocatedCosts: Array<{ costCenterId: string; fixedCosts: number; variableCosts: number; cogs: number }>
  contributionMargins: Record<string, number>
  warningAmount: number
}

export function buildBreakEvenReport(input: BreakEvenReportInput) {
  const centers = ['JAG', 'PUL', 'GLOBAL'] as const
  const byCostCenter = Object.fromEntries(centers.map((center) => {
    const revenue = roundMoney(input.revenue.filter((row) => row.costCenterId === center).reduce((sum, row) => sum + row.amount, 0))
    const costs = input.allocatedCosts
      .filter((row) => row.costCenterId === center)
      .reduce((sum, row) => ({
        fixedCosts: roundMoney(sum.fixedCosts + row.fixedCosts),
        variableCosts: roundMoney(sum.variableCosts + row.variableCosts),
        cogs: roundMoney(sum.cogs + row.cogs),
      }), { fixedCosts: 0, variableCosts: 0, cogs: 0 })
    const margin = input.contributionMargins[center]
    const breakEvenTurnover = margin ? roundMoney(costs.fixedCosts / margin) : null

    return [center, {
      revenue,
      ...costs,
      contributionMargin: margin ?? null,
      breakEvenTurnover,
      delta: breakEvenTurnover == null ? null : roundMoney(revenue - breakEvenTurnover),
      warning: margin ? null : 'missing contribution margin',
    }]
  }))

  return {
    byCostCenter,
    warningAmount: input.warningAmount,
  }
}

export function selectClosedMonthsForHistoricalMargin(
  periodCloses: Array<{ year: number; month: number }>,
  currentYear: number,
  currentMonth: number
) {
  return periodCloses
    .filter((period) => period.year < currentYear || (period.year === currentYear && period.month < currentMonth))
    .sort((a, b) => (b.year - a.year) || (b.month - a.month))
    .slice(0, 3)
}

export function resolveContributionMargin(input: { historical: number | null; manualOverride?: number | null }) {
  return input.manualOverride ?? input.historical
}
