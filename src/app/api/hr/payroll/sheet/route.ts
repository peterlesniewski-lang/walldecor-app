import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { isFuturePeriod, parsePayrollMonth } from '@/lib/payroll/period'
import { getPayrollSheet, submitPayrollSheet } from '@/lib/payroll/service'
import { PayrollSheetSubmitSchema } from '@/lib/validations/payroll'

/** The month sheet: rows with suggestions, flags and blockers (suggestions are never stored). */
export async function GET(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const period = parsePayrollMonth(req.nextUrl.searchParams.get('month'))
  if (!period) return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 })
  try {
    return NextResponse.json(await getPayrollSheet(prisma, period), { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}

/**
 * Approves rows of the sheet. Each row runs in its own transaction and reports APPROVED, UNCHANGED,
 * BLOCKED, CONFLICT or INVALID; a partial success is a 200 with per-row results.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const parsed = PayrollSheetSubmitSchema.safeParse(await req.json().catch(() => null))
  const period = parsed.success ? parsePayrollMonth(parsed.data.month) : null
  if (!parsed.success || !period) {
    return NextResponse.json(
      { error: 'Invalid input', ...(parsed.success ? {} : { details: parsed.error.flatten() }) },
      { status: 400, headers: PAYROLL_NO_STORE }
    )
  }
  if (isFuturePeriod(period)) {
    return NextResponse.json({ error: 'Nie można rozliczyć przyszłego miesiąca.' }, { status: 400, headers: PAYROLL_NO_STORE })
  }
  try {
    const results = await submitPayrollSheet(prisma, auth.session.user.id, period, parsed.data.rows)
    return NextResponse.json({ month: parsed.data.month, results }, { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
