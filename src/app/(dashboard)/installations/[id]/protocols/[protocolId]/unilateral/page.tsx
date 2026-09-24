import { clientDisplay } from '@/app/fonts'
import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { getInstallerInstallationCardData } from '@/lib/installations/installer-card-data'
import { getUnilateralProtocol } from '@/lib/installations/acceptance-unilateral'
import { listUnilateralPhotoFiles } from '@/lib/installation-media/service'
import { UnilateralProtocolEditor } from '@/components/installations/unilateral-protocol-editor'

type Params = { params: Promise<{ id: string; protocolId: string }> }

export default async function UnilateralPage({ params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const viewer = await installationViewerFromSession(session)
  if (viewer.role !== 'INSTALLER' || viewer.employeeActive !== true || !viewer.employeeId || viewer.authorized === false) notFound()
  const { id, protocolId } = await params
  if (!await getInstallerInstallationCardData(prisma, id, viewer)) notFound()
  const unilateral = await prisma.installationAcceptanceUnilateral.findUnique({ where: { protocolId }, select: { id: true } })
  if (!unilateral) notFound()
  const document = await getUnilateralProtocol(prisma, unilateral.id, viewer.employeeId).catch(() => null)
  if (!document || document.orderId !== id) notFound()
  const photos = await listUnilateralPhotoFiles(prisma, unilateral.id, viewer.employeeId)
  return <div className={clientDisplay.variable}><UnilateralProtocolEditor unilateral={document} photos={photos.map((photo) => ({ id: photo.id, name: photo.originalFilename }))} /></div>
}
