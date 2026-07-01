import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildActualEntryFromKsefInvoice } from '@/lib/finance/ksef-inbox'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  const invoice = await prisma.ksefInvoice.findUnique({ where: { id } })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status === 'APPROVED') {
    return NextResponse.json({ error: 'Faktura jest już zatwierdzona.' }, { status: 409 })
  }
  if (!invoice.costCenterId || !invoice.subCategoryId) {
    return NextResponse.json({ error: 'Najpierw przypisz centrum kosztów i podkategorię.' }, { status: 400 })
  }

  const actualPayload = buildActualEntryFromKsefInvoice({
    issueDate: invoice.issueDate,
    grossAmount: invoice.grossAmount,
    costCenterId: invoice.costCenterId,
    subCategoryId: invoice.subCategoryId,
  })

  const result = await prisma.$transaction(async (tx) => {
    const existingActual = await tx.actualEntry.findUnique({
      where: {
        year_month_costCenterId_subCategoryId: {
          year: actualPayload.year,
          month: actualPayload.month,
          costCenterId: actualPayload.costCenterId,
          subCategoryId: actualPayload.subCategoryId,
        },
      },
    })

    const actual = existingActual
      ? await tx.actualEntry.update({
          where: { id: existingActual.id },
          data: { amount: Math.round((existingActual.amount + actualPayload.amount) * 100) / 100 },
        })
      : await tx.actualEntry.create({ data: actualPayload })

    const updatedInvoice = await tx.ksefInvoice.update({
      where: { id },
      data: {
        status: 'APPROVED',
        actualEntryId: actual.id,
      },
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        supplierRule: true,
      },
    })

    return { invoice: updatedInvoice, actual }
  })

  return NextResponse.json(result)
}
