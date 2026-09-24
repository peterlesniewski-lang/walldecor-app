import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { getAcceptanceProtocol } from '@/lib/installations/acceptance-protocol'
import { InstallerProtocolEditor } from '@/components/installations/installer-protocol-editor'
import { listAcceptancePhotoFiles } from '@/lib/installation-media/service'
import { getInstallerInstallationCardData } from '@/lib/installations/installer-card-data'
import { clientDisplay } from '@/app/fonts'

type Params = { params: Promise<{ id: string; protocolId: string }> }

export default async function InstallerProtocolPage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const viewer = await installationViewerFromSession(session)
  if (viewer.role !== 'INSTALLER' || viewer.employeeActive !== true || !viewer.employeeId || viewer.authorized === false) notFound()
  const { id, protocolId } = await params
  if (!await getInstallerInstallationCardData(prisma, id, viewer)) notFound()
  const protocol = await getAcceptanceProtocol(prisma, protocolId, viewer.employeeId).catch(() => null)
  if (!protocol || protocol.orderId !== id) notFound()
  const photos = await listAcceptancePhotoFiles(prisma, protocolId, viewer.employeeId)
  const unilateral = await prisma.installationAcceptanceUnilateral.findUnique({ where: { protocolId }, select: { id: true, status: true } })
  return <div className={clientDisplay.variable}><InstallerProtocolEditor protocol={protocol} unilateral={unilateral} initialPhotos={photos.map(({ id: photoId, originalFilename }) => ({ id: photoId, name: originalFilename }))} /></div>
}
