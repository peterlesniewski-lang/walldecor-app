import { describe, expect, it } from 'vitest'
import { buildRealizedCostSummary } from '@/lib/finance/realized-costs'
import { employerCostMonthsInScope, maskEmployerCostsForRole, type EmployerCostRow } from '@/lib/finance/employer-costs'

// Synthetic amounts only — no real payroll data.
function row(overrides: Partial<EmployerCostRow> & { employeeId: string }): EmployerCostRow {
  return { month: 8, costCenterId: 'JAG', amount: 1000, status: 'APPROVED', ...overrides }
}

function summaryWith(employerCosts: EmployerCostRow[], year = 2026) {
  return buildRealizedCostSummary({ year, actualEntries: [], costEvents: [], employerCosts })
}

describe('employer cost in realized costs', () => {
  it('should add employer cost to the salon result as a fixed cost', () => {
    const summary = summaryWith([row({ employeeId: 'a', costCenterId: 'PUL', amount: 9638.4 })])
    expect([summary.costCenterTotals.PUL, summary.fixedCostsByMonth[7], summary.employerCostsByMonth[7]]).toEqual([9638.4, 9638.4, 9638.4])
  })

  it('should not add employer cost before April 2026 because historical entries already hold wages', () => {
    const summary = summaryWith([row({ employeeId: 'a', month: 3, amount: 5000 })])
    expect(summary.totalCostsByMonth[2]).toBe(0)
  })

  it('should add employer cost from April 2026', () => {
    expect(summaryWith([row({ employeeId: 'a', month: 4, amount: 5000 })]).totalCostsByMonth[3]).toBe(5000)
  })

  it('should keep a zero employer cost month at zero', () => {
    expect(summaryWith([row({ employeeId: 'a', amount: 0 })]).totalCostsByMonth[7]).toBe(0)
  })

  it('should net a negative correction against the month', () => {
    const summary = summaryWith([row({ employeeId: 'a', amount: 1000 }), row({ employeeId: 'a', amount: -200 })])
    expect(summary.totalCostsByMonth[7]).toBe(800)
  })

  it('should mark a month with any estimated employer cost as estimated', () => {
    const summary = summaryWith([row({ employeeId: 'a' }), row({ employeeId: 'b', status: 'ESTIMATE' })])
    expect([summary.employerCostStatusByMonth[7], summary.employerCostStatusByMonth[6]]).toEqual(['ESTIMATE', 'NONE'])
  })

  it('should cover a full year of monthly employer costs from 2027', () => {
    const rows = Array.from({ length: 12 }, (_, index) => row({ employeeId: 'a', month: index + 1, amount: 100 }))
    expect(summaryWith(rows, 2027).totalCostsByMonth.reduce((sum, amount) => sum + amount, 0)).toBe(1200)
  })
})

describe('employer cost months in scope', () => {
  const september2026 = new Date('2026-09-15T10:00:00Z')

  it('should start at April 2026 and stop at the current month', () => {
    expect(employerCostMonthsInScope(2026, september2026)).toEqual([4, 5, 6, 7, 8, 9])
  })

  it('should include no months before the payroll cutover year', () => {
    expect(employerCostMonthsInScope(2025, september2026)).toEqual([])
  })

  it('should include no months of a future year', () => {
    expect(employerCostMonthsInScope(2027, september2026)).toEqual([])
  })

  it('should cover December of a past year and January of the next year across the year boundary', () => {
    const january2027 = new Date('2027-01-10T10:00:00Z')
    expect([employerCostMonthsInScope(2026, january2027).at(-1), employerCostMonthsInScope(2027, january2027)]).toEqual([12, [1]])
  })
})

describe('employer cost visibility', () => {
  const rows = [
    row({ employeeId: 'a', costCenterId: 'JAG', amount: 1000 }),
    row({ employeeId: 'b', costCenterId: 'JAG', amount: 2000 }),
    row({ employeeId: 'c', costCenterId: 'PUL', amount: 4000 }),
  ]

  it('should show ADMIN employer cost per salon', () => {
    expect(maskEmployerCostsForRole(rows, 'ADMIN').map((r) => r.costCenterId)).toEqual(['JAG', 'JAG', 'PUL'])
  })

  it('should move the whole month to the company total for MANAGER when one salon has a single person', () => {
    expect(maskEmployerCostsForRole(rows, 'MANAGER').map((r) => r.costCenterId)).toEqual(['GLOBAL', 'GLOBAL', 'GLOBAL'])
  })

  it('should keep salon sums for MANAGER when every salon has at least two people', () => {
    const shared = [...rows, row({ employeeId: 'd', costCenterId: 'PUL', amount: 3000 })]
    expect(maskEmployerCostsForRole(shared, 'MANAGER').map((r) => r.costCenterId)).toEqual(['JAG', 'JAG', 'PUL', 'PUL'])
  })

  it('should count a person split between salons in both salons', () => {
    const split = [
      row({ employeeId: 'board', costCenterId: 'JAG', amount: 500 }),
      row({ employeeId: 'board', costCenterId: 'PUL', amount: 500 }),
      row({ employeeId: 'a', costCenterId: 'JAG', amount: 1000 }),
      row({ employeeId: 'c', costCenterId: 'PUL', amount: 1000 }),
    ]
    expect(maskEmployerCostsForRole(split, 'MANAGER').every((r) => r.costCenterId !== 'GLOBAL')).toBe(true)
  })

  it('should mask each month independently', () => {
    const twoMonths = [...rows, row({ employeeId: 'a', month: 9 }), row({ employeeId: 'b', month: 9 })]
    expect(maskEmployerCostsForRole(twoMonths, 'MANAGER').filter((r) => r.month === 9).map((r) => r.costCenterId)).toEqual(['JAG', 'JAG'])
  })
})
