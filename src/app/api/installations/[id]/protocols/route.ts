import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { installerAcceptanceAccess } from '@/lib/installations/acceptance-http'
import { AcceptanceProtocolError, createAcceptanceDraft, listAcceptanceCandidates } from '@/lib/installations/acceptance-protocol'

type Params = { params: Promise<{ id: string }> }
const noStore = { 'Cache-Control': 'no-store' }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await installerAcceptanceAccess(id)
  if ('response' in access) return access.response
  return NextResponse.json({ candidates: await listAcceptanceCandidates(prisma, id, access.employeeId) }, { headers: noStore })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await installerAcceptanceAccess(id)
  if ('response' in access) return access.response
  try {
    const body = await req.json() as { visitId?: unknown; groupKey?: unknown }
    if (typeof body.visitId !== 'string' || typeof body.groupKey !== 'string' || body.visitId.length > 100 || body.groupKey.length > 150) {
      return NextResponse.json({ error: 'Wybierz wizytę i rodzaj prac.' }, { status: 400 })
    }
    const protocol = await createAcceptanceDraft(prisma, { orderId: id, visitId: body.visitId, groupKey: body.groupKey, installerId: access.employeeId })
    return NextResponse.json({ protocol }, { status: 201, headers: noStore })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : error.code === 'CONFLICT' ? 409 : 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowe dane.' }, { status: 400 })
    throw error
  }
}
