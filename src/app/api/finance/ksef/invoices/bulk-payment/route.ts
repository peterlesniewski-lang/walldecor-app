import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime } from 'date-fns-tz'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { KsefBulkPaymentSchema } from '@/lib/validations/ksef-inbox'
import type { BulkPaymentResult } from '@/lib/finance/ksef-selection'

export async function POST(req: NextRequest) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefBulkPaymentSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Wybierz od 1 do 200 faktur i poprawną datę płatności.' }, { status: 400 })
  }

  // Date-only input is interpreted in the business timezone, not the server timezone.
  const paidAt = fromZonedTime(`${parsed.data.paidDate}T12:00:00`, 'Europe/Warsaw')
  const results: BulkPaymentResult[] = []
  for (const id of new Set(parsed.data.invoiceIds)) {
    try {
      const result = await prisma.$transaction(async (tx): Promise<BulkPaymentResult> => {
        const invoice = await tx.ksefInvoice.findUnique({ where: { id } })
        if (!invoice) return { id, outcome: 'failed', error: 'Faktura nie istnieje.' }
        if (invoice.paymentStatus === 'PAID') return { id, outcome: 'already_paid' }
        if (invoice.documentStatus === 'CANCELLED') {
          return { id, outcome: 'failed', error: 'Faktura jest anulowana.' }
        }
        const updated = await tx.ksefInvoice.updateMany({
          where: { id, paymentStatus: { not: 'PAID' }, updatedAt: invoice.updatedAt },
          data: { paymentStatus: 'PAID', paidAt },
        })
        if (updated.count !== 1) {
          return { id, outcome: 'failed', error: 'Faktura zmieniła się w trakcie operacji. Odśwież listę.' }
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
        return { id, outcome: 'paid' }
      })
      results.push(result)
    } catch {
      // A failed invoice rolls back together with its audit entry. Others can succeed.
      results.push({ id, outcome: 'failed', error: 'Nie udało się zapisać płatności. Spróbuj ponownie.' })
    }
  }
  return NextResponse.json({ results, paidAt: paidAt.toISOString() })
}
