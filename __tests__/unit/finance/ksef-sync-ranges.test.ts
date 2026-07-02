import { describe, expect, it } from 'vitest'
import { buildKsefSyncDateRanges } from '@/lib/finance/ksef-sync-ranges'

describe('buildKsefSyncDateRanges', () => {
  it('splits long sync windows into consecutive batches shorter than the KSeF 3-month range limit', () => {
    expect(buildKsefSyncDateRanges('2026-01-01', new Date('2026-07-01T12:00:00.000Z'))).toEqual([
      { from: '2026-01-01T00:00:00Z', to: '2026-03-31T00:00:00Z' },
      { from: '2026-04-01T00:00:00Z', to: '2026-06-29T00:00:00Z' },
      { from: '2026-06-30T00:00:00Z', to: '2026-07-01T12:00:00Z' },
    ])
  })
})
