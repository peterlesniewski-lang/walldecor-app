import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { installerAcceptanceAccess } from '@/lib/installations/acceptance-http'
import { AcceptanceProtocolError, getAcceptanceProtocol, signAcceptanceProtocol } from '@/lib/installations/acceptance-protocol'
import { z } from 'zod'

type Params = { params: Promise<{ id: string; protocolId: string }> }
const noStore = { 'Cache-Control': 'no-store' }
const signSchema = z.object({
  results: z.array(z.object({ scopeId: z.string().min(1), result: z.enum(['DONE', 'PARTIAL', 'NOT_DONE']), note: z.string().max(2000) })),
  signature: z.string().min(1).max(400_000),
})

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const access = await installerAcceptanceAccess(id)
  if ('response' in access) return access.response
  try {
    const protocol = await getAcceptanceProtocol(prisma, protocolId, access.employeeId)
    if (protocol.orderId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ protocol }, { headers: noStore })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: 404 })
    throw error
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const access = await installerAcceptanceAccess(id)
  if ('response' in access) return access.response
  try {
    const existing = await getAcceptanceProtocol(prisma, protocolId, access.employeeId)
    if (existing.orderId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const parsed = signSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Uzupełnij wynik prac i podpis.' }, { status: 400 })
    const protocol = await signAcceptanceProtocol(prisma, protocolId, access.employeeId, parsed.data)
    return NextResponse.json({ protocol }, { headers: noStore })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowe dane.' }, { status: 400 })
    throw error
  }
}
