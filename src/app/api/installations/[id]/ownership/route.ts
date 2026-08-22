import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  changeInstallationOwnership,
  createInstallationDelegation,
  endInstallationDelegation,
  InstallationGovernanceValidationError,
} from '@/lib/installations/delegation-service'

type Params = { params: Promise<{ id: string }> }

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('SET_OWNERS'), primaryEmployeeId: z.string().trim().min(1), backupEmployeeId: z.string().trim().min(1) }).strict(),
  z.object({ action: z.literal('CREATE_DELEGATION'), delegateEmployeeId: z.string().trim().min(1), startsAt: z.unknown(), endsAt: z.unknown(), reason: z.string().trim().min(1) }).strict(),
  z.object({ action: z.literal('END_DELEGATION'), delegationId: z.string().trim().min(1) }).strict(),
])

function canManageOwnership(role: string) {
  return role === 'ADMIN' || role === 'MANAGER'
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageOwnership(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  try {
    const parsed = actionSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Działanie odpowiedzialności jest niepoprawne.' }, { status: 400 })
    if (parsed.data.action === 'SET_OWNERS') {
      return NextResponse.json({ order: await changeInstallationOwnership(prisma, id, {
        primaryEmployeeId: parsed.data.primaryEmployeeId,
        backupEmployeeId: parsed.data.backupEmployeeId,
      }, session.user.id) })
    }
    if (parsed.data.action === 'CREATE_DELEGATION') {
      return NextResponse.json({ delegation: await createInstallationDelegation(prisma, id, {
        delegateEmployeeId: parsed.data.delegateEmployeeId,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        reason: parsed.data.reason,
      }, session.user.id) }, { status: 201 })
    }
    return NextResponse.json({ delegation: await endInstallationDelegation(prisma, id, parsed.data.delegationId, session.user.id) })
  } catch (error) {
    if (error instanceof InstallationGovernanceValidationError) {
      return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Działanie odpowiedzialności jest niepoprawne.' }, { status: 400 })
    throw error
  }
}
