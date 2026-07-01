import { describe, expect, it } from 'vitest'
import {
  buildRealizedCostSummary,
  isActualEntryInRealizedCostScope,
  isCostEventInRealizedCostScope,
} from '@/lib/finance/realized-costs'

describe('realized cost source cutoff', () => {
  it('uses ActualEntry before April 2026 and CostEvent from April 2026 onward', () => {
    expect(isActualEntryInRealizedCostScope(2026, 3)).toBe(true)
    expect(isActualEntryInRealizedCostScope(2026, 4)).toBe(false)
    expect(isCostEventInRealizedCostScope(new Date('2026-03-31T00:00:00.000Z'))).toBe(false)
    expect(isCostEventInRealizedCostScope(new Date('2026-04-01T00:00:00.000Z'))).toBe(true)
  })
})

describe('buildRealizedCostSummary', () => {
  it('combines historical ActualEntry rows with allocated KSeF CostEvents for the same year', () => {
    const summary = buildRealizedCostSummary({
      year: 2026,
      actualEntries: [
        { year: 2026, month: 1, costCenterId: 'JAG', amount: 100, subCategory: { isFixed: true } },
        { year: 2026, month: 3, costCenterId: 'GLOBAL', amount: 300, subCategory: { isFixed: false } },
        { year: 2026, month: 4, costCenterId: 'JAG', amount: 999, subCategory: { isFixed: true } },
      ],
      costEvents: [
        {
          eventDate: new Date('2026-03-31T00:00:00.000Z'),
          status: 'APPROVED',
          parts: [
            { grossAmount: 200, tags: [], allocations: [{ costCenterId: 'JAG', percent: 100 }] },
          ],
        },
        {
          eventDate: new Date('2026-04-12T00:00:00.000Z'),
          status: 'APPROVED',
          parts: [
            {
              grossAmount: 1000,
              tags: [],
              allocations: [
                { costCenterId: 'JAG', percent: 60 },
                { costCenterId: 'PUL', percent: 40 },
              ],
            },
          ],
        },
      ],
    })

    expect(summary.totalCostsByMonth[0]).toBe(100)
    expect(summary.totalCostsByMonth[2]).toBe(300)
    expect(summary.totalCostsByMonth[3]).toBe(1000)
    expect(summary.costCenterTotals).toEqual({ JAG: 700, PUL: 400, GLOBAL: 300 })
    expect(summary.monthlyRows).toEqual([
      { costCenterId: 'JAG', month: 1, amount: 100 },
      { costCenterId: 'JAG', month: 4, amount: 600 },
      { costCenterId: 'PUL', month: 4, amount: 400 },
      { costCenterId: 'GLOBAL', month: 3, amount: 300 },
    ])
  })

  it('keeps cogs separate for break-even and includes cogs in dashboard variable costs', () => {
    const summary = buildRealizedCostSummary({
      year: 2026,
      actualEntries: [],
      costEvents: [
        {
          eventDate: new Date('2026-05-02T00:00:00.000Z'),
          status: 'APPROVED',
          parts: [
            {
              grossAmount: 500,
              tags: [{ tag: { slug: 'fixed' } }],
              allocations: [{ costCenterId: 'JAG', percent: 100 }],
            },
            {
              grossAmount: 200,
              tags: [{ tag: { slug: 'variable' } }],
              allocations: [{ costCenterId: 'JAG', percent: 100 }],
            },
            {
              grossAmount: 300,
              tags: [{ tag: { slug: 'cogs' } }],
              allocations: [{ costCenterId: 'JAG', percent: 100 }],
            },
          ],
        },
      ],
    })

    expect(summary.fixedCostsByMonth[4]).toBe(500)
    expect(summary.variableCostsByMonth[4]).toBe(500)
    expect(summary.cogsByMonth[4]).toBe(300)
    expect(summary.breakEvenCostRows).toEqual([
      { costCenterId: 'JAG', fixedCosts: 500, variableCosts: 200, cogs: 300 },
      { costCenterId: 'PUL', fixedCosts: 0, variableCosts: 0, cogs: 0 },
      { costCenterId: 'GLOBAL', fixedCosts: 0, variableCosts: 0, cogs: 0 },
    ])
  })
})
