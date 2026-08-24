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
import type { InstallationVisitView } from '@/lib/installations/visit-service'

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
  throw error
}

function installerVisitProjection(visit: InstallationVisitView) {
  return {
    id: visit.id,
    orderId: visit.orderId,
    status: visit.status,
    startsAt: visit.startsAt,
    endsAt: visit.endsAt,
    timezone: visit.timezone,
    revision: visit.revision,
    confirmedAt: visit.confirmedAt,
    cancelledAt: visit.cancelledAt,
    completedAt: visit.completedAt,
    createdAt: visit.createdAt,
    updatedAt: visit.updatedAt,
    scopeIds: visit.scopeIds,
    participants: visit.participants.map((participant) => ({
      employeeId: participant.employeeId,
      name: participant.name,
      scopeIds: participant.scopeIds,
      inviteStatus: participant.inviteStatus,
    })),
    syncState: { status: visit.syncState.status },
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const viewer = await installationViewerFromSession(session)
  const loaded = await accessibleInstallationOrder(id, viewer)
  if ('response' in loaded) return loaded.response

  const visits = await listInstallationVisits(prisma, id)
  return NextResponse.json(viewer.role === 'INSTALLER' ? visits.map(installerVisitProjection) : visits)
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
