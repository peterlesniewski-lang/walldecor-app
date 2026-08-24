import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import { InstallationVisitRevisionConflictError } from '@/lib/installations/visit-service'
import {
  InstallationScopeAssignmentArchivedOrderError,
  InstallationScopeAssignmentValidationError,
  setScopeInstallerAssignments,
} from '@/lib/installations/scope-assignment-service'

type Params = { params: Promise<{ id: string; scopeId: string }> }

const scopeAssignmentSchema = z.object({
  employeeIds: z.array(z.string().trim().min(1, 'Wybierz poprawnego pracownika.')).max(100, 'Możesz przypisać maksymalnie 100 pracowników.'),
}).strict()

function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) errors[issue.path.join('.') || 'form'] ??= issue.message
  return errors
}

function assignmentErrorResponse(error: unknown) {
  if (error instanceof InstallationScopeAssignmentValidationError) {
    return NextResponse.json({ error: error.message, fieldErrors: { form: error.message } }, { status: 400 })
  }
  if (error instanceof InstallationScopeAssignmentArchivedOrderError || error instanceof InstallationVisitRevisionConflictError) {
    return NextResponse.json({ error: 'Conflict' }, { status: 409 })
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: 'Dane przypisania są niepoprawne.', fieldErrors: fieldErrors(error) }, { status: 400 })
  }
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Nieprawidłowy format danych.' }, { status: 400 })
  throw error
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, scopeId } = await params
  const editable = await editableInstallationOrder(session, id)
  if ('response' in editable) return editable.response

  try {
    const { employeeIds } = scopeAssignmentSchema.parse(await req.json())
    const assignments = await setScopeInstallerAssignments(prisma, id, scopeId, employeeIds, session.user.id)
    return NextResponse.json(assignments)
  } catch (error) {
    return assignmentErrorResponse(error)
  }
}
