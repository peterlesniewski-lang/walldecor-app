import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const UpdateSchema = z.object({
  status: z.enum(['PENDING', 'REMINDER_SENT', 'COLLECTION']).optional(),
  amount: z.number().positive().optional(),
  clientName: z.string().max(200).optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const parsed = UpdateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid', details: parsed.error.flatten() }, { status: 400 })
  const data: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.dueDate) data.dueDate = new Date(parsed.data.dueDate)
  const entry = await prisma.receivableEntry.update({ where: { id }, data })
  return NextResponse.json(entry)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  await prisma.receivableEntry.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
