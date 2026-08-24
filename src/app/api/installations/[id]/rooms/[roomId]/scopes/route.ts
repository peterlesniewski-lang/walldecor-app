import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createInstallationScope, InstallationCatalogValidationError } from '@/lib/installations/catalog-service'
import { editableInstallationOrder, roomInInstallationOrder } from '@/lib/installations/room-route-access'

type Params = { params: Promise<{ id: string; roomId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  if (!await roomInInstallationOrder(id, roomId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await createInstallationScope(prisma, roomId, await req.json(), session.user.id), { status: 201 })
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
