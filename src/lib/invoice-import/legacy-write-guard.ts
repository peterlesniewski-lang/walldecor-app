import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma'

export const INVOICE_IMPORT_REVIEW_REQUIRED = 'INVOICE_IMPORT_REVIEW_REQUIRED' as const
export const INVOICE_IMPORT_REVIEW_REQUIRED_MESSAGE =
  'Ta faktura jest obsługiwana w procesie przeglądu importu. Wprowadź zmianę w szkicu importu.'

type GuardDb = Pick<Prisma.TransactionClient, 'invoiceImportDraft'>

export interface InvoiceImportWriteConflict {
  invoiceId: string
  draftId: string
}

export class InvoiceImportReviewRequiredError extends Error {
  readonly code = INVOICE_IMPORT_REVIEW_REQUIRED
  readonly status = 409

  constructor(
    readonly conflicts: InvoiceImportWriteConflict[],
    readonly includeConflicts = false,
  ) {
    super(INVOICE_IMPORT_REVIEW_REQUIRED_MESSAGE)
    this.name = 'InvoiceImportReviewRequiredError'
  }

  get draftId() {
    return this.conflicts[0].draftId
  }
}

export async function assertLegacyInvoiceWriteAllowed(db: GuardDb, invoiceId: string): Promise<void> {
  const draft = await db.invoiceImportDraft.findUnique({
    where: { invoiceId },
    select: { id: true },
  })
  if (draft) {
    throw new InvoiceImportReviewRequiredError([{ invoiceId, draftId: draft.id }])
  }
}

export async function assertLegacyInvoiceBatchWriteAllowed(
  db: GuardDb,
  invoiceIds: string[],
): Promise<void> {
  const drafts = await db.invoiceImportDraft.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: { id: true, invoiceId: true },
  })
  if (drafts.length === 0) return

  const inputOrder = new Map(invoiceIds.map((invoiceId, index) => [invoiceId, index]))
  const conflicts = drafts
    .filter((draft): draft is typeof draft & { invoiceId: string } => draft.invoiceId !== null)
    .map((draft) => ({ invoiceId: draft.invoiceId, draftId: draft.id }))
    .sort((left, right) => (inputOrder.get(left.invoiceId) ?? 0) - (inputOrder.get(right.invoiceId) ?? 0))
  throw new InvoiceImportReviewRequiredError(conflicts, true)
}

export function invoiceImportReviewRequiredResponse(error: unknown): NextResponse | null {
  if (!(error instanceof InvoiceImportReviewRequiredError)) return null
  return NextResponse.json({
    code: error.code,
    draftId: error.draftId,
    error: error.message,
    ...(error.includeConflicts ? { conflicts: error.conflicts } : {}),
  }, { status: error.status })
}
