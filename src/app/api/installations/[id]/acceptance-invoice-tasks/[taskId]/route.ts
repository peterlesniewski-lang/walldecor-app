import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { accessibleInstallationOrder, installationViewerFromSession } from '@/lib/installations/http-access'
import { canEditInstallationOrder } from '@/lib/installations/access'
import { AcceptanceProtocolError } from '@/lib/installations/acceptance-protocol'
import { markAcceptanceInvoiceTask } from '@/lib/installations/acceptance-invoice-task'
import { z } from 'zod'

type Params = { params: Promise<{ id: string; taskId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, taskId } = await params
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const viewer = await installationViewerFromSession(session)
  const access = await accessibleInstallationOrder(id, viewer)
  if (access.response) return access.response
  if (!canEditInstallationOrder(viewer, access.order)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const parsed = z.object({ status: z.enum(['PENDING', 'DONE']) }).strict().safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Wybierz stan zadania.' }, { status: 400 })
  try {
    const task = await markAcceptanceInvoiceTask(prisma, taskId, id, session.user.id, parsed.data.status)
    return NextResponse.json({ task: { id: task.id, status: task.status } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof AcceptanceProtocolError) return NextResponse.json({ error: error.message }, { status: error.code === 'NOT_FOUND' ? 404 : 409 })
    throw error
  }
}
