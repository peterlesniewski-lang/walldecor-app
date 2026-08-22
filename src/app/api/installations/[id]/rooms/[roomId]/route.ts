import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { InstallationCatalogValidationError, deleteInstallationRoom, updateInstallationRoom } from '@/lib/installations/catalog-service'
import { editableInstallationOrder, roomInInstallationOrder } from '@/lib/installations/room-route-access'

type Params = { params: Promise<{ id: string; roomId: string }> }

async function permitted(session: { user: { role: string; employeeId?: string | null } }, orderId: string, roomId: string) {
  const access = await editableInstallationOrder(session, orderId)
  if ('response' in access) return access
  if (!await roomInInstallationOrder(orderId, roomId)) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return access
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId } = await params
  const access = await permitted(session, id, roomId)
  if ('response' in access) return access.response
  try {
    return NextResponse.json(await updateInstallationRoom(prisma, roomId, await req.json(), session.user.id))
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId } = await params
  const access = await permitted(session, id, roomId)
  if ('response' in access) return access.response
  await deleteInstallationRoom(prisma, roomId, session.user.id)
  return NextResponse.json({ ok: true })
}
