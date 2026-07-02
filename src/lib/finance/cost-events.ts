import { validateCostParts, type FinanceCostCenterId } from '@/lib/finance/cost-control'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export interface KsefInvoiceForCostEvent {
  id: string
  currency: string
  originalCurrency?: string | null
  issueDate: Date
  supplierName: string
  supplierNip: string | null
  invoiceNumber: string
  grossAmount: number
  netAmount: number | null
  vatAmount: number | null
  reportingGrossAmount?: number | null
  reportingNetAmount?: number | null
  reportingVatAmount?: number | null
  currencyConversionNote?: string | null
  costCenterId?: string | null
  subCategoryId?: string | null
  parts: Array<{
    label: string
    grossAmount: number
    tags: Array<{ tagId: string }>
    allocations: Array<{ costCenterId: string; percent: number }>
  }>
}

export function buildCostEventDraftFromKsefInvoice(invoice: KsefInvoiceForCostEvent) {
  const isForeignCurrency = invoice.currency !== 'PLN'
  if (isForeignCurrency && invoice.reportingGrossAmount == null) {
    throw new Error('Faktura w walucie obcej wymaga ręcznego przeliczenia na PLN przed zatwierdzeniem.')
  }
  const reportingGrossAmount = roundMoney(invoice.reportingGrossAmount ?? invoice.grossAmount)
  const reportingNetAmount = invoice.reportingNetAmount ?? invoice.netAmount
  const reportingVatAmount = invoice.reportingVatAmount ?? invoice.vatAmount

  const parts = invoice.parts.length > 0
    ? invoice.parts.map((part) => ({
        label: part.label,
        grossAmount: roundMoney(part.grossAmount),
        tagIds: part.tags.map((tag) => tag.tagId),
        allocations: part.allocations.map((allocation) => ({
          costCenterId: allocation.costCenterId as FinanceCostCenterId,
          percent: allocation.percent,
          fallbackUsed: false,
        })),
      }))
    : [{
        label: invoice.invoiceNumber,
        grossAmount: reportingGrossAmount,
        tagIds: [],
        allocations: [{
          costCenterId: (invoice.costCenterId ?? 'GLOBAL') as FinanceCostCenterId,
          percent: 100,
          fallbackUsed: false,
        }],
      }]

  const validation = validateCostParts(reportingGrossAmount, parts)
  if (!validation.ok) throw new Error(validation.error)

  return {
    source: 'KSEF',
    sourceInvoiceId: invoice.id,
    eventDate: invoice.issueDate,
    supplierName: invoice.supplierName,
    supplierNip: invoice.supplierNip,
    reference: invoice.invoiceNumber,
    grossAmount: reportingGrossAmount,
    netAmount: reportingNetAmount == null ? null : roundMoney(reportingNetAmount),
    vatAmount: reportingVatAmount == null ? null : roundMoney(reportingVatAmount),
    currency: 'PLN',
    originalCurrency: isForeignCurrency ? invoice.currency : null,
    originalGrossAmount: isForeignCurrency ? roundMoney(invoice.grossAmount) : null,
    currencyConversionNote: isForeignCurrency ? invoice.currencyConversionNote : null,
    parts,
  }
}
