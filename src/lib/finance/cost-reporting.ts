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
