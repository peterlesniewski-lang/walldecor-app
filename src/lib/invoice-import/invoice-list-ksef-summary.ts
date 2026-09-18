import type { Prisma } from '@/generated/prisma'
import { KSEF_RECONCILIATION_STATE_SELECT, summarizeDraftKsefReconciliations } from './ksef-reconciliation-state'

/** Used only for paginated document rows, never for the all-row money query. */
export const INVOICE_IMPORT_LIST_SELECT = {
  id: true, state: true, dataJson: true,
  ksefReconciliations: { select: KSEF_RECONCILIATION_STATE_SELECT },
} as const satisfies Prisma.InvoiceImportDraftSelect

type ListDraft = Prisma.InvoiceImportDraftGetPayload<{ select: typeof INVOICE_IMPORT_LIST_SELECT }>

/** Do not spread the selected source: its JSON and snapshots stay server-side. */
export function invoiceImportListSummary(draft: ListDraft | null | undefined) {
  if (!draft) return null
  return { id: draft.id, state: draft.state,
    ksef: summarizeDraftKsefReconciliations(draft.dataJson, draft.ksefReconciliations) }
}
