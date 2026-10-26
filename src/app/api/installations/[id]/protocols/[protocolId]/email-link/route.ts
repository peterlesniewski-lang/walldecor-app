import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleInstallationOrder, installationViewerFromSession } from '@/lib/installations/http-access'
import { canEditInstallationOrder } from '@/lib/installations/access'
import { AcceptanceProtocolError } from '@/lib/installations/acceptance-protocol'
import { dispatchAcceptanceEmailLink, revokeAcceptanceLink } from '@/lib/installations/acceptance-client'
import { z } from 'zod'

type Params = { params: Promise<{ id: string; protocolId: string }> }
const noStore = { 'Cache-Control': 'no-store' }

async function access(orderId: string, protocolId: string) {
  const session = await getServerSession(authOptions)
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const viewer = await installationViewerFromSession(session)
  const orderAccess = await accessibleInstallationOrder(orderId, viewer)
  if (orderAccess.response) return { response: orderAccess.response }
  const protocol = await prisma.installationAcceptanceProtocol.findFirst({ where: { id: protocolId, orderId }, select: { id: true, installerId: true } })
  if (!protocol) return { response: NextResponse.json({ error: 'Nie znaleziono protokołu.' }, { status: 404 }) }
  if (!(viewer.role === 'INSTALLER' && viewer.employeeId === protocol.installerId) && !canEditInstallationOrder(viewer, orderAccess.order)) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { installerId: protocol.installerId }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const result = await access(id, protocolId)
  if ('response' in result) return result.response
  const links = await prisma.installationAcceptanceLink.findMany({ where: { protocolId, channel: 'EMAIL' }, select: {
    id: true, expiresAt: true, revokedAt: true, sentAt: true, recipientEmail: true, createdAt: true,
  }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ links }, { headers: noStore })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const result = await access(id, protocolId)
  if ('response' in result) return result.response
  try {
    const sent = await dispatchAcceptanceEmailLink(prisma, protocolId, result.installerId!, req.nextUrl.origin)
    return NextResponse.json({ sent }, { status: 201, headers: noStore })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'VALIDATION' ? 400 : 409, headers: noStore })
    throw error
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const result = await access(id, protocolId)
  if ('response' in result) return result.response
  const parsed = z.object({ linkId: z.string().min(1) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Wskaż link.' }, { status: 400 })
  const link = await prisma.installationAcceptanceLink.findFirst({ where: { id: parsed.data.linkId, protocolId, channel: 'EMAIL' }, select: { id: true } })
  if (!link) return NextResponse.json({ error: 'Nie znaleziono linku.' }, { status: 404 })
  await revokeAcceptanceLink(prisma, link.id)
  return NextResponse.json({ revoked: true }, { headers: noStore })
}
