import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleInstallationOrder, installationViewerFromSession } from '@/lib/installations/http-access'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import { getSignedAcceptancePhoto, InstallationMediaAccessError } from '@/lib/installation-media/service'

type Params = { params: Promise<{ id: string; protocolId: string; fileId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id, protocolId, fileId } = await params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await installationViewerFromSession(session)
  const access = await accessibleInstallationOrder(id, viewer)
  if (access.response) return access.response
  const protocol = await prisma.installationAcceptanceProtocol.findFirst({ where: { id: protocolId, orderId: id }, select: { installerId: true } })
  if (!protocol) return NextResponse.json({ error: 'Nie znaleziono protokołu.' }, { status: 404 })
  if (viewer.role === 'INSTALLER' && viewer.employeeId !== protocol.installerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const file = await getSignedAcceptancePhoto(prisma, protocolId, fileId)
    const remote = await privateMediaClientFromEnvironment().download(file.id, { byteSize: file.byteSize, sha256: file.sha256 })
    return new NextResponse(remote.body, { headers: { 'Content-Type': file.contentType, 'Content-Disposition': `inline; filename="${encodeURIComponent(file.originalFilename)}"`, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono pliku.' }, { status: 404 })
    throw error
  }
}
