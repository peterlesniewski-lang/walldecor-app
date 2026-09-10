import { describe, expect, it } from 'vitest'
import { buildActualDashboard, resolveDashboardPeriod, type DashboardRevenue } from '@/lib/finance/actual-dashboard'
import type { RealizedCostEventInput } from '@/lib/finance/realized-costs'

const today = '2026-09-10'
const channels = [['JAG', 'SALON'], ['JAG', 'MONTAZ'], ['PUL', 'SALON'], ['PUL', 'MONTAZ'], ['PUL', 'ECOMMERCE']]
const revenue = (year = 2026, month = 8, amount = 100): DashboardRevenue[] => channels.map(([costCenterId, channel]) => ({
  year, month, amount, costCenterId, channel, asOfDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
}))
const costs = (amount = 100, month = 8): RealizedCostEventInput => ({
  status: 'APPROVED', eventDate: new Date(`2026-${String(month).padStart(2, '0')}-15T00:00:00Z`),
  parts: [{ grossAmount: amount, tags: [], allocations: [{ costCenterId: 'PUL', percent: 60 }, { costCenterId: 'GLOBAL', percent: 40 }] }],
})
const build = (overrides: Partial<Parameters<typeof buildActualDashboard>[0]> = {}) => buildActualDashboard({
  period: { year: 2026, month: 8 }, today, revenue: [], previousRevenue: [], actualEntries: [], costEvents: [], previousActualEntries: [], previousCostEvents: [], waitingInvoices: [], ...overrides,
})

