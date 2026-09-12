import { calculatePaymentAgingBucket, type PaymentAgingBucket } from './cost-control'

export interface InvoiceMoneyInput {
  currency: string
  grossAmount: number
  reportingGrossAmount?: number | null
}

export interface InvoiceMoneySummary {
  plnAmount: number
  unconvertedCount: number
  unconvertedByCurrency: Array<{ currency: string; amount: number; count: number }>
}

export const INVOICE_PAYMENT_AGING_BUCKETS: readonly PaymentAgingBucket[] = [
  'OVERDUE', 'DUE_0_7', 'DUE_8_14', 'DUE_15_30', 'LATER', 'MISSING_DUE_DATE',
]

/** Reporting amounts are already PLN. Nominal foreign amounts are never PLN. */
export function summarizeInvoiceMoney(invoices: readonly InvoiceMoneyInput[]): InvoiceMoneySummary {
  let plnCents = 0
  let unconvertedCount = 0
  const unconverted = new Map<string, { cents: number; count: number }>()
  for (const invoice of invoices) {
    const currency = invoice.currency.trim().toUpperCase()
    const plnAmount = invoice.reportingGrossAmount ?? (currency === 'PLN' ? invoice.grossAmount : null)
    if (plnAmount !== null) {
      plnCents += Math.round(plnAmount * 100)
    } else {
      unconvertedCount++
      const current = unconverted.get(currency) ?? { cents: 0, count: 0 }
      current.cents += Math.round(invoice.grossAmount * 100)
      current.count++
      unconverted.set(currency, current)
    }
  }
  return {
    plnAmount: plnCents / 100,
    unconvertedCount,
    unconvertedByCurrency: [...unconverted].sort(([left], [right]) => left.localeCompare(right)).map(([currency, row]) => ({
      currency, amount: row.cents / 100, count: row.count,
    })),
  }
}

export interface InvoicePaymentInput extends InvoiceMoneyInput {
  paymentStatus: string
  dueDate: Date | null
}

/** Full document amounts, not a calculated remaining balance. Consumers must
 * disclose uncertainPaymentCount for PARTIAL/UNKNOWN or other unknown states. */
export function summarizeInvoicePayments(invoices: readonly InvoicePaymentInput[], now = new Date()) {
  const unpaid = invoices.filter((invoice) => invoice.paymentStatus !== 'PAID')
  const byBucket = new Map<PaymentAgingBucket, InvoicePaymentInput[]>(
    INVOICE_PAYMENT_AGING_BUCKETS.map((bucket) => [bucket, []]),
  )
  for (const invoice of unpaid) byBucket.get(calculatePaymentAgingBucket(invoice.dueDate, now))!.push(invoice)
  const paymentAging = Object.fromEntries(INVOICE_PAYMENT_AGING_BUCKETS.map((bucket) => {
    const rows = byBucket.get(bucket)!
    return [bucket, { count: rows.length, ...summarizeInvoiceMoney(rows) }]
  })) as Record<PaymentAgingBucket, InvoiceMoneySummary & { count: number }>
  return {
    gross: summarizeInvoiceMoney(invoices),
    unpaid: summarizeInvoiceMoney(unpaid),
    unpaidCount: unpaid.length,
    uncertainPaymentCount: unpaid.filter((invoice) => invoice.paymentStatus !== 'UNPAID').length,
    paymentAging,
  }
}
