import { z } from 'zod'
import { INVOICE_ATTACHMENT_MAX_BYTES, invoiceDraftDataSchema, invoiceManualFieldsSchema, type InvoiceDraftData } from './contracts'
import type { InvoiceDraftMutationResult } from './approval-service'
import type { InvoiceClosedPeriod, InvoiceDraftAction, InvoiceDraftDetail, InvoiceDraftSummary, InvoiceReviewIssue, InvoiceKsefResolutionInput } from './client-contracts'
import { invoiceKsefDetailSchema, invoiceKsefResultSchema } from './ksef-client-contracts'

const id = z.string().min(1).max(191)
const date = z.iso.datetime()
const latestJob = z.object({
  id, kind: z.literal('INVOICE_EXTRACT'), status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'CANCELLED']),
  errorCode: z.enum(['QUOTA', 'AUTH', 'MODEL_UNAVAILABLE', 'TIMEOUT', 'RUNNER_ERROR', 'INVALID_RESULT', 'LEASE_EXPIRED', 'ACCESS_REVOKED', 'PAYLOAD_INVALID']).nullable(),
  blockedReason: z.enum(['QUOTA', 'AUTH', 'MODEL_UNAVAILABLE']).nullable(),
  attempts: z.number().int().nonnegative(), warnings: z.array(z.string()).max(30), createdAt: date, updatedAt: date,
}).nullable()
const summarySchema = z.object({
  id, batchId: id, version: z.number().int().positive(), extractionRevision: z.number().int().nonnegative(),
  state: z.enum(['OPEN', 'APPROVED', 'ARCHIVED']), skippedAt: date.nullable(), invoiceId: id.nullable(),
  ksef: z.object({ linkedCount: z.number().int().nonnegative(), conflictCount: z.number().int().nonnegative() }),
  display: z.object({ fileName: z.string(), supplierName: z.string().nullable(), invoiceNumber: z.string().nullable(), gross: z.number().finite().nullable(), currency: z.string().nullable() }),
  latestJob, createdAt: date, updatedAt: date,
}) satisfies z.ZodType<InvoiceDraftSummary>
const detailSchema = summarySchema.extend({
  data: invoiceDraftDataSchema, manualFields: invoiceManualFieldsSchema,
  attachment: z.object({
    id, sha256: z.string().regex(/^[a-f0-9]{64}$/), originalName: z.string(),
    mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
    byteSize: z.number().int().positive(), pageCount: z.number().int().positive().nullable(),
    state: z.string(), createdAt: date, updatedAt: date,
  }),
}) satisfies z.ZodType<InvoiceDraftDetail>
const periodSchema = z.object({ id, year: z.number().int(), month: z.number().int().min(1).max(12), closedAt: date })
const mutationBase = { draftId: id, version: z.number().int().positive(), invoiceId: id }
const mutationSchema = z.discriminatedUnion('outcome', [
  z.object({ ...mutationBase, outcome: z.literal('APPROVED'), costEventId: id, invalidatedPeriods: z.array(periodSchema).optional() }),
  z.object({ ...mutationBase, outcome: z.literal('REVOKED'), costEventId: id, invalidatedPeriods: z.array(periodSchema).optional() }),
  z.object({ ...mutationBase, outcome: z.literal('DUPLICATE'), costEventId: z.null(), existingDraftId: id.optional() }),
]) satisfies z.ZodType<InvoiceDraftMutationResult>

const errorSchema = z.object({
  error: z.string().max(2_000).optional(), code: z.string().max(100).optional(),
  issues: z.array(z.object({ field: z.string(), code: z.string(), messagePolish: z.string() })).optional(),
  periods: z.array(periodSchema).optional(), draftId: id.optional(),
})
export class InvoiceImportApiError extends Error {
  constructor(
    readonly code: string, readonly status: number, message: string,
    readonly issues: InvoiceReviewIssue[] = [], readonly periods: InvoiceClosedPeriod[] = [],
    readonly draftId?: string,
  ) { super(message); this.name = 'InvoiceImportApiError' }
}

const ROOT = '/api/finance/invoice-import'
export const invoiceOriginalUrl = (draftId: string, download = false) => `${ROOT}/drafts/${encodeURIComponent(draftId)}/file${download ? '?download=1' : ''}`

/** Browser transport only; credentials remain same-origin cookies. No OAuth,
 * worker secret, filesystem path or provider API is available to this module. */
