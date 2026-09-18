import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildCostEventDraftFromKsefInvoice } from '@/lib/finance/cost-events'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { withAiQueueMutation } from '@/lib/ai/queue'
import { findExistingInvoiceDuplicate, invoiceDuplicateBody } from '@/lib/invoice-import/duplicate-lookup'
import {
  assertLegacyInvoiceWriteAllowed,
  invoiceImportReviewRequiredResponse,
} from '@/lib/invoice-import/legacy-write-guard'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  try {
    const outcome = await withAiQueueMutation(prisma, () => new Date(), async (tx) => {
      await assertLegacyInvoiceWriteAllowed(tx, id)
      const invoice = await tx.ksefInvoice.findUnique({
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
      if (!invoice) return { kind: 'error' as const, status: 404, error: 'Invoice not found' }
      if (invoice.status === 'APPROVED') {
        return { kind: 'error' as const, status: 409, error: 'Faktura jest już zatwierdzona.' }
      }
      if (invoice.documentStatus === 'CANCELLED') {
        return { kind: 'error' as const, status: 409, error: 'Anulowanej faktury nie można zatwierdzić.' }
      }
      if (invoice.ruleMatchStatus === 'CONFLICT') {
        return { kind: 'error' as const, status: 409, error: 'Najpierw rozwiąż konflikt reguł dostawcy.' }
      }

      const duplicate = await findExistingInvoiceDuplicate(tx, {
        supplierName: invoice.supplierName, taxId: invoice.supplierNip,
        invoiceNumber: invoice.invoiceNumber, issueDate: invoice.issueDate.toISOString().slice(0, 10),
      }, invoice.id)
      if (duplicate) return { kind: 'duplicate' as const, duplicate }

      let draft: ReturnType<typeof buildCostEventDraftFromKsefInvoice>
      try {
        draft = buildCostEventDraftFromKsefInvoice(invoice)
      } catch (error) {
        return {
          kind: 'error' as const,
          status: 400,
          error: error instanceof Error ? error.message : 'Nie udało się przygotować kosztu.',
        }
      }

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

      return { kind: 'success' as const, result: { invoice: updatedInvoice, costEvent } }
    })

    if (outcome.kind === 'duplicate') {
      return NextResponse.json(invoiceDuplicateBody(outcome.duplicate), { status: 409 })
    }
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  try {
    const outcome = await withAiQueueMutation(prisma, () => new Date(), async (tx) => {
      await assertLegacyInvoiceWriteAllowed(tx, id)
      const invoice = await tx.ksefInvoice.findUnique({
        where: { id },
        include: {
          costEvent: {
            select: { id: true, status: true },
          },
        },
      })

      if (!invoice) return { kind: 'error' as const, status: 404, error: 'Invoice not found' }
      if (invoice.status !== 'APPROVED') {
        return { kind: 'error' as const, status: 409, error: 'Tylko zatwierdzoną fakturę można cofnąć z kosztów.' }
      }

      const voidedCostEvents = await tx.costEvent.updateMany({
        where: { sourceInvoiceId: id, status: 'APPROVED' },
        data: { status: 'VOID', sourceInvoiceId: null },
      })

      const updatedInvoice = await tx.ksefInvoice.update({
        where: { id },
        data: {
          status: 'MAPPED',
          auditLogs: {
            create: {
              action: 'invoice.unapprove',
              actorId: auth.session.user.id,
              beforeJson: JSON.stringify({ status: 'APPROVED', costEventId: invoice.costEvent?.id ?? null }),
              afterJson: JSON.stringify({ status: 'MAPPED', costEventStatus: 'VOID' }),
            },
          },
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

      return {
        kind: 'success' as const,
        result: { invoice: updatedInvoice, voidedCostEvents: voidedCostEvents.count },
      }
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
