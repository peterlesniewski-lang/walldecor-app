import { normalizeSupplierNip, roundMoney } from '@/lib/finance/ksef-inbox'

export type PaymentAgingBucket =
  | 'OVERDUE'
  | 'DUE_0_7'
  | 'DUE_8_14'
  | 'DUE_15_30'
  | 'LATER'
  | 'MISSING_DUE_DATE'

export type FinanceCostCenterId = 'JAG' | 'PUL' | 'GLOBAL'

export interface ResolvedAllocation {
  costCenterId: FinanceCostCenterId
  percent: number
}

export interface CostPartValidationInput {
  id?: string
  grossAmount: number
  allocations: ResolvedAllocation[]
}

export interface SupplierRuleDecisionRule {
  id: string
  active: boolean
  priority: number
  supplierNamePattern?: string | null
  supplierNip?: string | null
}

export type SupplierRuleDecision =
  | { status: 'NO_MATCH' }
  | { status: 'MATCHED'; ruleId: string }
  | { status: 'CONFLICT'; conflictingRuleIds: string[] }

export function calculatePaymentAgingBucket(dueDate: Date | null, now = new Date()): PaymentAgingBucket {
  if (!dueDate) return 'MISSING_DUE_DATE'

  const today = businessDateKey(now)
  const due = businessDateKey(dueDate)
  const diffDays = Math.floor(
    (Date.parse(`${due}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000
  )

  if (diffDays < 0) return 'OVERDUE'
  if (diffDays <= 7) return 'DUE_0_7'
  if (diffDays <= 14) return 'DUE_8_14'
  if (diffDays <= 30) return 'DUE_15_30'
  return 'LATER'
}

function businessDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function validateResolvedAllocation(allocations: ResolvedAllocation[]) {
  if (allocations.length === 0) {
    return { ok: false as const, error: 'Wymagana jest alokacja kosztu.' }
  }

  const total = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.percent, 0))
  if (total !== 100) {
    return { ok: false as const, error: 'Suma alokacji musi wynosić 100%.' }
  }

  return { ok: true as const }
}

export function validateCostParts(invoiceGrossAmount: number, parts: CostPartValidationInput[]) {
  const partsTotal = roundMoney(parts.reduce((sum, part) => sum + part.grossAmount, 0))
  if (partsTotal !== roundMoney(invoiceGrossAmount)) {
    return { ok: false as const, error: 'Suma części faktury musi być równa kwocie brutto faktury.' }
  }

  for (const part of parts) {
    const allocation = validateResolvedAllocation(part.allocations)
    if (!allocation.ok) return allocation
  }

  return { ok: true as const }
}

export function resolveSupplierRuleDecision(
  invoice: { supplierName: string; supplierNip?: string | null },
  rules: SupplierRuleDecisionRule[]
): SupplierRuleDecision {
  const activeRules = rules.filter((rule) => rule.active)
  const supplierNip = normalizeSupplierNip(invoice.supplierNip)
  const supplierName = invoice.supplierName.trim().toLowerCase()

  const nipMatches = supplierNip
    ? activeRules.filter((rule) => normalizeSupplierNip(rule.supplierNip) === supplierNip)
    : []
  if (nipMatches.length > 0) return bestRuleDecision(nipMatches)

  const nameMatches = activeRules.filter((rule) => {
    const pattern = rule.supplierNamePattern?.trim().toLowerCase()
    return pattern ? supplierName.includes(pattern) : false
  })
  const exactNameMatches = nameMatches.filter((rule) => rule.supplierNamePattern?.trim().toLowerCase() === supplierName)
  if (exactNameMatches.length > 0) return bestRuleDecision(exactNameMatches)

  return bestRuleDecision(nameMatches)
}

function bestRuleDecision(matches: SupplierRuleDecisionRule[]): SupplierRuleDecision {
  if (matches.length === 0) return { status: 'NO_MATCH' }

  const bestPriority = Math.min(...matches.map((rule) => rule.priority))
  const best = matches.filter((rule) => rule.priority === bestPriority)
  if (best.length === 1) return { status: 'MATCHED', ruleId: best[0].id }

  return { status: 'CONFLICT', conflictingRuleIds: best.map((rule) => rule.id).sort() }
}

export function suggestCorrectionPartsFromOriginal(
  correctionGrossAmount: number,
  originalParts: Array<{ label: string; grossAmount: number }>
) {
  const originalTotal = originalParts.reduce((sum, part) => sum + part.grossAmount, 0)
  if (originalTotal === 0) return []

  let allocated = 0
  return originalParts.map((part, index) => {
    const isLast = index === originalParts.length - 1
    const amount = isLast
      ? roundMoney(correctionGrossAmount - allocated)
      : roundMoney(correctionGrossAmount * (part.grossAmount / originalTotal))
    allocated = roundMoney(allocated + amount)
    return { label: part.label, grossAmount: amount }
  })
}

export function calculateHistoricalContributionMargin(
  months: Array<{ revenue: number; cogs: number; variableCosts: number }>
) {
  const revenue = months.reduce((sum, month) => sum + month.revenue, 0)
  if (revenue <= 0) return null

  const contribution = months.reduce(
    (sum, month) => sum + month.revenue - month.cogs - month.variableCosts,
    0
  )
  return roundMoney(contribution / revenue)
}
