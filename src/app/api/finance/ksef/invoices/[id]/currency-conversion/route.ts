import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/finance/ksef-inbox'
import { KsefInvoiceCurrencyConversionSchema } from '@/lib/validations/ksef-inbox'

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
  const existing = await prisma.ksefInvoice.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  if (existing.status === 'APPROVED') {
    return NextResponse.json({ error: 'Zatwierdzonej faktury nie można przeliczać ponownie.' }, { status: 409 })
  }
  if (existing.currency === 'PLN') {
    return NextResponse.json({ error: 'Faktura PLN nie wymaga przeliczenia waluty.' }, { status: 400 })
  }

  const data = parsed.data
  const invoice = await prisma.ksefInvoice.update({
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

  return NextResponse.json({ invoice })
}
