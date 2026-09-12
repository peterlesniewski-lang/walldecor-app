import { createHash } from 'node:crypto'
import { z } from 'zod'
import { aiJobKindSchema, type AiJobKind, type AiJobResult } from './contracts'
import { aiFailureCodeSchema, type AiFailureCode } from './queue-errors'

export interface ParsedAiWorkerClaim {
  id: string; kind: AiJobKind; leaseToken: string; leaseUntil: string
  prompt: string; schema: Record<string, unknown>; document?: { attachmentId: string }
}
export interface AiWorkerLease { workerId: string; jobId: string; leaseToken: string }
export interface AiWorkerDocumentLease extends AiWorkerLease { attachmentId: string }
export interface AiWorkerDocument {
  bytes: Uint8Array
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp'
  byteSize: number
  sha256: string
}
export type AiWorkerOutcome = { status: 'SUCCEEDED'; result: AiJobResult } | { status: 'FAILED' | 'BLOCKED'; errorCode: AiFailureCode }
export interface AiWorkerTransport {
  claim(workerId: string, signal?: AbortSignal): Promise<ParsedAiWorkerClaim | null>
  heartbeat(lease: AiWorkerLease, signal?: AbortSignal): Promise<{ leaseUntil: string }>
  document(lease: AiWorkerDocumentLease, signal?: AbortSignal): Promise<AiWorkerDocument>
  finish(lease: AiWorkerLease, outcome: AiWorkerOutcome, signal?: AbortSignal): Promise<void>
}
type TransportErrorCode = 'INVALID_CONFIG' | 'INVALID_REQUEST' | 'INVALID_RESPONSE' | 'AUTH' | 'LEASE_LOST' | 'TIMEOUT' | 'ABORTED' | 'TRANSPORT_ERROR'
export class AiWorkerTransportError extends Error {
  constructor(readonly code: TransportErrorCode) { super(code); this.name = 'AiWorkerTransportError' }
}
const id = z.string().trim().min(1).max(191)
const leaseFields = { workerId: id, jobId: id, leaseToken: z.uuid() }
const claimSchema = z.strictObject({
  id, kind: aiJobKindSchema, leaseToken: z.uuid(), leaseUntil: z.iso.datetime(),
  prompt: z.string().min(1).max(500_000), schema: z.record(z.string(), z.unknown()),
  document: z.strictObject({ attachmentId: id }).optional(),
}).refine((value) => (value.kind === 'INVOICE_EXTRACT') === (value.document !== undefined))
const claimResponse = z.strictObject({ job: claimSchema.nullable() })
const heartbeatResponse = z.strictObject({ leaseUntil: z.iso.datetime() })
const finishResponse = z.strictObject({ ok: z.literal(true) })
const commandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('claim'), workerId: id }),
  z.strictObject({ action: z.literal('heartbeat'), ...leaseFields }),
  z.strictObject({ action: z.literal('document'), ...leaseFields, attachmentId: id }),
  z.strictObject({ action: z.literal('finish'), ...leaseFields, outcome: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('SUCCEEDED'), result: z.unknown().refine((value) => value !== undefined) }),
    z.strictObject({ status: z.enum(['FAILED', 'BLOCKED']), errorCode: aiFailureCodeSchema }),
  ]) }),
])
const MAX_REQUEST_BYTES = 128_000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const DOCUMENT_TIMEOUT_MS = 30_000
const documentMimeSchema = z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
    Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {})
    throw new AiWorkerTransportError('INVALID_RESPONSE')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new AiWorkerTransportError('INVALID_RESPONSE')
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) { abort(); throw new AiWorkerTransportError('INVALID_RESPONSE') }
      chunks.push(value)
    }
    if (signal.aborted) throw new AiWorkerTransportError('ABORTED')
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new AiWorkerTransportError('INVALID_RESPONSE') }
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock() }
}

