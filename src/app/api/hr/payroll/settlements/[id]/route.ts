import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { applySettlementAction, getSettlementDetail } from '@/lib/payroll/service'
import { PayrollSettlementActionSchema } from '@/lib/validations/payroll'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    return NextResponse.json(await getSettlementDetail(prisma, id), { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const { id } = await params
  const parsed = PayrollSettlementActionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const detail = await applySettlementAction(prisma, auth.session.user.id, id, parsed.data)
    return NextResponse.json(detail, { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
