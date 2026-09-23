import { describe, expect, it } from 'vitest'
import { buildActualDashboard, type DashboardRevenue } from '@/lib/finance/actual-dashboard'
import { confirmedDocumentNet, type DashboardCostEvent, type DashboardRevenueBasis } from '@/lib/finance/ceo-net'
import { employeeCostReadiness } from '@/lib/finance/employee-cost-readiness'

const channels = [['JAG', 'SALON'], ['JAG', 'MONTAZ'], ['PUL', 'SALON'], ['PUL', 'MONTAZ'], ['PUL', 'ECOMMERCE']]
const revenue = (month: number, amount = 100): DashboardRevenue[] => channels.map(([costCenterId, channel]) => ({
  year: 2026, month, amount, costCenterId, channel, asOfDate: new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10),
}))
const basis = (costCenterId: string, netAmount: number, grossAmountSnapshot: number, month = 8): DashboardRevenueBasis => ({
  year: 2026, month, costCenterId, netAmount, grossAmountSnapshot,
})
const document = (netAmount: number | null, grossAmount: number, parts: DashboardCostEvent['parts'], month = 8, extra: Partial<DashboardCostEvent> = {}): DashboardCostEvent => ({
  status: 'APPROVED', eventDate: new Date(`2026-${String(month).padStart(2, '0')}-15T00:00:00Z`), currency: 'PLN', grossAmount, netAmount, vatAmount: null, parts, ...extra,
})
const build = (overrides: Partial<Parameters<typeof buildActualDashboard>[0]> = {}) => buildActualDashboard({
  period: { year: 2026, month: 8 }, today: '2026-09-10', revenue: [], previousRevenue: [], actualEntries: [], costEvents: [], previousActualEntries: [], previousCostEvents: [], waitingInvoices: [], ...overrides,
})

