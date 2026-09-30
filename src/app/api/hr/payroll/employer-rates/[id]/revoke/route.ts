import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { PAYROLL_NO_STORE, payrollErrorResponse, requirePayrollAdmin } from '@/lib/payroll/http'
import { revokeEmployerRate } from '@/lib/payroll/cost-settings'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePayrollAdmin()
  if (auth.error) return auth.error
  const { id } = await params
  try {
    const row = await revokeEmployerRate(prisma, auth.session.user.id, id)
    return NextResponse.json(row, { headers: PAYROLL_NO_STORE })
  } catch (error) {
    return payrollErrorResponse(error)
  }
}
