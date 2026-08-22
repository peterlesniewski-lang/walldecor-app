import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deleteInstallationMeasurement, InstallationCatalogValidationError, updateInstallationMeasurement } from '@/lib/installations/catalog-service'
import { editableInstallationOrder, roomInInstallationOrder } from '@/lib/installations/room-route-access'

type Params = { params: Promise<{ id: string; roomId: string; measurementId: string }> }

async function measurementForRoom(orderId: string, roomId: string, measurementId: string) {
  const room = await roomInInstallationOrder(orderId, roomId)
  return room && ([...room.measurements, ...room.scopes.flatMap((scope) => scope.measurements)]).some((measurement) => measurement.id === measurementId)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId, measurementId } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  if (!await measurementForRoom(id, roomId, measurementId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await updateInstallationMeasurement(prisma, measurementId, await req.json(), session.user.id))
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId, measurementId } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  if (!await measurementForRoom(id, roomId, measurementId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await deleteInstallationMeasurement(prisma, measurementId, session.user.id)
  return NextResponse.json({ ok: true })
}
