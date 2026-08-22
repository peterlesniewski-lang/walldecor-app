import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addInstallationMeasurement, InstallationCatalogValidationError } from '@/lib/installations/catalog-service'
import { editableInstallationOrder, measurementActorFromSession, roomInInstallationOrder } from '@/lib/installations/room-route-access'

type Params = { params: Promise<{ id: string; roomId: string }> }

function measurementBodyWithoutProvenance(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const { source: _source, authorId: _authorId, authorContext: _authorContext, actorUserId: _actorUserId, actorRole: _actorRole, ...body } = input as Record<string, unknown>
  return body
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  if (!await roomInInstallationOrder(id, roomId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await addInstallationMeasurement(prisma, roomId, measurementBodyWithoutProvenance(await req.json()), await measurementActorFromSession(session)), { status: 201 })
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
