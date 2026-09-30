import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { parsePayrollMonth } from '@/lib/payroll/period'
import { createSettlement, listSettlementsForMonth } from '@/lib/payroll/service'
import { PayrollSettlementCreateSchema } from '@/lib/validations/payroll'

export async function GET(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const period = parsePayrollMonth(req.nextUrl.searchParams.get('month'))
  if (!period) return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 })
  return NextResponse.json(await listSettlementsForMonth(prisma, period), { headers: PAYROLL_NO_STORE })
}

export async function POST(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const parsed = PayrollSettlementCreateSchema.safeParse(await req.json().catch(() => null))
  const period = parsed.success ? parsePayrollMonth(parsed.data.month) : null
  if (!parsed.success || !period) {
    return NextResponse.json(
      { error: 'Invalid input', ...(parsed.success ? {} : { details: parsed.error.flatten() }) },
      { status: 400 }
    )
  }
  try {
    const settlement = await createSettlement(prisma, auth.session.user.id, {
      employeeId: parsed.data.employeeId,
      period,
    })
    return NextResponse.json({ id: settlement.id }, { status: 201, headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