describe('CEO net figures', () => {
  it('uses an entered mixed-rate net instead of dividing gross by 1.23', () => {
    const model = build({
      revenue: revenue(8),
      revenueBases: [basis('JAG', 160, 200), basis('PUL', 250, 300)],
      costEvents: [document(80, 100, [{ grossAmount: 100, tags: [], allocations: [{ costCenterId: 'PUL', percent: 100 }] }])],
      closedPeriods: [{ year: 2026, month: 8 }],
    })
    expect(model.selected.net.revenueNet).toBe(410)
    expect(model.selected.net.revenueNet).not.toBe(Math.round(500 / 1.23 * 100) / 100)
    expect(model.selected.net.costsNet).toBe(80)
    expect(model.selected.net.resultNet).toBe(330)
    expect(model.selected.net.chartValue).toBe(330)
    expect(model.byCenter.find((row) => row.costCenterId === 'PUL')?.net.costsNet).toBe(80)
    expect(model.byCenter.find((row) => row.costCenterId === 'JAG')?.net.costsStatus).toBe('confirmed')
  })

  it('keeps a missing net basis empty instead of inventing 100 from 123 gross', () => {
    const model = build({ revenue: [{ year: 2026, month: 8, costCenterId: 'JAG', channel: 'SALON', amount: 123, asOfDate: '2026-08-31' }] })
    expect(model.selected.net.revenueNet).toBeNull()
    expect(model.selected.net.chartValue).toBeNull()
    expect(model.selected.net.gaps).toEqual([{ costCenterId: 'JAG', status: 'missing', gross: 123 }])
    expect(confirmedDocumentNet({ currency: 'PLN', grossAmount: 123, netAmount: null, vatAmount: null }).net).toBeNull()
  })

  it('drops a net basis when the gross snapshot no longer matches the same revenue', () => {
    const model = build({ revenue: revenue(8), revenueBases: [basis('JAG', 160, 199), basis('PUL', 250, 300)] })
    expect(model.selected.net.revenueNet).toBeNull()
    expect(model.selected.net.gaps).toContainEqual({ costCenterId: 'JAG', status: 'stale', gross: 200 })
  })

  it('derives document net from a stored VAT amount and refuses a foreign document', () => {
    expect(confirmedDocumentNet({ currency: 'PLN', grossAmount: 123, netAmount: null, vatAmount: 23 })).toEqual({ status: 'confirmed', net: 100 })
    expect(confirmedDocumentNet({ currency: 'EUR', grossAmount: 123, netAmount: 100, vatAmount: 23 })).toEqual({ status: 'foreign', net: null })
    const model = build({
      revenue: revenue(8),
      revenueBases: [basis('JAG', 160, 200), basis('PUL', 250, 300)],
      costEvents: [
        document(null, 123, [{ grossAmount: 123, tags: [], allocations: [{ costCenterId: 'JAG', percent: 100 }] }], 8, { vatAmount: 23 }),
        document(null, 50, [{ grossAmount: 50, tags: [], allocations: [{ costCenterId: 'PUL', percent: 100 }] }]),
      ],
      closedPeriods: [{ year: 2026, month: 8 }],
    })
    expect(model.selected.net.costsNet).toBeNull()
    expect(model.selected.net.knownDocumentNet).toBe(100)
    expect(model.selected.net.missingNetDocumentCount).toBe(1)
    expect(model.selected.net.resultNet).toBeNull()
  })

  it('keeps the company document net when a multi-part split would only estimate salon net', () => {
    const model = build({
      revenue: revenue(8),
      revenueBases: [basis('JAG', 160, 200), basis('PUL', 250, 300)],
      costEvents: [document(80, 100, [
        { grossAmount: 40, tags: [{ slug: 'payroll' }], allocations: [{ costCenterId: 'JAG', percent: 100 }] },
        { grossAmount: 60, tags: [], allocations: [{ costCenterId: 'PUL', percent: 100 }] },
      ])],
      closedPeriods: [{ year: 2026, month: 8 }],
    })
    expect(model.selected.net.costsNet).toBe(80)
    expect(model.selected.net.payrollDocumentsIncluded).toBe(true)
    expect(model.byCenter.every((row) => row.net.costsStatus === 'uncertain' && row.net.costsNet === null)).toBe(true)
    expect(employeeCostReadiness()).toEqual({ connected: false, label: expect.stringMatching(/nie są włączone/i) })
    expect(employeeCostReadiness().label).not.toMatch(/zysk netto/i)
  })

  it('does not treat legacy actual entries as confirmed net', () => {
    const model = build({
      period: { year: 2026, month: 3 }, today: '2026-09-10',
      revenue: revenue(3),
      revenueBases: [basis('JAG', 160, 200, 3), basis('PUL', 250, 300, 3)],
      actualEntries: [{ year: 2026, month: 3, amount: 40, costCenterId: 'PUL', subCategory: { isFixed: true } }],
      closedPeriods: [{ year: 2026, month: 3 }],
    })
    expect(model.selected.costs).toBe(40)
    expect(model.selected.net.costsNet).toBeNull()
    expect(model.selected.net.legacyCostUncertain).toBe(true)
    expect(model.selected.net.chartValue).toBeNull()
  })

  it('leaves future months empty and keeps the current month in progress', () => {
    const rows = [...revenue(8), ...revenue(10)]
    const bases = [8, 10].flatMap((month) => [basis('JAG', 160, 200, month), basis('PUL', 250, 300, month)])
    const model = build({ revenue: rows, revenueBases: bases, closedPeriods: [{ year: 2026, month: 8 }, { year: 2026, month: 10 }] })
    expect(model.yearMonths).toHaveLength(12)
    expect(model.yearMonths[9]).toMatchObject({ futureMonth: true, net: { resultNet: 410, chartValue: null } })
    const current = build({ period: { year: 2026, month: 9 }, revenue: revenue(9).map((row) => ({ ...row, asOfDate: '2026-09-10' })), revenueBases: [basis('JAG', 160, 200, 9), basis('PUL', 250, 300, 9)], closedPeriods: [{ year: 2026, month: 9 }] })
    expect(current.selected.partialMonth).toBe(true)
    expect(current.selected.net.chartValue).toBe(410)
  })

  it('sums the year from months that have a net difference and does not fill gaps with zero', () => {
    const model = build({
      revenue: [...revenue(6), ...revenue(8)],
      revenueBases: [basis('JAG', 160, 200, 6), basis('PUL', 250, 300, 6)],
      costEvents: [document(80, 100, [{ grossAmount: 100, tags: [], allocations: [{ costCenterId: 'PUL', percent: 100 }] }], 6)],
      closedPeriods: [{ year: 2026, month: 6 }],
    })
    expect(model.ytdNet).toMatchObject({ revenue: 410, costs: 80, result: 330, complete: false })
    expect(model.ytdNet.omittedMonths).toContain(8)
    expect(model.ytdNet.omittedMonths).not.toContain(6)
    expect(model.ytdNet.result).not.toBe(0)
  })

  it('does not offer a net basis for negative gross', () => {
    const model = build({ revenue: [{ year: 2026, month: 8, costCenterId: 'PUL', channel: 'ECOMMERCE', amount: -20, asOfDate: '2026-08-31' }] })
    expect(model.selected.net.gaps).toEqual([{ costCenterId: 'PUL', status: 'unsupported', gross: -20 }])
  })
})
