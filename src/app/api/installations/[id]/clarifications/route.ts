import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { editableInstallationOrder } from '@/lib/installations/room-route-access'
import { listInstallationClarifications } from '@/lib/installations/form-service'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  // Clarifications can contain the client's full answers and internal evidence.
  // Assigned installers receive their constrained Task6 projection elsewhere.
  const access = await editableInstallationOrder(session, id)
  if ('response' in access) return access.response
  return NextResponse.json(await listInstallationClarifications(prisma, id), { headers: { 'Cache-Control': 'no-store' } })
}
