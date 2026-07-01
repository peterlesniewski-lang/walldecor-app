import type { Prisma, PrismaClient } from '@/generated/prisma'
import {
  resolveSupplierRuleMatch,
  supplierMatchesRule,
  type SupplierRuleInput,
} from '@/lib/finance/ksef-inbox'

type DbClient = PrismaClient | Prisma.TransactionClient

interface RuleApplicationInvoice {
  id: string
  supplierName: string
  supplierNip: string | null
  currency?: string | null
  reportingGrossAmount?: number | null
  documentStatus?: string | null
}

function canAutoApplySupplierRule(invoice: RuleApplicationInvoice) {
  const documentStatus = invoice.documentStatus ?? 'ACTIVE'
  const currency = invoice.currency ?? 'PLN'
  return documentStatus === 'ACTIVE' && (currency === 'PLN' || invoice.reportingGrossAmount != null)
}

export async function applySupplierRuleToNewInvoices(db: DbClient, rule: SupplierRuleInput) {
  if (!rule.active) return 0

  const candidates = await db.ksefInvoice.findMany({
    where: { status: 'NEW' },
    select: {
      id: true,
      supplierName: true,
      supplierNip: true,
      currency: true,
      reportingGrossAmount: true,
      documentStatus: true,
    },
  })
  const ids = candidates
    .filter((invoice: RuleApplicationInvoice) => canAutoApplySupplierRule(invoice))
    .filter((invoice: RuleApplicationInvoice) => supplierMatchesRule(invoice, rule))
    .map((invoice: RuleApplicationInvoice) => invoice.id)

  if (ids.length === 0) return 0

  const result = await db.ksefInvoice.updateMany({
    where: { id: { in: ids }, status: 'NEW' },
    data: {
      status: 'MAPPED',
      costCenterId: rule.costCenterId,
      subCategoryId: rule.subCategoryId,
      supplierRuleId: rule.id,
      ruleMatchStatus: 'MATCHED',
    },
  })

  return result.count
}

export async function applySupplierRulesToNewInvoices(db: DbClient, rules: SupplierRuleInput[]) {
  const activeRules = rules.filter((rule) => rule.active)
  if (activeRules.length === 0) return 0

  const candidates = await db.ksefInvoice.findMany({
    where: { status: 'NEW' },
    select: {
      id: true,
      supplierName: true,
      supplierNip: true,
      currency: true,
      reportingGrossAmount: true,
      documentStatus: true,
    },
  })
  let applied = 0

  for (const invoice of candidates) {
    if (!canAutoApplySupplierRule(invoice)) continue

    const decision = resolveSupplierRuleMatch(invoice, activeRules)

    if (decision.status === 'MATCHED') {
      await db.ksefInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'MAPPED',
          costCenterId: decision.rule.costCenterId,
          subCategoryId: decision.rule.subCategoryId,
          supplierRuleId: decision.rule.id,
          ruleMatchStatus: 'MATCHED',
        },
      })
      applied += 1
      continue
    }

    if (decision.status === 'CONFLICT') {
      await db.ksefInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'NEW',
          costCenterId: null,
          subCategoryId: null,
          supplierRuleId: null,
          ruleMatchStatus: 'CONFLICT',
        },
      })
      continue
    }

    await db.ksefInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'NEW',
        supplierRuleId: null,
        ruleMatchStatus: 'NO_RULE',
      },
    })
  }

  return applied
}
