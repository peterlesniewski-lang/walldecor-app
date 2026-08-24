import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import { InstallationClarificationValidationError, resolveInstallationClarification } from '@/lib/installations/form-service'

type Params = { params: Promise<{ id: string; clarificationId: string }> }

const updateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('RESOLVE'), resolution: z.string().trim().min(1), note: z.string().trim().optional(), evidenceReference: z.string().trim().optional() }).strict(),
  z.object({ action: z.literal('WAIVE'), note: z.string().trim().min(1), evidenceReference: z.string().trim().optional() }).strict(),
])

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, clarificationId } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  try {
    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Uzupełnij poprawnie ustalenie.', fieldErrors: { form: 'Niepoprawne dane ustalenia.' } }, { status: 400 })
    const clarification = await resolveInstallationClarification(prisma, id, clarificationId, parsed.data, session.user.id)
    return NextResponse.json({ clarification })
  } catch (error) {
    if (error instanceof InstallationClarificationValidationError) return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Uzupełnij poprawnie ustalenie.' }, { status: 400 })
    throw error
  }
}
