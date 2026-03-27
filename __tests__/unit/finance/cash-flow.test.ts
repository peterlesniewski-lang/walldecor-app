import { describe, it, expect } from 'vitest'

// ─── Pure calculation helpers (mirrored from cash-flow-row.tsx logic) ────────

interface CashAccount {
  id: string
  currency: string
  type: string
  balance: number
}

interface Thresholds {
  cashThresholdVeryGood: number
  cashThresholdGood: number
  cashThresholdBad: number
}

function calcTotalPLN(accounts: CashAccount[], eurRate: number | null): number {
  return accounts.reduce((sum, a) => {
    if (a.currency === 'EUR') return sum + a.balance * (eurRate ?? 0)
    return sum + a.balance
  }, 0)
}

function calcNetCash(totalPLN: number, liabilityAmount: number | null): number {
  return totalPLN - (liabilityAmount ?? 0)
}

type StatusKey = 'veryGood' | 'good' | 'medium' | 'bad'

function getStatusKey(netCash: number, t: Thresholds): StatusKey {
  if (netCash >= t.cashThresholdVeryGood) return 'veryGood'
  if (netCash >= t.cashThresholdGood) return 'good'
  if (netCash >= t.cashThresholdBad) return 'medium'
  return 'bad'
}

function calcReceivablesTotal(amounts: number[]): number {
  return amounts.reduce((s, v) => s + v, 0)
}

const DEFAULT_THRESHOLDS: Thresholds = {
  cashThresholdVeryGood: 300_000,
  cashThresholdGood: 200_000,
  cashThresholdBad: 100_000,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('calcTotalPLN', () => {
  it('returns 0 with no accounts', () => {
    expect(calcTotalPLN([], null)).toBe(0)
  })

  it('sums PLN accounts only', () => {
    const accounts: CashAccount[] = [
      { id: '1', currency: 'PLN', type: 'bank', balance: 10_000 },
      { id: '2', currency: 'PLN', type: 'cash', balance: 5_000 },
    ]
    expect(calcTotalPLN(accounts, null)).toBe(15_000)
  })

  it('converts EUR accounts using rate', () => {
    const accounts: CashAccount[] = [
      { id: '1', currency: 'EUR', type: 'bank', balance: 1_000 },
    ]
    expect(calcTotalPLN(accounts, 4.25)).toBe(4_250)
  })

  it('adds PLN and EUR together', () => {
    const accounts: CashAccount[] = [
      { id: '1', currency: 'PLN', type: 'bank', balance: 50_000 },
      { id: '2', currency: 'EUR', type: 'bank', balance: 2_000 },
    ]
    expect(calcTotalPLN(accounts, 4.2)).toBe(50_000 + 8_400)
  })

  it('treats EUR as 0 when eurRate is null', () => {
    const accounts: CashAccount[] = [
      { id: '1', currency: 'PLN', type: 'bank', balance: 30_000 },
      { id: '2', currency: 'EUR', type: 'bank', balance: 5_000 },
    ]
    expect(calcTotalPLN(accounts, null)).toBe(30_000)
  })
})

describe('calcNetCash', () => {
  it('returns totalPLN unchanged when no liability', () => {
    expect(calcNetCash(200_000, null)).toBe(200_000)
  })

  it('subtracts liability from totalPLN', () => {
    expect(calcNetCash(350_000, 80_000)).toBe(270_000)
  })

  it('can be negative (liability > cash)', () => {
    expect(calcNetCash(50_000, 120_000)).toBe(-70_000)
  })
})

describe('getStatusKey', () => {
  const t = DEFAULT_THRESHOLDS

  it('returns veryGood when netCash >= 300k', () => {
    expect(getStatusKey(300_000, t)).toBe('veryGood')
    expect(getStatusKey(500_000, t)).toBe('veryGood')
  })

  it('returns good when netCash >= 200k and < 300k', () => {
    expect(getStatusKey(200_000, t)).toBe('good')
    expect(getStatusKey(299_999, t)).toBe('good')
  })

  it('returns medium when netCash >= 100k and < 200k', () => {
    expect(getStatusKey(100_000, t)).toBe('medium')
    expect(getStatusKey(199_999, t)).toBe('medium')
  })

  it('returns bad when netCash < 100k', () => {
    expect(getStatusKey(99_999, t)).toBe('bad')
    expect(getStatusKey(0, t)).toBe('bad')
    expect(getStatusKey(-50_000, t)).toBe('bad')
  })
})

describe('calcReceivablesTotal', () => {
  it('returns 0 for empty list', () => {
    expect(calcReceivablesTotal([])).toBe(0)
  })

  it('sums all receivable amounts regardless of status', () => {
    expect(calcReceivablesTotal([10_000, 25_000, 5_000])).toBe(40_000)
  })
})
