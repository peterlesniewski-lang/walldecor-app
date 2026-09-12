import type { InvoiceDraftDetailDto, InvoiceDraftSummaryDto } from './draft-service'
import type { DraftKsefReconciliationsDto } from './ksef-reconciliation-service'

type JsonDates<T> = T extends Date ? string
  : T extends (infer Item)[] ? JsonDates<Item>[]
  : T extends object ? { [Key in keyof T]: JsonDates<T[Key]> }
  : T

/** JSON representations only. Type imports do not bundle any server service. */
export type InvoiceDraftSummary = JsonDates<InvoiceDraftSummaryDto>
export type InvoiceDraftDetail = JsonDates<InvoiceDraftDetailDto>
export type InvoiceDraftKsefReconciliation = JsonDates<DraftKsefReconciliationsDto>
export interface InvoiceKsefResolutionInput {
  reconciliationId: string
  expectedDraftVersion: number
  expectedLinkVersion: number
  action: 'KEEP_LOCAL' | 'APPLY_TO_DRAFT'
  idempotencyKey: string
}
export type InvoiceDraftAction = 'EXTRACT' | 'SKIP' | 'ARCHIVE' | 'RESTORE'
export interface InvoiceReviewIssue { field: string; code: string; messagePolish: string }
export interface InvoiceClosedPeriod { id: string; year: number; month: number; closedAt: string }
export interface InvoiceHistoryEntry { id: string; action: string; actorName: string | null; createdAt: string }