export function createInvoiceImportClient(fetcher: typeof fetch = fetch) {
  async function request<T>(url: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    let response: Response
    try { response = await fetcher(url, { ...init, cache: 'no-store', credentials: 'same-origin' }) }
    catch {
      const aborted = init.signal?.aborted
      throw new InvoiceImportApiError(aborted ? 'ABORTED' : 'NETWORK_ERROR', 0, aborted
        ? 'Przerwano żądanie.' : 'Nie udało się potwierdzić odpowiedzi serwera. Sprawdź stan przed ponowieniem.')
    }
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const parsed = errorSchema.safeParse(data)
      const error = parsed.success ? parsed.data : {}
      throw new InvoiceImportApiError(error.code ?? 'HTTP_ERROR', response.status,
        error.error ?? 'Nie udało się obsłużyć dokumentu.', error.issues, error.periods, error.draftId)
    }
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new InvoiceImportApiError('INVALID_RESPONSE', 0, 'Serwer zwrócił niepełne dane dokumentu. Odśwież widok.')
    return parsed.data
  }
  const json = (body: unknown, method = 'POST', signal?: AbortSignal): RequestInit => ({ method, signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const draftUrl = (draftId: string) => `${ROOT}/drafts/${encodeURIComponent(draftId)}`
  async function mutation(draftId: string, expectedVersion: number, idempotencyKey: string, confirmedPeriodIds: string[], method: string) {
    return (await request(`${draftUrl(draftId)}/approve`, z.object({ result: mutationSchema }), json({ expectedVersion, idempotencyKey, confirmedPeriodIds }, method))).result
  }
  async function original(draftId: string, expected: Pick<InvoiceDraftDetail['attachment'], 'byteSize' | 'sha256' | 'mimeType'>, signal?: AbortSignal): Promise<Blob> {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(abort, 30_000)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const cancel = () => { void reader?.cancel().catch(() => {}) }
    controller.signal.addEventListener('abort', cancel, { once: true })
    try {
      if (!Number.isSafeInteger(expected.byteSize) || expected.byteSize < 1 || expected.byteSize > INVOICE_ATTACHMENT_MAX_BYTES) throw new Error()
      const response = await fetcher(invoiceOriginalUrl(draftId), { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      if (!response.ok || response.headers.get('content-type') !== expected.mimeType
        || response.headers.get('content-length') !== String(expected.byteSize)) {
        void response.body?.cancel().catch(() => {})
        throw new Error()
      }
      reader = response.body?.getReader()
      if (!reader) throw new Error()
      const bytes = new Uint8Array(expected.byteSize)
      let offset = 0
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read()
        if (done) break
        if (offset + value.byteLength > expected.byteSize) throw new Error()
        bytes.set(value, offset)
        offset += value.byteLength
      }
      if (controller.signal.aborted || offset !== expected.byteSize) throw new Error()
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (digest !== expected.sha256 || controller.signal.aborted) throw new Error()
      return new Blob([bytes], { type: expected.mimeType })
    } catch {
      cancel()
      throw new InvoiceImportApiError(signal?.aborted ? 'ABORTED' : 'INVALID_ORIGINAL', 0,
        'Nie można zweryfikować oryginału. Spróbuj ponownie lub skontaktuj się z administratorem.')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', cancel)
      reader?.releaseLock()
    }
  }
  return {
    original,
    createBatch: async () => (await request(`${ROOT}/batches`, z.object({ batch: z.object({ id }) }), { method: 'POST' })).batch,
    list: async (filters: { batchId?: string; state?: 'OPEN' | 'APPROVED' | 'ARCHIVED'; limit?: number } = {}, signal?: AbortSignal) => {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value))
      return (await request(`${ROOT}/drafts?${query}`, z.object({ drafts: z.array(summarySchema) }), { signal })).drafts
    },
    get: async (draftId: string, signal?: AbortSignal) => (await request(draftUrl(draftId), z.object({ draft: detailSchema }), { signal })).draft,
    ksef: async (draftId: string, signal?: AbortSignal) => (await request(`${draftUrl(draftId)}/ksef`, z.object({
      reconciliation: invoiceKsefDetailSchema.refine((detail) => detail.draftId === draftId),
    }), { signal })).reconciliation,
    resolveKsef: async (draftId: string, input: InvoiceKsefResolutionInput) => (await request(`${draftUrl(draftId)}/ksef`, z.object({
      result: invoiceKsefResultSchema.refine((result) => result.draftId === draftId
        && result.reconciliationId === input.reconciliationId && result.version === input.expectedDraftVersion + 1
        && result.reconciliationVersion === input.expectedLinkVersion + 1
        && result.outcome === (input.action === 'KEEP_LOCAL' ? 'KEPT_LOCAL' : 'APPLIED_TO_DRAFT')),
    }), json(input))).result,
    upload: async (batchId: string, file: File, signal?: AbortSignal) => {
      const form = new FormData()
      form.set('batchId', batchId)
      form.set('file', file, file.name)
      return request(`${ROOT}/drafts`, z.object({ draft: detailSchema, deduplicated: z.boolean() }), { method: 'POST', body: form, signal })
    },
    edit: async (draftId: string, expectedVersion: number, data: InvoiceDraftData) =>
      (await request(draftUrl(draftId), z.object({ draft: detailSchema }), json({ expectedVersion, data }, 'PATCH'))).draft,
    action: async (draftId: string, expectedVersion: number, action: InvoiceDraftAction) =>
      (await request(`${draftUrl(draftId)}/actions`, z.object({ draft: detailSchema }), json({ expectedVersion, action }))).draft,
    approve: (draftId: string, expectedVersion: number, key: string, periods: string[] = []) => mutation(draftId, expectedVersion, key, periods, 'POST'),
    revoke: (draftId: string, expectedVersion: number, key: string, periods: string[] = []) => mutation(draftId, expectedVersion, key, periods, 'DELETE'),
    history: (draftId: string, cursor?: string, signal?: AbortSignal) => request(`${draftUrl(draftId)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, z.object({
      entries: z.array(z.object({ id, action: z.string(), actorName: z.string().nullable(), createdAt: date })), nextCursor: id.nullable(),
    }), { signal }),
  }
}
