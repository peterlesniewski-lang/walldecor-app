import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { installerAcceptanceAccess } from '@/lib/installations/acceptance-http'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import { InstallationMultipartError, parseInstallationMultipart } from '@/lib/installation-media/multipart'
import { createAcceptancePhotoFile, InstallationMediaAccessError, InstallationMediaValidationError, listAcceptancePhotoFiles } from '@/lib/installation-media/service'
import { getAcceptanceProtocol } from '@/lib/installations/acceptance-protocol'

type Params = { params: Promise<{ id: string; protocolId: string }> }
const noStore = { 'Cache-Control': 'no-store' }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const access = await installerAcceptanceAccess(id)
  if ('response' in access) return access.response
  const protocol = await getAcceptanceProtocol(prisma, protocolId, access.employeeId).catch(() => null)
  if (!protocol || protocol.orderId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ photos: await listAcceptancePhotoFiles(prisma, protocolId, access.employeeId) }, { headers: noStore })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id, protocolId } = await params
  const access = await installerAcceptanceAccess(id)
  if ('response' in access) return access.response
  const protocol = await getAcceptanceProtocol(prisma, protocolId, access.employeeId).catch(() => null)
  if (!protocol || protocol.orderId !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const { file } = await parseInstallationMultipart(req, { allowedFields: [] })
    const photo = await createAcceptancePhotoFile(prisma, protocolId, access.employeeId, { filename: file.filename, contentType: file.contentType, bytes: file.bytes }, privateMediaClientFromEnvironment())
    return NextResponse.json({ photo: { id: photo.id, originalFilename: photo.originalFilename } }, { status: 201, headers: noStore })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono szkicu protokołu.' }, { status: 404 })
    if (error instanceof InstallationMediaValidationError) return NextResponse.json({ error: error.fieldErrors.file ?? error.message }, { status: 400 })
    if (error instanceof InstallationMultipartError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
