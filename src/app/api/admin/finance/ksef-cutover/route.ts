import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  KSEF_COST_EVENT_START_MONTH,
  KSEF_COST_EVENT_START_YEAR,
} from '@/lib/finance/realized-costs'
import { KSEF_CUTOVER_CONFIRMATION } from '@/lib/finance/ksef-cutover'

const removableActualEntryWhere = {
  OR: [
    { year: { gt: KSEF_COST_EVENT_START_YEAR } },
    { year: KSEF_COST_EVENT_START_YEAR, month: { gte: KSEF_COST_EVENT_START_MONTH } },
  ],
}

const preservedActualEntryWhere = {
  OR: [
    { year: { lt: KSEF_COST_EVENT_START_YEAR } },
    { year: KSEF_COST_EVENT_START_YEAR, month: { lt: KSEF_COST_EVENT_START_MONTH } },
  ],
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (session.user.role !== 'ADMIN') {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

export async function GET() {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response

  const [preservedActualEntriesBeforeCutover, removableActualEntriesFromCutover] =
    await Promise.all([
      prisma.actualEntry.count({ where: preservedActualEntryWhere }),
      prisma.actualEntry.count({ where: removableActualEntryWhere }),
    ])

  return NextResponse.json({
    cutoff: {
      year: KSEF_COST_EVENT_START_YEAR,
      month: KSEF_COST_EVENT_START_MONTH,
    },
    preservedActualEntriesBeforeCutover,
    removableActualEntriesFromCutover,
    confirmation: KSEF_CUTOVER_CONFIRMATION,
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('response' in auth) return auth.response

  const body = await req.json().catch(() => ({}))
  if (body?.confirm !== KSEF_CUTOVER_CONFIRMATION) {
    return NextResponse.json(
      { error: 'Invalid confirmation phrase', confirmation: KSEF_CUTOVER_CONFIRMATION },
      { status: 400 }
    )
  }

  const deleted = await prisma.actualEntry.deleteMany({ where: removableActualEntryWhere })

  await prisma.costAuditLog.create({
    data: {
      action: 'actual_entry.ksef_cutover.delete',
      actorId: auth.session.user.id,
      beforeJson: JSON.stringify({ where: removableActualEntryWhere }),
      afterJson: JSON.stringify({ deletedCount: deleted.count }),
    },
  })

  return NextResponse.json({ deletedCount: deleted.count })
}
