import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { CostContractError, applyCostContractAction, listCostContracts } from '@/lib/finance/cost-contract-service'
import { CostContractActionSchema } from '@/lib/validations/cost-contracts'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error
  const { id } = await params
  const parsed = CostContractActionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    await applyCostContractAction(prisma, auth.session.user.id, id, parsed.data)
    return NextResponse.json(await listCostContracts(prisma), { headers: { 'Cache-Control': 'no-store, private' } })
  } catch (error) {
    if (error instanceof CostContractError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && /append-only|cannot be deleted/.test(error.message)) {
      return NextResponse.json({ error: 'Operacja zablokowana — historia umowy jest nienaruszalna.' }, { status: 409 })
    }
    throw error
  }
}
