import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { installerAcceptanceAccess } from '@/lib/installations/acceptance-http'
import { AcceptanceProtocolError, getAcceptanceProtocol } from '@/lib/installations/acceptance-protocol'
import { issueAcceptanceLink } from '@/lib/installations/acceptance-client'

type Params = { params: Promise<{ id: string; protocolId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const access = await installerAcceptanceAccess(id)
  if ('response' in access) return access.response
  try {
    const protocol = await getAcceptanceProtocol(prisma, protocolId, access.employeeId)
    if (protocol.orderId !== id) return NextResponse.json({ error: 'Nie znaleziono protokołu.' }, { status: 404 })
    const { token } = await issueAcceptanceLink(prisma, protocolId, access.employeeId, 'ONSITE')
    return NextResponse.json({ path: `/p/${token}` }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'NOT_FOUND' ? 404 : 409 })
    throw error
  }
}
