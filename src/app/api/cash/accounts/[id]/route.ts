import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireCashAdmin } from '@/lib/cash/cash-access'
import { assertAccountCanBeDeactivated, assertAccountIsNotCashierManaged, cashierTransaction } from '@/lib/cashier/ledger'
import { CashierError } from '@/lib/cashier/errors'

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
  try {
    const updated = await cashierTransaction(prisma, async (tx) => {
      const existing = await tx.cashAccount.findUnique({ where: { id } })
      if (!existing) throw new CashierError(404, 'ACCOUNT_NOT_FOUND', 'Nie znaleziono rachunku.')
      if (parsed.data.balance !== undefined) await assertAccountIsNotCashierManaged(tx, id)
      if (parsed.data.balance !== undefined && parsed.data.balance !== existing.balance) {
        await tx.cashBalanceHistory.create({
          data: {
            accountId: id,
            previousBalance: existing.balance,
            newBalance: parsed.data.balance,
            changedBy: auth.session.user.name ?? auth.session.user.email ?? 'unknown',
          },
        })
      }
      return tx.cashAccount.update({ where: { id }, data: parsed.data })
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof CashierError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    throw error
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCashAdmin()
  if ('error' in auth) return auth.error
  const { id } = await params
  try {
    await cashierTransaction(prisma, async (tx) => {
      await assertAccountCanBeDeactivated(tx, id)
      await tx.cashAccount.update({ where: { id }, data: { isActive: false } })
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CashierError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    throw error
  }
}
