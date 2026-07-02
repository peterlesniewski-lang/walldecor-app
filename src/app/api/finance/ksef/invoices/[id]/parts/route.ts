import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { validateCostParts } from '@/lib/finance/cost-control'
import { roundMoney } from '@/lib/finance/ksef-inbox'
import { KsefInvoicePartsUpdateSchema } from '@/lib/validations/cost-control'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoicePartsUpdateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params
  const invoice = await prisma.ksefInvoice.findUnique({ where: { id } })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status === 'APPROVED') {
    return NextResponse.json({ error: 'Zatwierdzonej faktury nie można dzielić na części.' }, { status: 409 })
  }

  const invoiceAmount = roundMoney(invoice.reportingGrossAmount ?? invoice.grossAmount)
  const validation = validateCostParts(invoiceAmount, parsed.data.parts)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingParts = await tx.ksefInvoicePart.findMany({
      where: { invoiceId: id },
      select: { id: true },
    })
    const partIds = existingParts.map((part) => part.id)

    if (partIds.length > 0) {
      await tx.ksefInvoicePartTag.deleteMany({ where: { partId: { in: partIds } } })
      await tx.ksefInvoicePartAllocation.deleteMany({ where: { partId: { in: partIds } } })
      await tx.ksefInvoicePart.deleteMany({ where: { id: { in: partIds } } })
    }

    for (const [index, part] of parsed.data.parts.entries()) {
      const createdPart = await tx.ksefInvoicePart.create({
        data: {
          invoiceId: id,
          label: part.label,
          grossAmount: roundMoney(part.grossAmount),
          order: index,
        },
      })

      if (part.tagIds.length > 0) {
        await tx.ksefInvoicePartTag.createMany({
          data: part.tagIds.map((tagId) => ({ partId: createdPart.id, tagId })),
        })
      }

      await tx.ksefInvoicePartAllocation.createMany({
        data: part.allocations.map((allocation) => ({
          partId: createdPart.id,
          costCenterId: allocation.costCenterId,
          percent: allocation.percent,
        })),
      })
    }

    await tx.costAuditLog.create({
      data: {
        invoiceId: id,
        action: 'invoice.parts.update',
        actorId: auth.session.user.id,
        afterJson: JSON.stringify(parsed.data),
      },
    })

    return tx.ksefInvoice.findUnique({
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
  })

  return NextResponse.json({ invoice: result })
}
