import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { createBaseSalary, listBaseSalaries } from '@/lib/payroll/service'
import { PayrollBaseSalaryCreateSchema } from '@/lib/validations/payroll'

export async function GET(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const employeeId = req.nextUrl.searchParams.get('employeeId')
  if (!employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
  return NextResponse.json(await listBaseSalaries(prisma, employeeId), { headers: PAYROLL_NO_STORE })
}

export async function POST(req: NextRequest) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const parsed = PayrollBaseSalaryCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const row = await createBaseSalary(prisma, auth.session.user.id, parsed.data)
    return NextResponse.json(row, { status: 201, headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
