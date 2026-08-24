import { createHash } from 'node:crypto'

export type VisitFeeSnapshot = {
  policyId: string | null
  status: string
  grossAmount: string | null
  clauseText: string | null
  clauseVersion: number | null
  legalApprovedAt: Date | null
}

/**
 * Opaque ETag for every field that forms the legal fee snapshot. JSON with a
 * fixed array order avoids ambiguous delimiters while keeping the value
 * independent from database serialization details.
 */
export function createVisitFeeSnapshotDigest(snapshot: VisitFeeSnapshot): string {
  const canonical = JSON.stringify([
    snapshot.policyId,
    snapshot.status,
    snapshot.grossAmount,
    snapshot.clauseText,
    snapshot.clauseVersion,
    snapshot.legalApprovedAt?.toISOString() ?? null,
  ])
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}
