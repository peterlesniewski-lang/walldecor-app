export type InvoiceBusinessIdentityInput = {
  supplierName: string
  taxId?: string | null
  invoiceNumber: string
  issueDate: string
}

export type InvoiceBusinessIdentity = {
  supplierNameKey: string
  taxIdKey: string | null
  invoiceNumberKey: string
  issueDateKey: string
}

function normalizeCaseAndWhitespace(value: string): string {
  // Uppercase-then-lowercase collapses Turkish dotless ı into ASCII i, which is
  // too aggressive for duplicate detection. Keep lowercase conservative and
  // fold only sharp-s, whose uppercase spelling is routinely stored as SS.
  return value.normalize('NFKC').toLowerCase().replace(/ß/gu, 'ss').trim().replace(/\s+/gu, ' ')
}

export function normalizeTaxIdForComparison(value: string): string {
  const canonical = (value.normalize('NFKC').toUpperCase().match(/[\p{L}\p{N}]/gu) ?? []).join('')
  return /^PL\d{10}$/u.test(canonical) ? canonical.slice(2) : canonical
}

export function normalizeSupplierNameForComparison(value: string): string {
  return normalizeCaseAndWhitespace(value)
}

export function normalizeInvoiceNumberForComparison(value: string): string {
  return normalizeCaseAndWhitespace(value)
}

export function invoiceBusinessIdentity(input: InvoiceBusinessIdentityInput): InvoiceBusinessIdentity {
  const normalizedTaxId = input.taxId == null ? null : normalizeTaxIdForComparison(input.taxId)
  return {
    supplierNameKey: normalizeSupplierNameForComparison(input.supplierName),
    taxIdKey: normalizedTaxId === '' ? null : normalizedTaxId,
    invoiceNumberKey: normalizeInvoiceNumberForComparison(input.invoiceNumber),
    issueDateKey: input.issueDate.normalize('NFKC').trim(),
  }
}

export function isPossibleInvoiceDuplicate(
  left: InvoiceBusinessIdentity,
  right: InvoiceBusinessIdentity,
): boolean {
  if (left.issueDateKey !== right.issueDateKey || left.invoiceNumberKey !== right.invoiceNumberKey) {
    return false
  }

  if (left.taxIdKey != null && left.taxIdKey !== ''
    && right.taxIdKey != null && right.taxIdKey !== '') {
    return left.taxIdKey === right.taxIdKey
  }

  return left.supplierNameKey === right.supplierNameKey
}
