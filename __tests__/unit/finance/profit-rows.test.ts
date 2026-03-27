import { describe, it, expect } from 'vitest'

// ─── Pure functions mirrored from BudgetGrid profit-rows logic ────────────────

function calcProfitByMonth(revenueByMonth: number[], costByMonth: number[]): number[] {
  return revenueByMonth.map((rev, i) => rev - (costByMonth[i] ?? 0))
}

function calcCumulativeProfit(profitByMonth: number[]): number[] {
  let running = 0
  return profitByMonth.map((p) => {
    running += p
    return running
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('calcProfitByMonth', () => {
  it('returns 0 for all months when both arrays are zero', () => {
    const zeros = new Array(12).fill(0) as number[]
    expect(calcProfitByMonth(zeros, zeros)).toEqual(zeros)
  })

  it('calculates profit correctly (revenue > costs)', () => {
    const rev  = [100_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const cost = [ 60_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const profit = calcProfitByMonth(rev, cost)
    expect(profit[0]).toBe(40_000)
    expect(profit.slice(1).every((v) => v === 0)).toBe(true)
  })

  it('calculates loss correctly (costs > revenue)', () => {
    const rev  = [50_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const cost = [80_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const profit = calcProfitByMonth(rev, cost)
    expect(profit[0]).toBe(-30_000)
  })

  it('returns 0 for break-even month', () => {
    const val = [75_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const profit = calcProfitByMonth(val, val)
    expect(profit[0]).toBe(0)
  })

  it('handles all 12 months independently', () => {
    const rev  = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]
    const cost = [ 5, 10, 15, 20, 25, 30, 35, 40, 45,  50,  55,  60]
    const profit = calcProfitByMonth(rev, cost)
    expect(profit).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60])
  })
})

describe('calcCumulativeProfit', () => {
  it('returns zeros for zero profit array', () => {
    const zeros = new Array(12).fill(0) as number[]
    expect(calcCumulativeProfit(zeros)).toEqual(zeros)
  })

  it('accumulates correctly month by month', () => {
    const profit = [10_000, 20_000, -5_000, 15_000, 0, 0, 0, 0, 0, 0, 0, 0]
    const cumulative = calcCumulativeProfit(profit)
    expect(cumulative[0]).toBe(10_000)
    expect(cumulative[1]).toBe(30_000)
    expect(cumulative[2]).toBe(25_000)
    expect(cumulative[3]).toBe(40_000)
  })

  it('december cumulative equals sum of all months', () => {
    const profit = [10, -5, 20, 0, 15, -3, 8, 12, -2, 7, 4, 6]
    const total = profit.reduce((s, v) => s + v, 0)
    const cumulative = calcCumulativeProfit(profit)
    expect(cumulative[11]).toBe(total)
  })

  it('handles all losses — cumulative stays negative', () => {
    const profit = new Array(12).fill(-10_000) as number[]
    const cumulative = calcCumulativeProfit(profit)
    expect(cumulative[11]).toBe(-120_000)
    expect(cumulative.every((v) => v < 0)).toBe(true)
  })

  it('only first month has data, rest zero', () => {
    const profit = [50_000, ...new Array(11).fill(0)] as number[]
    const cumulative = calcCumulativeProfit(profit)
    expect(cumulative[0]).toBe(50_000)
    expect(cumulative[11]).toBe(50_000)
    expect(cumulative.every((v) => v === 50_000)).toBe(true)
  })
})
