import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import {
  changeInstallationVisit,
  InstallationVisitArchivedOrderError,
  InstallationVisitNotFoundError,
  InstallationVisitRevisionConflictError,
} from '@/lib/installations/visit-service'
import { InstallationVisitValidationError } from '@/lib/installations/visit-schemas'

type Params = { params: Promise<{ id: string; visitId: string }> }

function visitErrorResponse(error: unknown) {
  if (error instanceof InstallationVisitValidationError) {
    return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
  }
  if (error instanceof InstallationVisitNotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (error instanceof InstallationVisitRevisionConflictError || error instanceof InstallationVisitArchivedOrderError) {
    return NextResponse.json({ error: 'Conflict' }, { status: 409 })
  }
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
  throw error
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, visitId } = await params
  const editable = await editableInstallationOrder(session, id)
  if ('response' in editable) return editable.response

  try {
    const visit = await changeInstallationVisit(prisma, id, visitId, await req.json(), session.user.id)
    return NextResponse.json(visit)
  } catch (error) {
    return visitErrorResponse(error)
  }
}
