import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import { getInstallationFileForDownload, InstallationMediaAccessError, softDeleteInstallationFile } from '@/lib/installation-media/service'

type Params = { params: Promise<{ id: string; fileId: string }> }
const noStore = { 'Cache-Control': 'no-store' }

async function editableSession(orderId: string) {
  const session = await getServerSession(authOptions)
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const access = await editableInstallationOrder(session, orderId)
  if ('response' in access) return access
  return { session, order: access.order }
}

function safeDisposition(filename: string) {
  const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'plik'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, fileId } = await params
  const access = await editableSession(id)
  if (!('session' in access)) return access.response
  try {
    const file = await getInstallationFileForDownload(prisma, id, fileId)
    const remote = await privateMediaClientFromEnvironment().download(file.id)
    return new NextResponse(remote.body, { headers: {
      'Content-Type': file.contentType,
      'Content-Disposition': safeDisposition(file.originalFilename),
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono pliku.' }, { status: 404, headers: noStore })
    throw error
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, fileId } = await params
  const access = await editableSession(id)
  if (!('session' in access)) return access.response
  try {
    await softDeleteInstallationFile(prisma, id, fileId, access.session.user.id, privateMediaClientFromEnvironment())
    return NextResponse.json({ ok: true }, { headers: noStore })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono pliku.' }, { status: 404, headers: noStore })
    throw error
  }
}
