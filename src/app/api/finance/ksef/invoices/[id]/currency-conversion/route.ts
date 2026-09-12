import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/finance/ksef-inbox'
import { KsefInvoiceCurrencyConversionSchema } from '@/lib/validations/ksef-inbox'
import { withAiQueueMutation } from '@/lib/ai/queue'
import {
  assertLegacyInvoiceWriteAllowed,
  invoiceImportReviewRequiredResponse,
} from '@/lib/invoice-import/legacy-write-guard'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoiceCurrencyConversionSchema.safeParse(await req.json())
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
        return { kind: 'error' as const, status: 409, error: 'Zatwierdzonej faktury nie można przeliczać ponownie.' }
      }
      if (existing.currency === 'PLN') {
        return { kind: 'error' as const, status: 400, error: 'Faktura PLN nie wymaga przeliczenia waluty.' }
      }

      const invoice = await tx.ksefInvoice.update({
        where: { id },
        data: {
          originalCurrency: existing.originalCurrency ?? existing.currency,
          originalGrossAmount: existing.originalGrossAmount ?? existing.grossAmount,
          originalNetAmount: existing.originalNetAmount ?? existing.netAmount,
          originalVatAmount: existing.originalVatAmount ?? existing.vatAmount,
          reportingGrossAmount: roundMoney(data.reportingGrossAmount),
          reportingNetAmount: data.reportingNetAmount == null ? null : roundMoney(data.reportingNetAmount),
          reportingVatAmount: data.reportingVatAmount == null ? null : roundMoney(data.reportingVatAmount),
          currencyConversionNote: data.currencyConversionNote,
          convertedById: auth.session.user.id,
          convertedAt: new Date(),
          auditLogs: {
            create: {
              action: 'currency.convert',
              actorId: auth.session.user.id,
              beforeJson: JSON.stringify({
                currency: existing.currency,
                grossAmount: existing.grossAmount,
                netAmount: existing.netAmount,
                vatAmount: existing.vatAmount,
              }),
              afterJson: JSON.stringify(data),
            },
          },
        },
        include: {
          costCenter: true,
          subCategory: { include: { category: true } },
          supplierRule: true,
        },
      })
      return { kind: 'success' as const, invoice }
    })

    if (outcome.kind === 'error') {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }
    return NextResponse.json({ invoice: outcome.invoice })
  } catch (error) {
    const conflict = invoiceImportReviewRequiredResponse(error)
    if (conflict) return conflict
    throw error
  }
}
