import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleInstallationOrder, installationViewerFromSession } from '@/lib/installations/http-access'
import { canEditInstallationOrder } from '@/lib/installations/access'
import { dispatchPendingAcceptanceAlerts } from '@/lib/installations/acceptance-alerts'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await installationViewerFromSession(session)
  const access = await accessibleInstallationOrder(id, viewer)
  if (access.response) return access.response
  if (!canEditInstallationOrder(viewer, access.order)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const protocols = await prisma.installationAcceptanceProtocol.findMany({ where: { orderId: id }, select: { id: true } })
  let sent = 0; let failed = 0
  for (const protocol of protocols) {
    const result = await dispatchPendingAcceptanceAlerts(prisma, protocol.id)
    sent += result.sent; failed += result.failed
  }
  return NextResponse.json({ sent, failed }, { headers: { 'Cache-Control': 'no-store' } })
}
