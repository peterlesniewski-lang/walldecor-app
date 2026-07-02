import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCashAdmin } from '@/lib/cash/cash-access'

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  balance: z.number().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params
  const parsed = UpdateSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid', details: parsed.error.flatten() }, { status: 400 })
  const existing = await prisma.cashAccount.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (parsed.data.balance !== undefined && parsed.data.balance !== existing.balance) {
    await prisma.cashBalanceHistory.create({
      data: {
        accountId: id,
        previousBalance: existing.balance,
        newBalance: parsed.data.balance,
        changedBy: auth.session.user.name ?? auth.session.user.email ?? 'unknown',
      },
    })
  }
  const updated = await prisma.cashAccount.update({ where: { id }, data: parsed.data })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params
  await prisma.cashAccount.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