async function readDocumentResponse(response: Response, signal: AbortSignal): Promise<AiWorkerDocument> {
  const mime = documentMimeSchema.safeParse(response.headers.get('content-type'))
  const rawLength = response.headers.get('content-length')
  const rawSha256 = response.headers.get('x-content-sha256')
  const declaredLength = rawLength && /^[1-9][0-9]*$/.test(rawLength) ? Number(rawLength) : Number.NaN
  if (!mime.success || !Number.isSafeInteger(declaredLength) || declaredLength > MAX_DOCUMENT_BYTES ||
    !rawSha256 || !/^[0-9a-f]{64}$/.test(rawSha256)) {
    void response.body?.cancel().catch(() => {})
    throw new AiWorkerTransportError('INVALID_RESPONSE')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new AiWorkerTransportError('INVALID_RESPONSE')
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > declaredLength || bytesRead > MAX_DOCUMENT_BYTES) {
        cancel()
        throw new AiWorkerTransportError('INVALID_RESPONSE')
      }
      chunks.push(value)
    }
    if (signal.aborted) throw new AiWorkerTransportError('ABORTED')
    if (bytesRead !== declaredLength) throw new AiWorkerTransportError('INVALID_RESPONSE')
    const bytes = Buffer.concat(chunks)
    if (createHash('sha256').update(bytes).digest('hex') !== rawSha256) {
      throw new AiWorkerTransportError('INVALID_RESPONSE')
    }
    return { bytes, mimeType: mime.data, byteSize: bytesRead, sha256: rawSha256 }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

/** Server/sidecar transport only. The endpoint is operator configuration, never job input. */
export function createAiWorkerTransport(config: { url: string; secret: string }): AiWorkerTransport {
  let endpoint: URL
  try {
    endpoint = new URL(config.url)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.pathname !== '/api/internal/ai-worker' ||
      endpoint.search || endpoint.hash || /[?#]/.test(config.url) || endpoint.username || endpoint.password ||
      !z.string().min(32).max(1000).regex(/^[\x21-\x7E]+$/).safeParse(config.secret).success) throw new Error()
  } catch { throw new AiWorkerTransportError('INVALID_CONFIG') }
  const target = endpoint.toString()
  const authorization = `Bearer ${config.secret}`

  async function request<T>(command: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new AiWorkerTransportError('ABORTED')
    const parsed = commandSchema.safeParse(command)
    let body: string
    try {
      if (!parsed.success) throw new Error()
      body = JSON.stringify(parsed.data)
      if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new Error()
    } catch { throw new AiWorkerTransportError('INVALID_REQUEST') }
    const requestAbort = new AbortController()
    const abort = () => requestAbort.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 10_000)
    try {
      const response = await fetch(target, {
        method: 'POST', body, signal: requestAbort.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' },
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        throw new AiWorkerTransportError(response.status === 401 || response.status === 403 ? 'AUTH' : response.status === 409 ? 'LEASE_LOST' : 'TRANSPORT_ERROR')
      }
      const result = schema.safeParse(await readResponse(response, requestAbort.signal))
      if (!result.success) throw new AiWorkerTransportError('INVALID_RESPONSE')
      return result.data
    } catch (error) {
      if (signal?.aborted) throw new AiWorkerTransportError('ABORTED')
      if (requestAbort.signal.aborted) throw new AiWorkerTransportError('TIMEOUT')
      if (error instanceof AiWorkerTransportError) throw error
      throw new AiWorkerTransportError('TRANSPORT_ERROR')
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }

  async function requestDocument(lease: AiWorkerDocumentLease, signal?: AbortSignal): Promise<AiWorkerDocument> {
    if (signal?.aborted) throw new AiWorkerTransportError('ABORTED')
    const parsed = commandSchema.safeParse({ action: 'document', ...lease })
    let body: string
    try {
      if (!parsed.success) throw new Error()
      body = JSON.stringify(parsed.data)
      if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new Error()
    } catch { throw new AiWorkerTransportError('INVALID_REQUEST') }
    const requestAbort = new AbortController()
    const abort = () => requestAbort.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, DOCUMENT_TIMEOUT_MS)
    try {
      const response = await fetch(target, {
        method: 'POST', body, signal: requestAbort.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Accept: 'application/pdf, image/png, image/jpeg, image/webp',
        },
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        throw new AiWorkerTransportError(response.status === 401 || response.status === 403 ? 'AUTH' :
          response.status === 409 ? 'LEASE_LOST' : 'TRANSPORT_ERROR')
      }
      return await readDocumentResponse(response, requestAbort.signal)
    } catch (error) {
      if (signal?.aborted) throw new AiWorkerTransportError('ABORTED')
      if (requestAbort.signal.aborted) throw new AiWorkerTransportError('TIMEOUT')
      if (error instanceof AiWorkerTransportError) throw error
      throw new AiWorkerTransportError('TRANSPORT_ERROR')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
  return {
    async claim(workerId, signal) { return (await request({ action: 'claim', workerId }, claimResponse, signal)).job },
    heartbeat(lease, signal) { return request({ action: 'heartbeat', ...lease }, heartbeatResponse, signal) },
    document: requestDocument,
    async finish(lease, outcome, signal) { await request({ action: 'finish', ...lease, outcome }, finishResponse, signal) },
  }
}
