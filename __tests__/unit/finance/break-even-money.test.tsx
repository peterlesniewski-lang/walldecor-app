import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET } from '@/app/api/finance/break-even/route'
import { GET as SOURCES } from '@/app/api/finance/break-even/sources/route'
import { requireFinanceReportAccess } from '@/lib/finance/finance-access'
import { loadBreakEvenReport, loadBreakEvenSources } from '@/lib/finance/break-even-data'
vi.mock('@/lib/finance/break-even-data', () => ({ loadBreakEvenReport: vi.fn(), loadBreakEvenSources: vi.fn() }))
vi.mock('@/lib/finance/finance-access', () => ({ requireFinanceReportAccess: vi.fn() }))

describe('break-even read routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireFinanceReportAccess).mockResolvedValue({ session: { user: { id: 'admin', role: 'ADMIN' } } } as never)
  })
  it('preserves separate PLN and nominal warning currencies in response', async () => {
    const payload = { year: 2026, month: 9, report: { warningAmount: 220, warningSummary: { plnAmount: 220, unconvertedCount: 1, unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }] } } }
    vi.mocked(loadBreakEvenReport).mockResolvedValue(payload as never)
    const response = await GET(new NextRequest('http://localhost/api/finance/break-even?year=2026&month=9'))
    expect(await response.json()).toEqual(payload)
    expect(loadBreakEvenReport).toHaveBeenCalledWith(2026, 9)
  })
  it('validates month before any database reads', async () => {
    expect((await GET(new NextRequest('http://localhost/api/finance/break-even?year=2026&month=99'))).status).toBe(400)
    expect(loadBreakEvenReport).not.toHaveBeenCalled()
  })
  it('protects report and sources from unauthorized callers', async () => {
    vi.mocked(requireFinanceReportAccess).mockResolvedValue({ error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    expect((await GET(new NextRequest('http://localhost/api/finance/break-even'))).status).toBe(403)
    expect((await SOURCES(new NextRequest('http://localhost/api/finance/break-even/sources'))).status).toBe(403)
    expect(loadBreakEvenReport).not.toHaveBeenCalled()
    expect(loadBreakEvenSources).not.toHaveBeenCalled()
  })
})
