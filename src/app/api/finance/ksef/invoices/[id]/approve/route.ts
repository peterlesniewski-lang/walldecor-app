import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildCostEventDraftFromKsefInvoice } from '@/lib/finance/cost-events'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  const invoice = await prisma.ksefInvoice.findUnique({
    where: { id },
    include: {
      parts: {
        include: {
          tags: true,
          allocations: true,
        },
        orderBy: { order: 'asc' },
      },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (invoice.status === 'APPROVED') {
    return NextResponse.json({ error: 'Faktura jest już zatwierdzona.' }, { status: 409 })
  }
  if (invoice.documentStatus === 'CANCELLED') {
    return NextResponse.json({ error: 'Anulowanej faktury nie można zatwierdzić.' }, { status: 409 })
  }
  if (invoice.ruleMatchStatus === 'CONFLICT') {
    return NextResponse.json({ error: 'Najpierw rozwiąż konflikt reguł dostawcy.' }, { status: 409 })
  }

  let draft: ReturnType<typeof buildCostEventDraftFromKsefInvoice>
  try {
    draft = buildCostEventDraftFromKsefInvoice(invoice)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Nie udało się przygotować kosztu.' },
      { status: 400 }
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    const costEvent = await tx.costEvent.create({
      data: {
        source: draft.source,
        sourceInvoiceId: draft.sourceInvoiceId,
        eventDate: draft.eventDate,
        supplierName: draft.supplierName,
        supplierNip: draft.supplierNip,
        reference: draft.reference,
        grossAmount: draft.grossAmount,
        netAmount: draft.netAmount,
        vatAmount: draft.vatAmount,
        currency: draft.currency,
        documentStatus: invoice.documentStatus,
        createdById: auth.session.user.id,
        parts: {
          create: draft.parts.map((part, index) => ({
            label: part.label,
            grossAmount: part.grossAmount,
            order: index,
            tags: {
              create: part.tagIds.map((tagId) => ({ tagId })),
            },
            allocations: {
              create: part.allocations.map((allocation) => ({
                costCenterId: allocation.costCenterId,
                percent: allocation.percent,
                fallbackUsed: allocation.fallbackUsed,
              })),
            },
          })),
        },
      },
      include: {
        parts: {
          include: {
            tags: true,
            allocations: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    })

    const updatedInvoice = await tx.ksefInvoice.update({
      where: { id },
      data: {
        status: 'APPROVED',
        auditLogs: {
          create: {
            action: 'invoice.approve',
            actorId: auth.session.user.id,
            afterJson: JSON.stringify({
              costEventId: costEvent.id,
              originalCurrency: draft.originalCurrency,
              originalGrossAmount: draft.originalGrossAmount,
              currencyConversionNote: draft.currencyConversionNote,
            }),
          },
        },
      },
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        supplierRule: true,
      },
    })

    return { invoice: updatedInvoice, costEvent }
  })

  return NextResponse.json(result)
}
