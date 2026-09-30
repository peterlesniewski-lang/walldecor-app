import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { getEmployeeCostSettings, updateCostProfile } from '@/lib/payroll/cost-settings'
import { PayrollCostProfileSchema } from '@/lib/validations/payroll'

export async function GET(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const employeeId = req.nextUrl.searchParams.get('employeeId')
  if (!employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
  try {
    return NextResponse.json(await getEmployeeCostSettings(prisma, employeeId), { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const parsed = PayrollCostProfileSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    await updateCostProfile(prisma, auth.session.user.id, parsed.data)
    return NextResponse.json(await getEmployeeCostSettings(prisma, parsed.data.employeeId), { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
