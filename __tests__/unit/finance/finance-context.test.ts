import { describe, expect, it } from 'vitest'
import { buildFinanceAiContext } from '@/lib/ai/finance-context'
import { buildActualDashboard, type DashboardInput, type DashboardRevenue } from '@/lib/finance/actual-dashboard'

const revenue = (year: number, month: number, amount: number): DashboardRevenue[] =>
  [['JAG', 'SALON'], ['JAG', 'MONTAZ'], ['PUL', 'SALON'], ['PUL', 'MONTAZ'], ['PUL', 'ECOMMERCE']].map(([costCenterId, channel]) => ({
    year, month, amount, costCenterId, channel, asOfDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  }))
const build = (overrides: Partial<DashboardInput> = {}) => buildActualDashboard({
  period: { year: 2026, month: 8 }, today: '2026-09-10', revenue: [], previousRevenue: [], actualEntries: [],
  previousActualEntries: [], costEvents: [], previousCostEvents: [], waitingInvoices: [], ...overrides,
})

describe('actual finance AI context', () => {
  it('preserves missing values and completeness instead of turning an empty month into zero profit', () => {
    const context = buildFinanceAiContext(build())
    expect(context.selected).toMatchObject({ revenue: null, result: null, costs: 0, hasCosts: false, costsConfirmed: false, complete: false })
    expect(context.selected.channels.every((row) => row.amount === null && row.status === 'missing')).toBe(true)
    expect(context.ytd).toMatchObject({ revenue: null, result: null, complete: false })
    expect(context.yoy).toBeNull()
    expect(context.currency).toBe('PLN')
    expect(context.costEventFrom).toBe('2026-04-01')
    expect(context.interpretation.join(' ')).toMatch(/null.*zero/)
    expect(context.interpretation.join(' ')).toContain('APPROVED')
    expect(context.interpretation.join(' ')).toContain('budżetu')
    expect(context.interpretation.join(' ')).toContain('dostawców')
  })

  it('retains recorded zero, negative actuals and incomplete channel coverage', () => {
    const rows = revenue(2026, 8, 0)
    rows[0].amount = -100
    rows[0].asOfDate = null
    rows[1].asOfDate = '2026-08-12'
    const model = build({ revenue: rows })
    const context = buildFinanceAiContext(model)
    expect(context.selected).toMatchObject({ revenue: -100, result: -100, complete: false })
    expect(context.selected.channels[0]).toMatchObject({ amount: -100, asOfDate: null, status: 'unknown' })
    expect(context.selected.channels[1]).toMatchObject({ amount: 0, asOfDate: '2026-08-12', status: 'partial' })
  })

  it('retains current-month partialness, YTD and separated pending foreign currency', () => {
    const model = build({ period: { year: 2026, month: 9 }, revenue: revenue(2026, 9, 100),
      waitingInvoices: [{ currency: 'EUR', grossAmount: 100 }, { currency: 'EUR', grossAmount: 100, reportingGrossAmount: 425 }],
    })
    const context = buildFinanceAiContext(model)
    expect(context.selected.partialMonth).toBe(true)
    expect(context.ytd).toEqual(model.ytd)
    expect(context.waiting).toEqual({ count: 2, plnAmount: 425, unconverted: [{ currency: 'EUR', amount: 100 }] })
    expect(context.yoy).toBeNull()
    expect(context.yoyReason).toBe(model.yoyReason)
  })

  it('preserves a full year and comparable actual YoY without exposing center ids or extra input fields', () => {
    const model = build({ period: { year: 2026, month: 12 }, today: '2027-01-10',
      revenue: Array.from({ length: 12 }, (_, index) => revenue(2026, index + 1, 100)).flat(),
      previousRevenue: revenue(2025, 12, 90),
      closedPeriods: [...Array.from({ length: 12 }, (_, index) => ({ year: 2026, month: index + 1 })), { year: 2025, month: 12 }],
    })
    const extendedModel = { ...model, secret: 'SENSITIVE', supplierName: 'PRIVATE VENDOR' }
    const context = buildFinanceAiContext(extendedModel)
    expect(context.months).toHaveLength(12)
    expect(context.ytd).toMatchObject({ revenue: 6000, complete: true })
    expect(context.yoy).toMatchObject({ revenueDelta: 50, resultDelta: 50, previous: { complete: true } })
    expect(context.byCenter.map((row) => row.costCenter)).toEqual(['Salon A', 'Salon B', 'Global'])
    expect(JSON.stringify(context)).not.toMatch(/SENSITIVE|PRIVATE VENDOR|JAG|PUL/)
  })
})
