import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { importSubiektForeignPurchases } from '@/lib/finance/subiekt-purchases'

export const dynamic = 'force-dynamic'

/** ADMIN: import foreign FZ/KFZ from Subiekt as invoices (idempotent). */
export async function POST() {
  const access = await requireFinanceAdmin()
  if ('error' in access) return access.error
  const result = await importSubiektForeignPurchases(prisma, { actorId: access.session.user.id })
  if (!result.ok) {
    const status = result.kind === 'forbidden' ? 403
      : result.kind === 'not_configured' ? 409
      : result.kind === 'unauthorized' ? 502 : 503
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }
  return NextResponse.json(result)
}
