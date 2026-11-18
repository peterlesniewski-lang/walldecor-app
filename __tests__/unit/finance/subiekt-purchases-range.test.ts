// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { importRange, monthChunks, readImportFrom, reconciliationRange } from '@/lib/finance/subiekt-purchases'

describe('monthChunks', () => {
  it('should split a range crossing the year boundary at December 31', () => {
    expect(monthChunks('2025-12-15', '2026-01-10')).toEqual([
      { from: '2025-12-15', to: '2025-12-31' },
      { from: '2026-01-01', to: '2026-01-10' },
    ])
  })

  it('should end a February chunk on the 28th in a non-leap year', () => {
    expect(monthChunks('2026-02-01', '2026-03-02')).toEqual([
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-03-02' },
    ])
  })

  it('should return no chunks for an empty range', () => {
    expect(monthChunks('2026-03-02', '2026-03-01')).toEqual([])
  })
})

describe('importRange', () => {
  it('should use the Warsaw calendar day after UTC midnight-adjacent times', () => {
    // 23:30 UTC on Oct 31 is already Nov 1 in Warsaw (CET, UTC+1).
    expect(importRange(new Date('2026-10-31T23:30:00Z'), '2026-01-01', false).to).toBe('2026-11-01')
  })

  it('should backfill from the floor on the first run', () => {
    expect(importRange(new Date('2026-10-31T10:00:00Z'), '2026-01-01', false)).toEqual({ from: '2026-01-01', to: '2026-10-31' })
  })

  it('should read 60 days back after the backfill', () => {
    expect(importRange(new Date('2026-10-31T10:00:00Z'), '2026-01-01', true).from).toBe('2026-09-01')
  })

  it('should never go before the floor in rolling mode', () => {
    expect(importRange(new Date('2026-02-15T10:00:00Z'), '2026-01-01', true).from).toBe('2026-01-01')
  })
})

describe('reconciliationRange', () => {
  it('should cover the current and five previous months across the year boundary', () => {
    expect(reconciliationRange(new Date('2026-03-10T10:00:00Z'))).toEqual({ from: '2025-10-01', to: '2026-03-10' })
  })
})

describe('readImportFrom', () => {
  it('should accept a valid date with surrounding whitespace', () => {
    expect(readImportFrom({ SUBIEKT_PURCHASES_IMPORT_FROM: ' 2026-01-01 ' })).toBe('2026-01-01')
  })

  it('should reject an impossible calendar date', () => {
    expect(readImportFrom({ SUBIEKT_PURCHASES_IMPORT_FROM: '2026-02-30' })).toBeNull()
  })

  it('should reject a non-ISO format', () => {
    expect(readImportFrom({ SUBIEKT_PURCHASES_IMPORT_FROM: '01.01.2026' })).toBeNull()
  })

  it('should return null when the variable is missing', () => {
    expect(readImportFrom({})).toBeNull()
  })
})
