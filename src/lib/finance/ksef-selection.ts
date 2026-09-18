export interface SelectableKsefInvoice {
  id: string
  grossAmount: number
  currency: string
  paymentStatus?: string
}

export function selectedInvoiceTotals(invoices: SelectableKsefInvoice[]) {
  const amounts = new Map<string, number>()
  for (const invoice of invoices) {
    // Add integer minor units, keeping currencies and credit notes separate.
    amounts.set(invoice.currency, (amounts.get(invoice.currency) ?? 0) + Math.round(invoice.grossAmount * 100))
  }
  return [...amounts.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => ({ currency, amount: cents / 100 }))
}

export function warsawToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date())
}

export interface BulkPaymentResult {
  id: string
  outcome: 'paid' | 'already_paid' | 'failed'
  error?: string
}
