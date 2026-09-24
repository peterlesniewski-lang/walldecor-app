import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AcceptanceLinkNotFoundError, resolvePublicAcceptanceProtocol } from '@/lib/installations/acceptance-client'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import { getSignedAcceptancePhoto, InstallationMediaAccessError } from '@/lib/installation-media/service'

type Params = { params: Promise<{ token: string; fileId: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { token, fileId } = await params
  try {
    const { protocolId } = await resolvePublicAcceptanceProtocol(prisma, token)
    const file = await getSignedAcceptancePhoto(prisma, protocolId, fileId)
    const remote = await privateMediaClientFromEnvironment().download(file.id, { byteSize: file.byteSize, sha256: file.sha256 })
    return new NextResponse(remote.body, { headers: { 'Content-Type': file.contentType, 'Content-Disposition': `inline; filename="${encodeURIComponent(file.originalFilename)}"`, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } })
  } catch (error) {
    if (error instanceof AcceptanceLinkNotFoundError || error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono pliku.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    throw error
  }
}
