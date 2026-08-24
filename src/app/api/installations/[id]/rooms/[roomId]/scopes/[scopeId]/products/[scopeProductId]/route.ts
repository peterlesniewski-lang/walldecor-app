import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deleteInstallationScopeProduct, InstallationCatalogValidationError, updateInstallationScopeProduct } from '@/lib/installations/catalog-service'
import { editableInstallationOrder, roomInInstallationOrder } from '@/lib/installations/room-route-access'

type Params = { params: Promise<{ id: string; roomId: string; scopeId: string; scopeProductId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId, scopeId, scopeProductId } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  const room = await roomInInstallationOrder(id, roomId)
  const scope = room?.scopes.find((candidate) => candidate.id === scopeId)
  if (!scope?.scopeProducts.some((product) => product.id === scopeProductId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await deleteInstallationScopeProduct(prisma, scopeProductId, session.user.id)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roomId, scopeId, scopeProductId } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  const room = await roomInInstallationOrder(id, roomId)
  const scope = room?.scopes.find((candidate) => candidate.id === scopeId)
  if (!scope?.scopeProducts.some((product) => product.id === scopeProductId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    return NextResponse.json(await updateInstallationScopeProduct(prisma, scopeProductId, await req.json(), session.user.id))
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) {
      return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: error.status })
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
