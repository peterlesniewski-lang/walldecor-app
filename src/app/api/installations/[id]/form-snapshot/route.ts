import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createInstallationOrderFormSnapshot, InstallationCatalogValidationError } from '@/lib/installations/catalog-service'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  try {
    const body = await req.json()
    return NextResponse.json(await createInstallationOrderFormSnapshot(prisma, { orderId: id, templateId: body.templateId }, session.user.id), { status: 201 })
  } catch (error) {
    if (error instanceof InstallationCatalogValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
    throw error
  }
}
