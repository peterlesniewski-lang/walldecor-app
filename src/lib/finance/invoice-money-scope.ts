export interface InvoiceMoneyScopeInput {
  documentStatus?: string | null
  invoiceImportDraft?: { state: string } | null
}

/** Only active documents may contribute to current invoice money summaries. */
export function isActiveInvoiceMoneyRow(invoice: InvoiceMoneyScopeInput) {
  if (invoice.documentStatus === 'CANCELLED') return false
  return invoice.invoiceImportDraft == null || invoice.invoiceImportDraft.state === 'APPROVED'
}
