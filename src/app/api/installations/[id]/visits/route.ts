import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleInstallationOrder, installationViewerFromSession } from '@/lib/installations/http-access'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import {
  createInstallationVisit,
  InstallationVisitArchivedOrderError,
  InstallationVisitNotFoundError,
  InstallationVisitRevisionConflictError,
  listInstallationVisits,
} from '@/lib/installations/visit-service'
import { InstallationVisitValidationError } from '@/lib/installations/visit-schemas'

type Params = { params: Promise<{ id: string }> }

function visitErrorResponse(error: unknown) {
  if (error instanceof InstallationVisitValidationError) {
    return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
  }
  if (error instanceof InstallationVisitNotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (error instanceof InstallationVisitRevisionConflictError || error instanceof InstallationVisitArchivedOrderError) {
    return NextResponse.json({ error: 'Conflict' }, { status: 409 })
  }
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
  return NextResponse.json({ error: 'Nie udało się przetworzyć żądania.' }, { status: 500 })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const viewer = await installationViewerFromSession(session)
  const loaded = await accessibleInstallationOrder(id, viewer)
  if ('response' in loaded) return loaded.response

  return NextResponse.json(await listInstallationVisits(prisma, id))
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const editable = await editableInstallationOrder(session, id)
  if ('response' in editable) return editable.response

  try {
    const visit = await createInstallationVisit(prisma, id, await req.json(), session.user.id)
    return NextResponse.json(visit, { status: 201 })
  } catch (error) {
    return visitErrorResponse(error)
  }
}
