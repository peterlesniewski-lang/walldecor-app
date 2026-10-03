import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import type { Prisma } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { runErrorResponse } from '@/lib/operations/run-http'
import {
  assertProcedureExists,
  assertRunIsOpen,
  deleteRunItem,
  getProcedureForItem,
  RunServiceError,
} from '@/lib/operations/run-service'
import { RUN_ITEM_STRUCTURE_FIELDS, UpdateChecklistRunItemSchema } from '@/lib/validations/operations'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, itemId } = await params
  const item = await prisma.checklistRunItem.findFirst({ where: { id: itemId, runId: id } })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const canManage = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'
  const isOwner = item.ownerId === session.user.id
  if (!canManage && !isOwner) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = UpdateChecklistRunItemSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const touchesStructure = RUN_ITEM_STRUCTURE_FIELDS.some((field) => parsed.data[field] !== undefined)
  if (touchesStructure && !canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await assertRunIsOpen(prisma, id)
    if (parsed.data.procedureId) await assertProcedureExists(prisma, parsed.data.procedureId)
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }

  // Write only the fields the client sent. Overlapping PATCHes (e.g. a note saved right before a tick) each read
  // the same snapshot, so writing every column would let the last write wipe the other request's change.
  const data: Prisma.ChecklistRunItemUncheckedUpdateInput = {}
  if (parsed.data.status !== undefined) {
    const completed = parsed.data.status === 'done'
    data.status = parsed.data.status
    data.completedAt = completed ? (item.completedAt ?? new Date()) : null
    data.completedById = completed ? (item.completedById ?? session.user.id) : null
  }
  if (parsed.data.note !== undefined) data.note = parsed.data.note
  if (canManage && parsed.data.ownerId !== undefined) data.ownerId = parsed.data.ownerId
  if (parsed.data.title !== undefined) data.title = parsed.data.title
  if (parsed.data.description !== undefined) data.description = parsed.data.description
  if (parsed.data.procedureId !== undefined) data.procedureId = parsed.data.procedureId
  if (parsed.data.recurring !== undefined) data.recurring = parsed.data.recurring

  const updated = await prisma.checklistRunItem.update({ where: { id: item.id }, data })

  const procedure = await getProcedureForItem(prisma, updated.procedureId)
  return NextResponse.json({ ...updated, procedure })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, itemId } = await params

  try {
    await deleteRunItem(prisma, id, itemId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof RunServiceError) return runErrorResponse(error)
    throw error
  }
}
