import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { KsefInvoiceUpdateSchema } from '@/lib/validations/ksef-inbox'
import { applySupplierRuleToNewInvoices } from '@/lib/finance/ksef-rule-application'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoiceUpdateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params
  const existing = await prisma.ksefInvoice.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (existing.status === 'APPROVED') {
    return NextResponse.json({ error: 'Zatwierdzonej faktury nie można edytować.' }, { status: 409 })
  }

  const data = parsed.data
  const hasClassification = Boolean(data.costCenterId && data.subCategoryId)
  const status = data.status ?? (hasClassification ? 'MAPPED' : existing.status)

  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.ksefInvoice.update({
      where: { id },
      data: {
        status,
        costCenterId: data.costCenterId,
        subCategoryId: data.subCategoryId,
        notes: data.notes,
      },
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        supplierRule: true,
      },
    })

    if (!hasClassification || !invoice.supplierNip || !data.costCenterId || !data.subCategoryId) {
      return { invoice, appliedCount: 0 }
    }

    const existingRule = await tx.ksefSupplierRule.findFirst({
      where: { supplierNip: invoice.supplierNip, active: true },
    })
    const rule = existingRule
      ? await tx.ksefSupplierRule.update({
          where: { id: existingRule.id },
          data: {
            costCenterId: data.costCenterId,
            subCategoryId: data.subCategoryId,
          },
        })
      : await tx.ksefSupplierRule.create({
          data: {
            supplierNip: invoice.supplierNip,
            supplierNamePattern: invoice.supplierName,
            costCenterId: data.costCenterId,
            subCategoryId: data.subCategoryId,
            active: true,
          },
        })

    const appliedCount = await applySupplierRuleToNewInvoices(tx, rule)
    return { invoice, appliedCount }
  })

  return NextResponse.json(result)
}
