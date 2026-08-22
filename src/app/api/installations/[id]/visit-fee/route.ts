import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import {
  approveInstallationVisitFeeOverride,
  InstallationGovernanceValidationError,
  rejectInstallationVisitFeeOverride,
  requestInstallationVisitFeeOverride,
  selectDefaultInstallationVisitFee,
} from '@/lib/installations/delegation-service'

type Params = { params: Promise<{ id: string }> }

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('USE_DEFAULT') }).strict(),
  z.object({ action: z.literal('REQUEST_OVERRIDE'), grossAmount: z.string().trim().min(1), reason: z.string().trim().min(1) }).strict(),
  z.object({ action: z.literal('APPROVE_OVERRIDE') }).strict(),
  z.object({ action: z.literal('REJECT_OVERRIDE'), reason: z.string().trim().min(1) }).strict(),
])

function isAdminOrManager(role: string) {
  return role === 'ADMIN' || role === 'MANAGER'
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  try {
    const parsed = actionSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Działanie opłaty jest niepoprawne.' }, { status: 400 })
    if (parsed.data.action === 'USE_DEFAULT') {
      return NextResponse.json({ order: await selectDefaultInstallationVisitFee(prisma, id, session.user.id) })
    }
    if (parsed.data.action === 'REQUEST_OVERRIDE') {
      return NextResponse.json({ order: await requestInstallationVisitFeeOverride(prisma, id, {
        grossAmount: parsed.data.grossAmount,
        reason: parsed.data.reason,
      }, session.user.id) }, { status: 202 })
    }
    if (!isAdminOrManager(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (parsed.data.action === 'APPROVE_OVERRIDE') {
      return NextResponse.json({ order: await approveInstallationVisitFeeOverride(prisma, id, session.user.id) })
    }
    return NextResponse.json({ order: await rejectInstallationVisitFeeOverride(prisma, id, session.user.id, parsed.data.reason) })
  } catch (error) {
    if (error instanceof InstallationGovernanceValidationError) {
      return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400 })
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Działanie opłaty jest niepoprawne.' }, { status: 400 })
    throw error
  }
}
