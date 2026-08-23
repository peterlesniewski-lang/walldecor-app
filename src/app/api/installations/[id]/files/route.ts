import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import { privateMediaClientFromEnvironment } from '@/lib/installation-media/client'
import {
  createMismatchEvidenceFile,
  createInternalProjectFile,
  InstallationMediaAccessError,
  InstallationMediaValidationError,
  listInstallationFiles,
} from '@/lib/installation-media/service'

type Params = { params: Promise<{ id: string }> }
const noStore = { 'Cache-Control': 'no-store' }

async function editableSession(orderId: string) {
  const session = await getServerSession(authOptions)
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const access = await editableInstallationOrder(session, orderId)
  if ('response' in access) return access
  return { session, order: access.order }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await editableSession(id)
  if (!('session' in access)) return access.response
  return NextResponse.json({ files: await listInstallationFiles(prisma, id) }, { headers: noStore })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const access = await editableSession(id)
  if (!('session' in access)) return access.response
  try {
    const form = await req.formData()
    const purpose = form.get('purpose')
    const mismatchId = form.get('mismatchId')
    const roomId = form.get('roomId')
    const scopeId = form.get('scopeId')
    const file = form.get('file')
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || !('name' in file) || !('type' in file)) {
      return NextResponse.json({ error: 'Wybierz plik.' }, { status: 400 })
    }
    const upload = { filename: String(file.name), contentType: String(file.type), bytes: new Uint8Array(await file.arrayBuffer()) }
    const uploaded = purpose === 'INTERNAL_PROJECT'
      ? await createInternalProjectFile(prisma, id, access.session.user.id, {
        ...upload,
        roomId: typeof roomId === 'string' ? roomId : null,
        scopeId: typeof scopeId === 'string' ? scopeId : null,
      }, privateMediaClientFromEnvironment())
      : typeof mismatchId === 'string' && mismatchId.trim()
        ? await createMismatchEvidenceFile(prisma, id, mismatchId.trim(), access.session.user.id, upload, privateMediaClientFromEnvironment())
        : null
    if (!uploaded) return NextResponse.json({ error: 'Wskaż niezgodność albo plik projektu.' }, { status: 400 })
    return NextResponse.json({ file: uploaded }, { status: 201, headers: noStore })
  } catch (error) {
    if (error instanceof InstallationMediaAccessError) return NextResponse.json({ error: 'Nie znaleziono pliku lub niezgodności.' }, { status: 404 })
    if (error instanceof InstallationMediaValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    throw error
  }
}
