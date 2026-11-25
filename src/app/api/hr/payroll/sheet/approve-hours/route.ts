import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { parsePayrollMonth } from '@/lib/payroll/period'
import { approvePayrollMonthHours } from '@/lib/payroll/service'
import { PayrollApproveHoursSchema } from '@/lib/validations/payroll'

/**
 * "Zatwierdź godziny" (ADMIN): approves every waiting time entry with a clock-out of one hourly person
 * in the month, recording the approver exactly like Czas pracy. Entries without a clock-out stay.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const parsed = PayrollApproveHoursSchema.safeParse(await req.json().catch(() => null))
  const period = parsed.success ? parsePayrollMonth(parsed.data.month) : null
  if (!parsed.success || !period) {
    return NextResponse.json(
      { error: 'Invalid input', ...(parsed.success ? {} : { details: parsed.error.flatten() }) },
      { status: 400, headers: PAYROLL_NO_STORE }
    )
  }
  try {
    const result = await approvePayrollMonthHours(prisma, auth.session.user.id, { employeeId: parsed.data.employeeId, period })
    return NextResponse.json(result, { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