describe('actual-only dashboard', () => {
  it('keeps a year without actual revenue empty, never a positive result', () => {
    const model = build()
    expect(model.selected.revenue).toBeNull()
    expect(model.selected.result).toBeNull()
    expect(model.selected.complete).toBe(false)
    expect(model.selected.channels.filter((channel) => channel.status === 'missing')).toHaveLength(5)
    expect(model.yoy).toBeNull()
  })

  it('retains explicitly recorded zero and negative revenue, including a zero total', () => {
    const zero = build({ revenue: revenue(2026, 8, 0), costEvents: [costs()], closedPeriods: [{ year: 2026, month: 8 }] })
    expect(zero.selected.revenue).toBe(0)
    expect(zero.selected.result).toBe(-100)
    expect(zero.selected.complete).toBe(true)
    const negative = build({ revenue: revenue(2026, 8, -20), costEvents: [costs()] })
    expect(negative.selected.result).toBe(-200)
  })

  it('uses selected-month allocations, preserving GLOBAL instead of redistributing it', () => {
    const model = build({ revenue: revenue(), costEvents: [costs(), costs(900, 9)] })
    expect(model.selected).toMatchObject({ revenue: 500, costs: 100, result: 400 })
    expect(model.byCenter.find((row) => row.costCenterId === 'PUL')).toMatchObject({ revenue: 300, costs: 60, result: 240 })
    expect(model.byCenter.find((row) => row.costCenterId === 'GLOBAL')).toMatchObject({ revenue: 0, costs: 40, result: -40 })
    expect(model.ytd.revenue).toBe(500)
    expect(model.ytd.costs).toBe(100)
    expect(model.months).toHaveLength(8)
  })

  it('marks partial channel inputs and unknown legacy freshness individually', () => {
    const rows = revenue()
    rows[0].asOfDate = null
    rows[1].asOfDate = '2026-08-12'
    rows.pop()
    const model = build({ revenue: rows, costEvents: [costs()] })
    expect(model.selected.revenue).toBe(400)
    expect(model.selected.complete).toBe(false)
    expect(model.selected.channels.map((row) => row.status)).toEqual(['unknown', 'partial', 'complete', 'complete', 'missing'])
    expect(model.yoy).toBeNull()
  })

  it('does not label a month with no recorded costs as a complete profit', () => {
    const model = build({ revenue: revenue() })
    expect(model.selected.result).toBe(500)
    expect(model.selected.hasCosts).toBe(false)
    expect(model.selected.complete).toBe(false)
  })

  it('does not treat one recognized cost as confirmation that the company period is complete', () => {
    const model = build({ revenue: revenue(), costEvents: [costs(1)] })
    expect(model.selected.result).toBe(499)
    expect(model.selected.complete).toBe(false)
    expect(model.selected.costsConfirmed).toBe(false)
    expect(model.selected.periodClosed).toBe(false)
    expect(model.byCenter.every((row) => !row.complete)).toBe(true)
  })

  it('keeps a closed month incomplete while a 100000 PLN invoice still awaits a decision', () => {
    const model = build({ revenue: revenue(), previousRevenue: revenue(2025), costEvents: [costs(1)],
      previousActualEntries: [{ year: 2025, month: 8, amount: 1, costCenterId: 'PUL', subCategory: { isFixed: true } }],
      closedPeriods: [{ year: 2026, month: 8 }, { year: 2025, month: 8 }],
      waitingInvoices: [{ currency: 'PLN', grossAmount: 100000 }],
    })
    expect(model.selected).toMatchObject({ result: 499, complete: false, periodClosed: true, pendingDocumentCount: 1, costsConfirmed: false })
    expect(model.byCenter.every((row) => !row.complete)).toBe(true)
    expect(model.yoy).toBeNull()
  })

  it('accepts explicitly closed zero-cost months without inventing a cost row', () => {
    const model = build({ revenue: revenue(), closedPeriods: [{ year: 2026, month: 8 }] })
    expect(model.selected).toMatchObject({ costs: 0, hasCosts: false, complete: true, costsConfirmed: true })
    expect(model.byCenter.every((row) => row.complete)).toBe(true)
  })

  it('blocks r/r when the prior closed period still has a pending cost invoice', () => {
    const model = build({ revenue: revenue(), previousRevenue: revenue(2025), costEvents: [costs()],
      previousActualEntries: [{ year: 2025, month: 8, amount: 50, costCenterId: 'PUL', subCategory: { isFixed: true } }],
      closedPeriods: [{ year: 2026, month: 8 }, { year: 2025, month: 8 }], pendingCostPeriods: [{ year: 2025, month: 8, count: 1 }],
    })
    expect(model.selected.complete).toBe(true)
    expect(model.waiting.count).toBe(0)
    expect(model.yoy).toBeNull()
  })

  it('carries pending cost periods into YTD completeness without contaminating the selected month', () => {
    const model = build({ period: { year: 2026, month: 2 }, revenue: [...revenue(2026, 1), ...revenue(2026, 2)],
      closedPeriods: [{ year: 2026, month: 1 }, { year: 2026, month: 2 }], pendingCostPeriods: [{ year: 2026, month: 1, count: 2 }],
    })
    expect(model.selected.complete).toBe(true)
    expect(model.months[0]).toMatchObject({ pendingDocumentCount: 2, costsConfirmed: false, complete: false })
    expect(model.ytd.complete).toBe(false)
    expect(model.waiting.count).toBe(0)
  })

  it('does not compare a current partial month against a previous full month', () => {
    const model = build({ period: { year: 2026, month: 9 }, revenue: revenue(2026, 9).map((row) => ({ ...row, asOfDate: today })), previousRevenue: revenue(2025, 9), costEvents: [costs(100, 9)] })
    expect(model.selected.partialMonth).toBe(true)
    expect(model.yoy).toBeNull()
    expect(model.yoyReason).toContain('toku')
  })

  it('compares only the same complete actual month with prior actual costs', () => {
    const model = build({ revenue: revenue(), previousRevenue: [...revenue(2025), ...revenue(2025, 12, 10000)], costEvents: [costs()], previousActualEntries: [{ year: 2025, month: 8, amount: 50, costCenterId: 'PUL', subCategory: { isFixed: true } }], closedPeriods: [{ year: 2026, month: 8 }, { year: 2025, month: 8 }] })
    expect(model.yoy).toMatchObject({ revenueDelta: 0, resultDelta: -50, previous: { revenue: 500, costs: 50, result: 450 } })
  })

  it('keeps unknown and partial previous-month dates out of r/r', () => {
    const previous = revenue(2025).map((row) => ({ ...row, asOfDate: null }))
    const model = build({ revenue: revenue(), previousRevenue: previous, costEvents: [costs()] })
    expect(model.yoy).toBeNull()
    expect(model.yoyReason).toContain('porównywalnych')
  })

  it('keeps waiting invoices outside recognized result, with unconverted currency separate', () => {
    const model = build({ revenue: revenue(), costEvents: [costs()], waitingInvoices: [
      { currency: 'PLN', grossAmount: 1000, reportingGrossAmount: null },
      { currency: 'EUR', grossAmount: 100, reportingGrossAmount: null },
      { currency: 'EUR', grossAmount: 100, reportingGrossAmount: 420 },
    ] })
    expect(model.selected.result).toBe(400)
    expect(model.waiting).toEqual({ count: 3, plnAmount: 1420, unconverted: [{ currency: 'EUR', amount: 100 }] })
  })

  it('uses the existing transition from actual entries to approved cost events', () => {
    const model = build({ revenue: revenue(), actualEntries: [{ year: 2026, month: 8, amount: 999, costCenterId: 'PUL', subCategory: { isFixed: true } }], costEvents: [costs(), { ...costs(500), status: 'DRAFT' }] })
    expect(model.selected.costs).toBe(100)
  })
})

describe('shared dashboard period', () => {
  it('defaults to the Warsaw date including a UTC month boundary', () => {
    expect(resolveDashboardPeriod({}, new Date('2026-08-31T22:30:00Z'))).toEqual({ ok: true, period: { year: 2026, month: 9 } })
    expect(resolveDashboardPeriod({ year: '2025' }, new Date('2026-09-10T12:00:00Z'))).toEqual({ ok: true, period: { year: 2025, month: 12 } })
  })
  it.each([{ year: '2026bad' }, { year: '2019' }, { year: '2101' }, { month: '0' }, { month: '13' }, { month: ['8', '9'] }])('rejects malformed periods: %j', (query) => {
    expect(resolveDashboardPeriod(query).ok).toBe(false)
  })
  it('accepts explicit year/month without replacing them by current period', () => {
    expect(resolveDashboardPeriod({ year: '2025', month: '02' })).toEqual({ ok: true, period: { year: 2025, month: 2 } })
  })
})
