import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCashAdmin } from '@/lib/cash/cash-access'

const UpdateSchema = z.object({
  status: z.enum(['PENDING', 'REMINDER_SENT', 'COLLECTION']).optional(),
  amount: z.number().positive().optional(),
  clientName: z.string().max(200).optional(),
  dueDate: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = UpdateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid', details: parsed.error.flatten() }, { status: 400 })
  const data: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.dueDate) data.dueDate = new Date(parsed.data.dueDate)
  const entry = await prisma.receivableEntry.update({ where: { id }, data })
  return NextResponse.json(entry)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.receivableEntry.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
