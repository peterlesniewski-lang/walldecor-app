import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'
import { refreshSubiektRevenue } from '@/lib/finance/subiekt-revenue'

/** ADMIN: read the last 13 months from the Subiekt bridge now. Never touches Revenue. */
export async function POST() {
  const access = await requireFinanceAdmin()
  if ('error' in access) return access.error
  const result = await refreshSubiektRevenue(prisma)
  if (!result.ok) {
    const status = result.kind === 'not_configured' ? 409 : result.kind === 'unauthorized' ? 502 : 503
    return NextResponse.json({ ok: false, error: result.error }, { status })
  }
  return NextResponse.json({ ok: true, fetchedAt: result.fetchedAt, rows: result.rows, unmappedWarehouses: result.unmappedWarehouses, mapProblems: result.mapProblems })
}
