import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { prisma } from '@/lib/prisma'
import { KsefInvoicePaymentSchema } from '@/lib/validations/ksef-inbox'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFinanceAdmin()
  if (auth.error) return auth.error

  const parsed = KsefInvoicePaymentSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params
  const data = parsed.data
  const invoice = await prisma.ksefInvoice.update({
    where: { id },
    data: {
      paymentStatus: data.paymentStatus,
      paidAt: data.paymentStatus === 'PAID' ? (data.paidAt ? new Date(data.paidAt) : new Date()) : null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      auditLogs: {
        create: {
          action: 'payment.update',
          actorId: auth.session.user.id,
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
