import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { KsefBulkPaymentSchema } from '@/lib/validations/ksef-inbox'
import type { BulkPaymentResult } from '@/lib/finance/ksef-selection'
import { withAiQueueMutation } from '@/lib/ai/queue'
import {
  assertLegacyInvoiceBatchWriteAllowed,
  invoiceImportReviewRequiredResponse,
} from '@/lib/invoice-import/legacy-write-guard'

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefBulkPaymentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Wybierz od 1 do 200 faktur i poprawną datę płatności.' }, { status: 400 })
  }

  // Date-only input is interpreted in the business timezone, not the server timezone.
  const paidAt = fromZonedTime(`${parsed.data.paidDate}T12:00:00`, 'Europe/Warsaw')
  const invoiceIds = [...new Set(parsed.data.invoiceIds)]
  try {
    const results = await withAiQueueMutation(prisma, () => new Date(), async (tx) => {
      // Hold the writer reservation across the complete preflight and batch so
      // an imported row cannot appear after an earlier legacy row was changed.
      await assertLegacyInvoiceBatchWriteAllowed(tx, invoiceIds)
      const batchResults: BulkPaymentResult[] = []

      for (const [index, id] of invoiceIds.entries()) {
        const invoice = await tx.ksefInvoice.findUnique({ where: { id } })
        if (!invoice) {
          batchResults.push({ id, outcome: 'failed', error: 'Faktura nie istnieje.' })
          continue
        }
        if (invoice.paymentStatus === 'PAID') {
          batchResults.push({ id, outcome: 'already_paid' })
          continue
        }
        if (invoice.documentStatus === 'CANCELLED') {
          batchResults.push({ id, outcome: 'failed', error: 'Faktura jest anulowana.' })
          continue
        }

        // Keep per-invoice partial success while the imported preflight remains
        // atomic for the complete batch.
        const savepoint = `bulk_payment_${index}`
        await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`)
        try {
          const updated = await tx.ksefInvoice.updateMany({
            where: {
              id,
              paymentStatus: { not: 'PAID' },
              updatedAt: invoice.updatedAt,
              invoiceImportDraft: { is: null },
            },
            data: { paymentStatus: 'PAID', paidAt },
          })
          if (updated.count !== 1) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`)
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`)
            batchResults.push({
              id,
              outcome: 'failed',
              error: 'Faktura zmieniła się w trakcie operacji. Odśwież listę.',
            })
            continue
          }
          await tx.costAuditLog.create({
            data: {
              invoiceId: id,
              action: 'payment.bulk-paid',
              actorId: auth.session.user.id,
              beforeJson: JSON.stringify({ paymentStatus: invoice.paymentStatus, paidAt: invoice.paidAt }),
              afterJson: JSON.stringify({ paymentStatus: 'PAID', paidAt: paidAt.toISOString() }),
            },
          })
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`)
          batchResults.push({ id, outcome: 'paid' })
        } catch {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`)
          batchResults.push({
            id,
            outcome: 'failed',
            error: 'Nie udało się zapisać płatności. Spróbuj ponownie.',
          })
        }
      }
      return batchResults
    })
    return NextResponse.json({ results, paidAt: paidAt.toISOString() })
  } catch (error) {
    const conflict = invoiceImportReviewRequiredResponse(error)
    if (conflict) return conflict
    throw error
  }
}
