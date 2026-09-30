import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { createEmployerRate, listEmployerRates } from '@/lib/payroll/cost-settings'
import { PayrollEmployerRateCreateSchema } from '@/lib/validations/payroll'

export async function GET() {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  return NextResponse.json(await listEmployerRates(prisma), { headers: PAYROLL_NO_STORE })
}

export async function POST(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const parsed = PayrollEmployerRateCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const row = await createEmployerRate(prisma, auth.session.user.id, parsed.data)
    return NextResponse.json(row, { status: 201, headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
