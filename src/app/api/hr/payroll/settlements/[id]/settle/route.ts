import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { settleEmployeeMonth } from '@/lib/payroll/service'
import { PayrollSettlementSettleSchema } from '@/lib/validations/payroll'
import { getSettlementPageData } from '../detail-response'

/**
 * "Zapisz i zatwierdź" (draft) and "Zapisz korektę" (approved) of the detail page. Runs the very same
 * server path as a row of the month sheet (settleEmployeeMonth): one transaction, the same audit trail.
 * A correction of an approved settlement needs a reason.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const { id } = await params
  const parsed = PayrollSettlementSettleSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400, headers: PAYROLL_NO_STORE })
  }
  try {
    const settlement = await prisma.payrollSettlement.findUnique({
      where: { id },
      select: { employeeId: true, year: true, month: true, status: true },
    })
    if (!settlement) return NextResponse.json({ error: 'Rozliczenie nie istnieje.' }, { status: 404, headers: PAYROLL_NO_STORE })
    const { reason, note, ...figures } = parsed.data
    if (settlement.status === 'APPROVED' && (reason ?? '').length < 3) {
      return NextResponse.json(
        { error: 'Podaj powód korekty (min. 3 znaki).', details: { fieldErrors: { reason: ['Podaj powód korekty (min. 3 znaki).'] } } },
        { status: 400, headers: PAYROLL_NO_STORE }
      )
    }
    const result = await settleEmployeeMonth(prisma, auth.session.user.id, {
      employeeId: settlement.employeeId,
      period: { year: settlement.year, month: settlement.month },
      finalGross: figures.finalGross,
      finalNet: figures.finalNet,
      employerCost: figures.employerCost,
      expectedRevision: figures.expectedRevision,
      approvalNote: note,
      correctionReason: reason,
    })
    return NextResponse.json(
      { outcome: result.outcome, versionNumber: result.versionNumber, detail: await getSettlementPageData(prisma, id) },
      { headers: PAYROLL_NO_STORE }
    )
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
