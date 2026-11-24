import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { parsePayrollMonth } from '@/lib/payroll/period'
import { setPayrollMonthReference } from '@/lib/payroll/service'
import { PayrollMonthUpdateSchema } from '@/lib/validations/payroll'

/** Sets the payroll list number of a month (D6). Never creates a settlement version. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ month: string }> }) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const { month } = await params
  const period = parsePayrollMonth(month)
  const parsed = PayrollMonthUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!period || !parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', ...(parsed.success ? {} : { details: parsed.error.flatten() }) },
      { status: 400, headers: PAYROLL_NO_STORE }
    )
  }
  try {
    const saved = await setPayrollMonthReference(prisma, auth.session.user.id, period, parsed.data.listReference)
    return NextResponse.json(saved, { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
