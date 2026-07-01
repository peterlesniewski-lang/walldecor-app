import type { Prisma, PrismaClient } from '@/generated/prisma'
import {
  roundMoney,
  resolveSupplierRuleMatch,
  supplierMatchesRule,
  type SupplierRuleInput,
} from '@/lib/finance/ksef-inbox'

type DbClient = PrismaClient | Prisma.TransactionClient

interface RuleApplicationInvoice {
  id: string
  invoiceNumber?: string
  grossAmount?: number
  reportingGrossAmount?: number | null
  supplierName: string
  supplierNip: string | null
  currency?: string | null
  documentStatus?: string | null
}

function canAutoApplySupplierRule(invoice: RuleApplicationInvoice) {
  const documentStatus = invoice.documentStatus ?? 'ACTIVE'
  const currency = invoice.currency ?? 'PLN'
  return documentStatus === 'ACTIVE' && (currency === 'PLN' || invoice.reportingGrossAmount != null)
}

async function replaceInvoicePartFromRule(
  db: DbClient,
  invoice: RuleApplicationInvoice,
  rule: SupplierRuleInput
) {
  const tagIds = rule.tags?.map((tag) => tag.tagId).filter(Boolean) ?? []
  if (tagIds.length === 0 || !invoice.invoiceNumber || invoice.grossAmount == null) return

  const existingParts = await db.ksefInvoicePart.findMany({
    where: { invoiceId: invoice.id },
    select: { id: true },
  })
  const partIds = existingParts.map((part) => part.id)

  if (partIds.length > 0) {
    await db.ksefInvoicePartTag.deleteMany({ where: { partId: { in: partIds } } })
    await db.ksefInvoicePartAllocation.deleteMany({ where: { partId: { in: partIds } } })
    await db.ksefInvoicePart.deleteMany({ where: { id: { in: partIds } } })
  }

  const part = await db.ksefInvoicePart.create({
    data: {
      invoiceId: invoice.id,
      label: invoice.invoiceNumber,
      grossAmount: roundMoney(invoice.reportingGrossAmount ?? invoice.grossAmount),
      order: 0,
    },
  })

  await db.ksefInvoicePartTag.createMany({
    data: tagIds.map((tagId) => ({ partId: part.id, tagId })),
  })
  await db.ksefInvoicePartAllocation.create({
    data: {
      partId: part.id,
      costCenterId: rule.costCenterId,
      percent: 100,
    },
  })
}

export async function applySupplierRuleToNewInvoices(db: DbClient, rule: SupplierRuleInput) {
  if (!rule.active) return 0

  const candidates = await db.ksefInvoice.findMany({
    where: { status: 'NEW' },
    select: {
      id: true,
      invoiceNumber: true,
      grossAmount: true,
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

  const tagIds = rule.tags?.map((tag) => tag.tagId).filter(Boolean) ?? []
  if (tagIds.length > 0) {
    let applied = 0
    for (const invoice of candidates.filter((candidate) => ids.includes(candidate.id))) {
      await db.ksefInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'MAPPED',
          costCenterId: rule.costCenterId,
          subCategoryId: rule.subCategoryId,
          supplierRuleId: rule.id,
          ruleMatchStatus: 'MATCHED',
        },
      })
      await replaceInvoicePartFromRule(db, invoice, rule)
      applied += 1
    }
    return applied
  }

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
      invoiceNumber: true,
      grossAmount: true,
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
      await replaceInvoicePartFromRule(db, invoice, decision.rule)
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
