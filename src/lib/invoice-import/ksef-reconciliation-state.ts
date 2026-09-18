import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { InvoiceKsefReconciliation, Prisma } from '@/generated/prisma'
import { invoiceDraftDataSchema, type InvoiceDraftData } from './contracts'
import { InvoiceImportError } from './errors'
import {
  compareKsefReconciliation, ksefReconciliationSnapshotSchema,
  type KsefReconciliationSnapshot, type KsefReconciliationDifference,
} from './ksef-reconciliation-policy'

export type KsefReconciliationStatus = 'MATCHED' | 'CONFLICT' | 'KEPT_LOCAL' | 'APPLIED_TO_DRAFT'
export type DraftKsefReconciliationDto = {
  id: string
  externalId: string
  version: number
  status: KsefReconciliationStatus
  approvalBlocked: boolean
  differences: Array<Omit<KsefReconciliationDifference, 'localValue'> & { localValue: string | number | null }>
  snapshot: KsefReconciliationSnapshot
  createdAt: Date
  updatedAt: Date
}

export type StoredKsefReconciliationState = Pick<InvoiceKsefReconciliation,
  'id' | 'externalId' | 'version' | 'snapshotJson' | 'snapshotHash' | 'status'
  | 'resolvedDataHash' | 'createdAt' | 'updatedAt'>

/** State reads must not transfer the cached XML needed only by observation. */
export const KSEF_RECONCILIATION_STATE_SELECT = {
  id: true, externalId: true, version: true, snapshotJson: true, snapshotHash: true,
  status: true, resolvedDataHash: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.InvoiceKsefReconciliationSelect & Record<keyof StoredKsefReconciliationState, true>

export const KSEF_COMPARISON_FIELDS = [
  'documentType', 'supplierName', 'taxId', 'invoiceNumber', 'issueDate', 'currency',
  'gross', 'net', 'vat', 'dueDate', 'bankAccount', 'paymentStatus', 'paidAt',
] as const satisfies ReadonlyArray<keyof InvoiceDraftData>

const statusSchema = z.enum(['MATCHED', 'CONFLICT', 'KEPT_LOCAL', 'APPLIED_TO_DRAFT'])
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

export function parseKsefDraftData(dataJson: string): InvoiceDraftData {
  try { return invoiceDraftDataSchema.parse(JSON.parse(dataJson)) }
  catch { throw new InvoiceImportError('CORRUPT_DATA', 500) }
}

/** Only the fields being reconciled invalidate an explicit KEEP decision. */
export function hashKsefComparisonData(data: InvoiceDraftData): string {
  const parsed = invoiceDraftDataSchema.parse(data)
  return sha256(JSON.stringify(Object.fromEntries(
    KSEF_COMPARISON_FIELDS.map((field) => [field, parsed[field] ?? null]),
  )))
}

/** Zod's fixed object shape provides deterministic key order at both levels. */
export function serializeKsefReconciliationSnapshot(snapshot: KsefReconciliationSnapshot) {
  const snapshotJson = JSON.stringify(ksefReconciliationSnapshotSchema.parse(snapshot))
  return { snapshotJson, snapshotHash: sha256(snapshotJson) }
}

export function parseStoredKsefReconciliation(link: StoredKsefReconciliationState): KsefReconciliationSnapshot {
  try {
    if (Buffer.byteLength(link.snapshotJson, 'utf8') > 64 * 1024) throw new Error('Snapshot too large')
    const snapshot = ksefReconciliationSnapshotSchema.parse(JSON.parse(link.snapshotJson))
    if (snapshot.externalId !== link.externalId) throw new Error('External identity mismatch')
    hashSchema.parse(link.snapshotHash)
    if (link.resolvedDataHash !== null) hashSchema.parse(link.resolvedDataHash)
    statusSchema.parse(link.status)
    z.number().int().positive().parse(link.version)
    if (link.status === 'KEPT_LOCAL' && link.resolvedDataHash === null) throw new Error('Missing decision hash')
    if (serializeKsefReconciliationSnapshot(snapshot).snapshotHash !== link.snapshotHash) {
      throw new Error('Snapshot hash mismatch')
    }
    return snapshot
  } catch { throw new InvoiceImportError('CORRUPT_DATA', 500) }
}

/** Stored status is a decision receipt, never a substitute for current comparison. */
export function draftKsefReconciliationDto(
  data: InvoiceDraftData, link: StoredKsefReconciliationState,
): DraftKsefReconciliationDto {
  const snapshot = parseStoredKsefReconciliation(link)
  const differences = compareKsefReconciliation(data, snapshot)
  let status: KsefReconciliationStatus = 'CONFLICT'
  if (snapshot.documentStatus === 'ACTIVE') {
    if (differences.length === 0) status = link.status === 'APPLIED_TO_DRAFT' ? 'APPLIED_TO_DRAFT' : 'MATCHED'
    else if (link.status === 'KEPT_LOCAL' && link.resolvedDataHash === hashKsefComparisonData(data)) status = 'KEPT_LOCAL'
  }
  return {
    id: link.id, externalId: link.externalId, version: link.version, status,
    approvalBlocked: status === 'CONFLICT', snapshot,
    differences: differences.map((difference) => ({ ...difference, localValue: difference.localValue ?? null })),
    createdAt: link.createdAt, updatedAt: link.updatedAt,
  }
}

export function summarizeDraftKsefReconciliations(dataJson: string, links: readonly StoredKsefReconciliationState[]) {
  const data = parseKsefDraftData(dataJson)
  return { linkedCount: links.length,
    conflictCount: links.filter((link) => draftKsefReconciliationDto(data, link).approvalBlocked).length }
}
