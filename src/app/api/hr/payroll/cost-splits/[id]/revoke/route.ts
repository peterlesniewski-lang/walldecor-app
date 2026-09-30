import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { revokeCostSplit } from '@/lib/payroll/cost-settings'
import { PayrollRevokeSchema } from '@/lib/validations/payroll'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const { id } = await params
  const parsed = PayrollRevokeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const row = await revokeCostSplit(prisma, auth.session.user.id, id, parsed.data.reason)
    return NextResponse.json(row, { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
