import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canEditInstallationOrder, canViewInstallationOrder, type InstallationOrderViewer } from '@/lib/installations/access'
import { InstallationCatalogValidationError, createInstallationRoom, getInstallationOrderRooms } from '@/lib/installations/catalog-service'
import { installationViewerFromSession } from '@/lib/installations/http-access'
import { getInstallationOrder } from '@/lib/installations/order-service'

type Params = { params: Promise<{ id: string }> }

async function loadedOrder(id: string, viewer: InstallationOrderViewer) {
  const order = await getInstallationOrder(prisma, id)
  if (!order) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!canViewInstallationOrder(viewer, order)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { order }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const viewer = await installationViewerFromSession(session)
  const loaded = await loadedOrder(id, viewer)
  if ('response' in loaded) return loaded.response
  return NextResponse.json(await getInstallationOrderRooms(prisma, id))
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const viewer = await installationViewerFromSession(session)
  const loaded = await loadedOrder(id, viewer)
  if ('response' in loaded) return loaded.response
  if (!canEditInstallationOrder(viewer, loaded.order)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (loaded.order.archivedAt) return NextResponse.json({ error: 'Archived' }, { status: 409 })
  try {
    const room = await createInstallationRoom(prisma, id, await req.json(), session.user.id)
    return NextResponse.json(room, { status: 201 })
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
