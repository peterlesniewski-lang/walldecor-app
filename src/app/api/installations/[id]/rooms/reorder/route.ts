import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { InstallationCatalogValidationError, reorderInstallationRooms } from '@/lib/installations/catalog-service'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'

type Params = { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  try {
    const body = await req.json() as { orderedIds?: unknown }
    if (!Array.isArray(body.orderedIds) || body.orderedIds.some((item) => typeof item !== 'string')) return NextResponse.json({ error: 'orderedIds musi być listą ID.' }, { status: 400 })
    await reorderInstallationRooms(prisma, id, body.orderedIds)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
