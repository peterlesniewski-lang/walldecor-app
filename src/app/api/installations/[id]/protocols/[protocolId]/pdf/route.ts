import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleInstallationOrder, installationViewerFromSession } from '@/lib/installations/http-access'
import { AcceptanceProtocolError } from '@/lib/installations/acceptance-protocol'
import { getOrCreateAcceptancePdf, type AcceptancePdfKind } from '@/lib/installations/acceptance-pdf'

type Params = { params: Promise<{ id: string; protocolId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await installationViewerFromSession(session)
  const access = await accessibleInstallationOrder(id, viewer)
  if (access.response) return access.response
  const protocol = await prisma.installationAcceptanceProtocol.findFirst({ where: { id: protocolId, orderId: id }, select: { installerId: true } })
  if (!protocol) return NextResponse.json({ error: 'Nie znaleziono protokołu.' }, { status: 404 })
  if (viewer.role === 'INSTALLER' && viewer.employeeId !== protocol.installerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const kind: AcceptancePdfKind = req.nextUrl.searchParams.get('kind') === 'UNILATERAL' ? 'UNILATERAL' : 'ACCEPTANCE'
    const document = await getOrCreateAcceptancePdf(prisma, protocolId, kind)
    return new NextResponse(new Uint8Array(document.bytes), { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="walldecor-protokol-${kind.toLowerCase()}.pdf"`,
      'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'NOT_FOUND' ? 404 : 409 })
    throw error
  }
}
