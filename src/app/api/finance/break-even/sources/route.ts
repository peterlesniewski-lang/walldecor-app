import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { loadBreakEvenSources } from '@/lib/finance/break-even-data'
import { parseBreakEvenPeriod } from '@/lib/finance/break-even-engine'

export async function GET(req: NextRequest) {
  const auth = await requireFinanceReportAccess()
  if (auth.error) return auth.error
  const period = parseBreakEvenPeriod(req.nextUrl.searchParams)
  if (!period) return NextResponse.json({ error: 'Niepoprawny rok lub miesiąc.' }, { status: 400 })
  return NextResponse.json(await loadBreakEvenSources(period.year, period.month))
}
