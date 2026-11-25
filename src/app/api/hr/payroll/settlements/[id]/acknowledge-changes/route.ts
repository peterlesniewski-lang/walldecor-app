import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { acknowledgePayrollChanges } from '@/lib/payroll/service'
import { PayrollChangesAcknowledgeSchema } from '@/lib/validations/payroll'

/** "Kwota aktualna" (D9): keeps the approved amount despite a change after approval; history only. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const { id } = await params
  const parsed = PayrollChangesAcknowledgeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400, headers: PAYROLL_NO_STORE })
  }
  try {
    const result = await acknowledgePayrollChanges(prisma, auth.session.user.id, { settlementId: id, signature: parsed.data.signature })
    return NextResponse.json(result, { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
