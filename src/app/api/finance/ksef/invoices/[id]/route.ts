import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { KsefInvoiceUpdateSchema } from '@/lib/validations/ksef-inbox'
import { applySupplierRuleToNewInvoices } from '@/lib/finance/ksef-rule-application'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { roundMoney } from '@/lib/finance/ksef-inbox'
import { withAiQueueMutation } from '@/lib/ai/queue'
import {
  assertLegacyInvoiceWriteAllowed,
  invoiceImportReviewRequiredResponse,
} from '@/lib/invoice-import/legacy-write-guard'
import type { Prisma } from '@/generated/prisma'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) {
    auth.error.headers.set('Cache-Control', 'private, no-store')
    return auth.error
  }

  const { id } = await params
  const invoice = await prisma.ksefInvoice.findUnique({
    where: { id },
    select: {
      id: true, supplierName: true, supplierNip: true, invoiceNumber: true,
      issueDate: true, grossAmount: true, currency: true, status: true,
    },
  })
  const headers = { 'Cache-Control': 'private, no-store' }
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404, headers })
  return NextResponse.json({ invoice }, { headers })
}

async function replaceWholeInvoicePart(
  tx: Prisma.TransactionClient,
  {
    invoiceId,
    invoiceNumber,
    grossAmount,
    costCenterId,
    tagIds,
  }: {
    invoiceId: string
    invoiceNumber: string
    grossAmount: number
    costCenterId: string
    tagIds: string[]
  }
) {
  const existingParts = await tx.ksefInvoicePart.findMany({
    where: { invoiceId },
    select: { id: true },
  })
  const partIds = existingParts.map((part) => part.id)

  if (partIds.length > 0) {
    await tx.ksefInvoicePartTag.deleteMany({ where: { partId: { in: partIds } } })
    await tx.ksefInvoicePartAllocation.deleteMany({ where: { partId: { in: partIds } } })
    await tx.ksefInvoicePart.deleteMany({ where: { id: { in: partIds } } })
  }

  const part = await tx.ksefInvoicePart.create({
    data: {
      invoiceId,
      label: invoiceNumber,
      grossAmount: roundMoney(grossAmount),
      order: 0,
    },
  })

  if (tagIds.length > 0) {
    await tx.ksefInvoicePartTag.createMany({
      data: tagIds.map((tagId) => ({ partId: part.id, tagId })),
    })
  }

  await tx.ksefInvoicePartAllocation.create({
    data: {
      partId: part.id,
      costCenterId,
      percent: 100,
    },
  })
}

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
  const data = parsed.data
  try {
    const outcome = await withAiQueueMutation(prisma, () => new Date(), async (tx) => {
      await assertLegacyInvoiceWriteAllowed(tx, id)
      const existing = await tx.ksefInvoice.findUnique({ where: { id } })
      if (!existing) return { kind: 'error' as const, status: 404, error: 'Invoice not found' }
      if (existing.status === 'APPROVED') {
        return { kind: 'error' as const, status: 409, error: 'Zatwierdzonej faktury nie można edytować.' }
      }

      const hasTagClassification = Boolean(data.costCenterId && data.tagIds && data.tagIds.length > 0)
      const hasClassification = Boolean(data.costCenterId && data.subCategoryId) || hasTagClassification
      const status = data.status ?? (hasClassification ? 'MAPPED' : existing.status)
      const invoice = await tx.ksefInvoice.update({
        where: { id },
        data: {
          status,
          costCenterId: data.costCenterId,
          subCategoryId: data.subCategoryId ?? (hasTagClassification ? null : existing.subCategoryId),
          notes: data.notes,
        },
        include: {
          costCenter: true,
          subCategory: { include: { category: true } },
          supplierRule: true,
          parts: {
            include: {
              tags: { include: { tag: true } },
              allocations: true,
            },
            orderBy: { order: 'asc' },
          },
        },
      })

      if (hasTagClassification && data.costCenterId && data.tagIds) {
        await replaceWholeInvoicePart(tx, {
          invoiceId: id,
          invoiceNumber: invoice.invoiceNumber,
          grossAmount: invoice.reportingGrossAmount ?? invoice.grossAmount,
          costCenterId: data.costCenterId,
          tagIds: data.tagIds,
        })
      }

      if (!hasClassification || !invoice.supplierNip || !data.costCenterId) {
        const updatedInvoice = hasTagClassification
          ? await tx.ksefInvoice.findUnique({
              where: { id },
              include: {
                costCenter: true,
                subCategory: { include: { category: true } },
                supplierRule: true,
                parts: {
                  include: {
                    tags: { include: { tag: true } },
                    allocations: true,
                  },
                  orderBy: { order: 'asc' },
                },
              },
            })
          : invoice
        return { kind: 'success' as const, result: { invoice: updatedInvoice, appliedCount: 0 } }
      }

      if (data.tagIds && data.tagIds.length > 0) {
        const existingRule = await tx.ksefSupplierRule.findFirst({
          where: { supplierNip: invoice.supplierNip, active: true },
          include: { tags: true },
        })
        const rule = existingRule
          ? await tx.ksefSupplierRule.update({
              where: { id: existingRule.id },
              data: {
                costCenterId: data.costCenterId,
                subCategoryId: data.subCategoryId ?? null,
                tags: {
                  deleteMany: {},
                  create: data.tagIds.map((tagId) => ({ tagId })),
                },
              },
              include: { tags: true },
            })
          : await tx.ksefSupplierRule.create({
              data: {
                supplierNip: invoice.supplierNip,
                supplierNamePattern: invoice.supplierName,
                costCenterId: data.costCenterId,
                subCategoryId: data.subCategoryId ?? null,
                active: true,
                tags: { create: data.tagIds.map((tagId) => ({ tagId })) },
              },
              include: { tags: true },
            })
        const appliedCount = await applySupplierRuleToNewInvoices(tx, rule)
        const updatedInvoice = await tx.ksefInvoice.findUnique({
          where: { id },
          include: {
            costCenter: true,
            subCategory: { include: { category: true } },
            supplierRule: true,
            parts: {
              include: {
                tags: { include: { tag: true } },
                allocations: true,
              },
              orderBy: { order: 'asc' },
            },
          },
        })
        return { kind: 'success' as const, result: { invoice: updatedInvoice, appliedCount } }
      }

      if (!data.subCategoryId) {
        return { kind: 'success' as const, result: { invoice, appliedCount: 0 } }
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
      return { kind: 'success' as const, result: { invoice, appliedCount } }
    })

    if (outcome.kind === 'error') {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }
    return NextResponse.json(outcome.result)
  } catch (error) {
    const conflict = invoiceImportReviewRequiredResponse(error)
    if (conflict) return conflict
    throw error
  }
}
