import { z } from 'zod'

/**
 * Server-side client of the walldecor-bridge REST facade (read-only view of
 * the Subiekt GT database). The token never reaches the browser or the AI
 * worker; every failure becomes a SubiektBridgeError with a Polish message
 * that carries no URL, token or stack trace.
 */

export const SUBIEKT_BRIDGE_TIMEOUT_MS = 20_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type SubiektBridgeErrorKind =
  | 'not_configured' | 'unauthorized' | 'unavailable' | 'timeout' | 'invalid_response' | 'bridge_error'

export class SubiektBridgeError extends Error {
  readonly kind: SubiektBridgeErrorKind
  /** Error code from the bridge body (e.g. RANGE_TOO_WIDE), when it sent one. */
  readonly code: string | null

  constructor(kind: SubiektBridgeErrorKind, message: string, code: string | null = null) {
    super(message)
    this.name = 'SubiektBridgeError'
    this.kind = kind
    this.code = code
  }
}

export const SUBIEKT_BRIDGE_MESSAGES: Record<SubiektBridgeErrorKind, string> = {
  not_configured: 'Mostek Subiekt nie jest skonfigurowany (brak SUBIEKT_BRIDGE_URL lub SUBIEKT_BRIDGE_TOKEN).',
  unauthorized: 'Mostek Subiekt odrzucił token aplikacji. Sprawdź SUBIEKT_BRIDGE_TOKEN i zakres sales:read.',
  unavailable: 'Mostek Subiekt jest niedostępny. Sprawdź, czy komputer z bazą Subiekta jest włączony i połączony z siecią.',
  timeout: 'Mostek Subiekt nie odpowiedział w ciągu 20 sekund.',
  invalid_response: 'Mostek Subiekt zwrócił odpowiedź w nieoczekiwanym formacie.',
  bridge_error: 'Mostek Subiekt zgłosił błąd zapytania.',
}

/** Numbers may arrive as numeric strings (DECIMAL serialisation); anything else is invalid. */
const amount = z.coerce.number().finite()
const count = z.coerce.number().int().min(0)

/** `INNE` = dok_Pozycja.ob_TowRodzaj other than towar/usługa; never applied, shown as a warning. */
export const SALES_KINDS = ['TOWAR', 'USLUGA', 'INNE'] as const

export const salesSummaryRowSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  warehouse_symbol: z.string().min(1),
  warehouse_name: z.string().nullish(),
  kind: z.enum(SALES_KINDS),
  documents: count,
  net_total: amount,
  gross_total: amount,
})

export const salesSummarySchema = z.object({
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
  group_by: z.literal('month_warehouse_kind'),
  rows: z.array(salesSummaryRowSchema),
  total: z.object({ documents: count, net_total: amount, gross_total: amount }).partial().nullish(),
  excluded: z.record(z.string(), z.coerce.number()).nullish(),
  summary: z.string().nullish(),
})

export type SalesSummaryRow = z.infer<typeof salesSummaryRowSchema>
export type SalesSummary = z.infer<typeof salesSummarySchema>

const errorBodySchema = z.object({ error: z.object({ code: z.string().optional(), message: z.string().optional() }) })

export interface SubiektBridgeConfig {
  url: string
  token: string
}

type BridgeEnv = Record<string, string | undefined>

/** null when the integration is not configured (both URL and token are required). */
export function readSubiektBridgeConfig(env: BridgeEnv = process.env): SubiektBridgeConfig | null {
  const url = (env.SUBIEKT_BRIDGE_URL ?? '').trim().replace(/\/+$/, '')
  const token = (env.SUBIEKT_BRIDGE_TOKEN ?? '').trim()
  if (!url || !token) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  } catch {
    return null
  }
  return { url, token }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface SalesSummaryQuery {
  from: string
  to: string
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

async function readErrorBody(response: Response): Promise<{ code: string | null; message: string | null }> {
  try {
    const parsed = errorBodySchema.safeParse(await response.json())
    if (!parsed.success) return { code: null, message: null }
    return { code: parsed.data.error.code ?? null, message: parsed.data.error.message ?? null }
  } catch {
    return { code: null, message: null }
  }
}

/**
 * Fetches gross/net sales per month × warehouse × kind (towar/usługa) for
 * `[from, to]` (issue dates). Throws SubiektBridgeError; never returns partial data.
 */
export async function fetchSalesSummary(
  config: SubiektBridgeConfig | null,
  query: SalesSummaryQuery,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SUBIEKT_BRIDGE_TIMEOUT_MS,
): Promise<SalesSummary> {
  if (!config) throw new SubiektBridgeError('not_configured', SUBIEKT_BRIDGE_MESSAGES.not_configured)
  if (!DATE_RE.test(query.from) || !DATE_RE.test(query.to)) {
    throw new SubiektBridgeError('bridge_error', 'Nieprawidłowy zakres dat zapytania do mostka.', 'INVALID_INPUT')
  }
  const params = new URLSearchParams({ from: query.from, to: query.to, group_by: 'month_warehouse_kind' })
  const url = `${config.url}/api/sales/summary?${params.toString()}`

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (error) {
    if (isAbortError(error)) throw new SubiektBridgeError('timeout', SUBIEKT_BRIDGE_MESSAGES.timeout)
    throw new SubiektBridgeError('unavailable', SUBIEKT_BRIDGE_MESSAGES.unavailable)
  }

  if (response.status === 401 || response.status === 403) {
    const body = await readErrorBody(response)
    throw new SubiektBridgeError('unauthorized', SUBIEKT_BRIDGE_MESSAGES.unauthorized, body.code)
  }
  if (response.status === 503 || response.status === 502 || response.status === 504) {
    const body = await readErrorBody(response)
    const message = response.status === 504 ? SUBIEKT_BRIDGE_MESSAGES.timeout : SUBIEKT_BRIDGE_MESSAGES.unavailable
    throw new SubiektBridgeError(response.status === 504 ? 'timeout' : 'unavailable', body.message ?? message, body.code)
  }
  if (!response.ok) {
    const body = await readErrorBody(response)
    const detail = body.message ? ` ${body.message}` : ''
    throw new SubiektBridgeError('bridge_error', `${SUBIEKT_BRIDGE_MESSAGES.bridge_error}${detail}`, body.code)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new SubiektBridgeError('invalid_response', SUBIEKT_BRIDGE_MESSAGES.invalid_response)
  }
  const parsed = salesSummarySchema.safeParse(json)
  if (!parsed.success) {
    // Server log only: field paths help diagnose a contract drift; values never leave the server.
    console.warn(JSON.stringify({ event: 'SUBIEKT_BRIDGE_INVALID_RESPONSE', issues: parsed.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }))
    throw new SubiektBridgeError('invalid_response', SUBIEKT_BRIDGE_MESSAGES.invalid_response)
  }
  return parsed.data
}

/** Message safe to show to an ADMIN; unknown errors never expose internals. */
export function describeSubiektBridgeError(error: unknown): string {
  if (error instanceof SubiektBridgeError) return error.message
  return 'Nie udało się odczytać danych z Subiekta.'
}
