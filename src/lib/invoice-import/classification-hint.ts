import type { InvoiceDraftData } from './contracts'
import { normalizeSupplierNameForComparison, normalizeTaxIdForComparison } from './identity'

export interface InvoiceClassificationRule {
  id: string
  active: boolean
  supplierNip?: string | null
  supplierNamePattern?: string | null
  priority?: number | null
  costCenterId: string
  tagIds: string[]
}
export type InvoiceClassificationHint =
  | { status: 'NO_RULE' }
  | { status: 'CONFLICT'; ruleIds: string[] }
  | { status: 'MATCHED'; rule: InvoiceClassificationRule }

function best(rules: readonly InvoiceClassificationRule[]): InvoiceClassificationHint {
  if (!rules.length) return { status: 'NO_RULE' }
  const priority = Math.min(...rules.map((rule) => rule.priority ?? 100))
  const candidates = rules.filter((rule) => (rule.priority ?? 100) === priority)
  return candidates.length === 1
    ? { status: 'MATCHED', rule: candidates[0] }
    : { status: 'CONFLICT', ruleIds: candidates.map((rule) => rule.id).sort() }
}

/** A suggestion only: no classification write and no supplier-rule mutation.
 * Full foreign identifiers use the same conservative identity as approval. */
export function invoiceClassificationHint(
  draft: InvoiceDraftData,
  rules: readonly InvoiceClassificationRule[],
): InvoiceClassificationHint {
  const active = rules.filter((rule) => rule.active)
  const taxId = draft.taxId ? normalizeTaxIdForComparison(draft.taxId) : ''
  const byTaxId = taxId ? active.filter((rule) => rule.supplierNip && normalizeTaxIdForComparison(rule.supplierNip) === taxId) : []
  if (byTaxId.length) return best(byTaxId)
  const supplier = normalizeSupplierNameForComparison(draft.supplierName ?? '')
  if (!supplier) return { status: 'NO_RULE' }
  const byName = active.filter((rule) => {
    const pattern = normalizeSupplierNameForComparison(rule.supplierNamePattern ?? '')
    return Boolean(pattern) && supplier.includes(pattern)
  })
  const exact = byName.filter((rule) => normalizeSupplierNameForComparison(rule.supplierNamePattern ?? '') === supplier)
  return best(exact.length ? exact : byName)
}
