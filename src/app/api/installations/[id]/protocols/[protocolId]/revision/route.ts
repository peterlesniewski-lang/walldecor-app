import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleInstallationOrder, installationViewerFromSession } from '@/lib/installations/http-access'
import { canEditInstallationOrder } from '@/lib/installations/access'
import { AcceptanceProtocolError, createAcceptanceRevision } from '@/lib/installations/acceptance-protocol'

type Params = { params: Promise<{ id: string; protocolId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await installationViewerFromSession(session)
  const access = await accessibleInstallationOrder(id, viewer)
  if (access.response) return access.response
  if (!canEditInstallationOrder(viewer, access.order)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const existing = await prisma.installationAcceptanceProtocol.findFirst({ where: { id: protocolId, orderId: id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Nie znaleziono protokołu.' }, { status: 404 })
  try {
    const revision = await createAcceptanceRevision(prisma, protocolId, session.user.id)
    return NextResponse.json({ revision }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'NOT_FOUND' ? 404 : 409 })
    throw error
  }
}
