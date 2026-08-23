import { describe, expect, it } from 'vitest'
import { createVisitFeeSnapshotDigest } from '@/lib/installations/visit-fee-snapshot'

const snapshot = {
  policyId: 'policy-3',
  status: 'APPROVED',
  grossAmount: '249.90',
  clauseText: 'Pełna, zatwierdzona treść informacji dla klienta.',
  clauseVersion: 3,
  legalApprovedAt: new Date('2026-08-20T10:00:00.000Z'),
}

describe('visit-fee public snapshot digest', () => {
  it('is deterministic and changes for every field that forms the legal snapshot', () => {
    const digest = createVisitFeeSnapshotDigest(snapshot)

    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(createVisitFeeSnapshotDigest({ ...snapshot })).toBe(digest)
    expect(createVisitFeeSnapshotDigest({ ...snapshot, policyId: 'policy-4' })).not.toBe(digest)
    expect(createVisitFeeSnapshotDigest({ ...snapshot, status: 'PENDING_APPROVAL' })).not.toBe(digest)
    expect(createVisitFeeSnapshotDigest({ ...snapshot, grossAmount: '250.00' })).not.toBe(digest)
    expect(createVisitFeeSnapshotDigest({ ...snapshot, clauseText: `${snapshot.clauseText} Zmiana.` })).not.toBe(digest)
    expect(createVisitFeeSnapshotDigest({ ...snapshot, clauseVersion: 4 })).not.toBe(digest)
    expect(createVisitFeeSnapshotDigest({ ...snapshot, legalApprovedAt: new Date('2026-08-21T10:00:00.000Z') })).not.toBe(digest)
  })
})
