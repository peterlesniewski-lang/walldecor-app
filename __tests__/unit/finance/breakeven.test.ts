import { describe, it, expect } from 'vitest'
import { calcBep } from '@/lib/bep'

describe('calcBep', () => {
  it('should calculate BEP for normal case (FC=10, VC=30, Rev=50 → BEP=25)', () => {
    // CM = 50 - 30 = 20; BEP = 10 * 50 / 20 = 25
    expect(calcBep(10, 30, 50)).toBe(25)
  })

  it('should return 0 when FC=0 (always at break-even)', () => {
    expect(calcBep(0, 30, 50)).toBe(0)
  })

  it('should return null when Revenue=0', () => {
    expect(calcBep(10, 30, 0)).toBeNull()
  })

  it('should return null when Revenue equals VC (CM=0)', () => {
    expect(calcBep(10, 50, 50)).toBeNull()
  })

  it('should return null when Revenue is less than VC (negative CM)', () => {
    expect(calcBep(10, 60, 50)).toBeNull()
  })
})
