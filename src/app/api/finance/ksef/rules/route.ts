import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { KsefSupplierRuleCreateSchema } from '@/lib/validations/ksef-inbox'
import { applySupplierRuleToNewInvoices } from '@/lib/finance/ksef-rule-application'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'

export async function GET() {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const rules = await prisma.ksefSupplierRule.findMany({
    include: {
      costCenter: true,
      subCategory: { include: { category: true } },
      tags: { include: { tag: true } },
    },
    orderBy: [{ active: 'desc' }, { priority: 'asc' }, { updatedAt: 'desc' }],
  })

  return NextResponse.json(rules)
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefSupplierRuleCreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  const data = parsed.data
  const result = await prisma.$transaction(async (tx) => {
    const rule = await tx.ksefSupplierRule.create({
      data: {
        supplierNamePattern: data.supplierNamePattern || null,
        supplierNip: data.supplierNip || null,
        costCenterId: data.costCenterId,
        subCategoryId: data.subCategoryId ?? null,
        priority: data.priority ?? 100,
        active: data.active ?? true,
        tags: data.tagIds && data.tagIds.length > 0
          ? { create: data.tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        tags: { include: { tag: true } },
      },
    })
    const appliedCount = await applySupplierRuleToNewInvoices(tx, rule)

    return { rule, appliedCount }
  })

  return NextResponse.json(result, { status: 201 })
}
