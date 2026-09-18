export type InvoiceImportErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'EUR_AMOUNT_PRECISION'
  | 'STALE_VERSION'
  | 'INVALID_STATE'
  | 'BATCH_LIMIT'
  | 'DUPLICATE_UNAVAILABLE'
  | 'ATTACHMENT_NOT_READY'
  | 'CORRUPT_DATA'
  | 'CORRUPT_RECEIPT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'KSEF_AMBIGUOUS_MATCH'
  | 'KSEF_CONFLICT'

export class InvoiceImportError extends Error {
  constructor(
    readonly code: InvoiceImportErrorCode,
    readonly status: 403 | 404 | 409 | 422 | 500,
    message = code,
  ) {
    super(message)
    this.name = 'InvoiceImportError'
  }
}
