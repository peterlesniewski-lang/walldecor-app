import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { reconcileSubiektPayments } from '@/lib/finance/subiekt-purchases'

export const dynamic = 'force-dynamic'

/** ADMIN: live comparison of app payment status with Subiekt liabilities. Writes nothing. */
export async function GET() {
  const access = await requireFinanceAdmin()
  if ('error' in access) return access.error
  const result = await reconcileSubiektPayments(prisma)
  if (!result.ok) {
    const status = result.kind === 'not_configured' ? 409 : result.kind === 'unauthorized' ? 502 : 503
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }
  return NextResponse.json(result)
}
