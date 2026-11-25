import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getPayrollAutomationStatus, setPayrollAutomationEnabled } from '@/lib/payroll/auto-carryover-scheduler'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { PayrollAutomationUpdateSchema } from '@/lib/validations/payroll'

/** State of the payroll automat: switch, next run, last run result. */
export async function GET() {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  try {
    return NextResponse.json(await getPayrollAutomationStatus(prisma), { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}

/** Turns the automat on or off. Turning it on never runs the current month (D10). */
export async function PUT(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const parsed = PayrollAutomationUpdateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400, headers: PAYROLL_NO_STORE })
  }
  try {
    return NextResponse.json(await setPayrollAutomationEnabled(prisma, parsed.data.enabled), { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
