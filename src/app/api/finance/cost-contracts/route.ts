import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { CostContractError, createCostContract, listCostContracts } from '@/lib/finance/cost-contract-service'
import { CostContractCreateSchema } from '@/lib/validations/cost-contracts'

const NO_STORE = { 'Cache-Control': 'no-store, private' }

export async function GET() {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error
  return NextResponse.json(await listCostContracts(prisma), { headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error
  const parsed = CostContractCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const contract = await createCostContract(prisma, auth.session.user.id, parsed.data)
    return NextResponse.json(contract, { status: 201, headers: NO_STORE })
  } catch (error) {
    if (error instanceof CostContractError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
