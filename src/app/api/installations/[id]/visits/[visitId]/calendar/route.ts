import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import {
  InstallationVisitArchivedOrderError,
  InstallationVisitNotFoundError,
  InstallationVisitRevisionConflictError,
  requeueInstallationCalendar,
} from '@/lib/installations/visit-service'
import { InstallationVisitValidationError } from '@/lib/installations/visit-schemas'

type Params = { params: Promise<{ id: string; visitId: string }> }

const calendarRequeueSchema = z.object({
  forceOverwrite: z.boolean().optional().default(false),
}).strict()

function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) errors[issue.path.join('.') || 'form'] ??= issue.message
  return errors
}

function calendarErrorResponse(error: unknown) {
  if (error instanceof InstallationVisitValidationError) {
    return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Dane żądania są niepoprawne.', fieldErrors: fieldErrors(error) }, { status: 400 })
  }
  if (error instanceof InstallationVisitNotFoundError) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (error instanceof InstallationVisitRevisionConflictError || error instanceof InstallationVisitArchivedOrderError) {
    return NextResponse.json({ error: 'Conflict' }, { status: 409 })
  }
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
  return NextResponse.json({ error: 'Nie udało się przetworzyć żądania.' }, { status: 500 })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, visitId } = await params
  const editable = await editableInstallationOrder(session, id)
  if ('response' in editable) return editable.response

  try {
    const { forceOverwrite } = calendarRequeueSchema.parse(await req.json())
    if (forceOverwrite && session.user.role !== 'ADMIN' && session.user.role !== 'MANAGER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const visit = await requeueInstallationCalendar(prisma, id, visitId, forceOverwrite, session.user.id)
    return NextResponse.json(visit)
  } catch (error) {
    return calendarErrorResponse(error)
  }
}
