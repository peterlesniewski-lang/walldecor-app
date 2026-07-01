import { resolveSupplierRuleDecision } from '@/lib/finance/cost-control'

export type KsefInvoiceStatus = 'NEW' | 'MAPPED' | 'APPROVED' | 'IGNORED'

export interface SupplierMatchInput {
  supplierName: string
  supplierNip?: string | null
}

export interface SupplierRuleInput {
  id: string
  supplierNamePattern?: string | null
  supplierNip?: string | null
  costCenterId: string
  subCategoryId: string
  active: boolean
  priority?: number | null
  tags?: Array<{ tagId: string }>
}

export type SupplierRuleMatchDecision =
  | { status: 'NO_RULE' }
  | { status: 'MATCHED'; rule: SupplierRuleInput }
  | { status: 'CONFLICT'; rules: SupplierRuleInput[] }

export interface KsefInvoiceActualInput {
  issueDate: Date
  grossAmount: number
  costCenterId: string
  subCategoryId: string
}

export interface KsefInvoiceActualPayload {
  year: number
  month: number
  amount: number
  costCenterId: string
  subCategoryId: string
}

export function roundMoney(amount: number) {
  return Math.round(amount * 100) / 100
}

export function normalizeSupplierNip(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

export function findMatchingSupplierRule(
  invoice: SupplierMatchInput,
  rules: SupplierRuleInput[]
) {
  const decision = resolveSupplierRuleMatch(invoice, rules)
  return decision.status === 'MATCHED' ? decision.rule : null
}

export function supplierMatchesRule(invoice: SupplierMatchInput, rule: SupplierRuleInput) {
  return findMatchingSupplierRule(invoice, [rule])?.id === rule.id
}

export function resolveSupplierRuleMatch(
  invoice: SupplierMatchInput,
  rules: SupplierRuleInput[]
): SupplierRuleMatchDecision {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]))
  const decision = resolveSupplierRuleDecision(
    invoice,
    rules.map((rule) => ({
      id: rule.id,
      active: rule.active,
      priority: rule.priority ?? 100,
      supplierNamePattern: rule.supplierNamePattern,
      supplierNip: rule.supplierNip,
    }))
  )

  if (decision.status === 'NO_MATCH') return { status: 'NO_RULE' }
  if (decision.status === 'MATCHED') {
    const rule = ruleById.get(decision.ruleId)
    return rule ? { status: 'MATCHED', rule } : { status: 'NO_RULE' }
  }

  return {
    status: 'CONFLICT',
    rules: decision.conflictingRuleIds
      .map((id) => ruleById.get(id))
      .filter((rule): rule is SupplierRuleInput => Boolean(rule)),
  }
}

export function buildActualEntryFromKsefInvoice(
  invoice: KsefInvoiceActualInput
): KsefInvoiceActualPayload {
  return {
    year: invoice.issueDate.getFullYear(),
    month: invoice.issueDate.getMonth() + 1,
    amount: roundMoney(invoice.grossAmount),
    costCenterId: invoice.costCenterId,
    subCategoryId: invoice.subCategoryId,
  }
}
