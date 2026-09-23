import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { installerAcceptanceAccess } from '@/lib/installations/acceptance-http'
import { AcceptanceProtocolError, getAcceptanceProtocol } from '@/lib/installations/acceptance-protocol'
import { createUnilateralDraft, getUnilateralProtocol, signUnilateralProtocol } from '@/lib/installations/acceptance-unilateral'
import { dispatchPendingAcceptanceAlerts } from '@/lib/installations/acceptance-alerts'

type Params = { params: Promise<{ id: string; protocolId: string }> }
const schema = z.object({ id: z.string().min(1), reason: z.enum(['REFUSAL', 'ABSENT', 'NO_RESPONSE']), circumstances: z.string().min(10).max(3000), signature: z.string().min(1).max(400_000) }).strict()
const noStore = { 'Cache-Control': 'no-store' }

async function access(id: string, protocolId: string) {
  const result = await installerAcceptanceAccess(id)
  if ('response' in result) return result
  const protocol = await getAcceptanceProtocol(prisma, protocolId, result.employeeId).catch(() => null)
  if (!protocol || protocol.orderId !== id) return { response: NextResponse.json({ error: 'Nie znaleziono protokołu.' }, { status: 404 }) }
  return result
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const result = await access(id, protocolId)
  if ('response' in result) return result.response
  try {
    const unilateral = await createUnilateralDraft(prisma, protocolId, result.employeeId)
    return NextResponse.json({ unilateral }, { status: 201, headers: noStore })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: 409, headers: noStore })
    throw error
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const result = await access(id, protocolId)
  if ('response' in result) return result.response
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Uzupełnij przyczynę, opis i podpis.' }, { status: 400, headers: noStore })
  try {
    const existing = await getUnilateralProtocol(prisma, parsed.data.id, result.employeeId)
    if (existing.protocolId !== protocolId) return NextResponse.json({ error: 'Nie znaleziono protokołu.' }, { status: 404 })
    const signed = await signUnilateralProtocol(prisma, parsed.data.id, result.employeeId, parsed.data)
    try { await dispatchPendingAcceptanceAlerts(prisma, protocolId) } catch { /* signed evidence stays saved; retry from coordinator panel */ }
    return NextResponse.json({ signed }, { headers: noStore })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'VALIDATION' ? 400 : error.code === 'NOT_FOUND' ? 404 : 409, headers: noStore })
    throw error
  }
}
