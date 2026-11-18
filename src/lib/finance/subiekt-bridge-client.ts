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
  not_configured: 'Mostek Subiekt nie jest skonfigurowany. Sprawdź SUBIEKT_BRIDGE_URL, SUBIEKT_BRIDGE_TOKEN oraz kompletność pary SUBIEKT_BRIDGE_CF_ACCESS_CLIENT_ID i SUBIEKT_BRIDGE_CF_ACCESS_CLIENT_SECRET.',
  unauthorized: 'Mostek Subiekt odrzucił token aplikacji. Sprawdź SUBIEKT_BRIDGE_TOKEN i zakresy sales:read oraz purchases:read.',
  unavailable: 'Mostek Subiekt jest niedostępny. Sprawdź, czy komputer z bazą Subiekta jest włączony i połączony z siecią.',
  timeout: 'Mostek Subiekt nie odpowiedział w ciągu 20 sekund.',
  invalid_response: 'Mostek Subiekt zwrócił odpowiedź w nieoczekiwanym formacie.',
  bridge_error: 'Mostek Subiekt zgłosił błąd zapytania.',
}

/** Numbers may arrive as numeric strings (DECIMAL serialisation); anything else is invalid. */
const numericValue = z.union([z.number(), z.string().trim().min(1)]).transform(Number).pipe(z.number().finite())
const amount = numericValue
const count = numericValue.pipe(z.number().int().min(0))

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

// Never persist/display arbitrary upstream messages or codes: they can contain credentials or SQL details.
const bridgeErrorCodes = ['INVALID_INPUT', 'RANGE_TOO_WIDE', 'LIMIT_EXCEEDED', 'RATE_LIMITED', 'UNAUTHORIZED', 'FORBIDDEN_SCOPE', 'DB_UNAVAILABLE', 'QUERY_TIMEOUT', 'NOT_FOUND', 'INTERNAL'] as const
const errorBodySchema = z.object({ error: z.object({ code: z.enum(bridgeErrorCodes).optional() }) })
const bridgeErrorMessages: Partial<Record<typeof bridgeErrorCodes[number], string>> = {
  INVALID_INPUT: 'Nieprawidłowe parametry zapytania do mostka.',
  RANGE_TOO_WIDE: 'Zakres dat przekracza 24 miesiące. Wybierz krótszy okres.',
  LIMIT_EXCEEDED: 'Wynik przekracza limit wierszy mostka. Wybierz krótszy okres.',
  RATE_LIMITED: 'Przekroczono limit zapytań do mostka. Spróbuj ponownie później.',
}

export interface SubiektBridgeConfig {
  url: string
  token: string
  /** Cloudflare Access service token (both headers or none); null when the bridge is reached without Access. */
  access: { clientId: string; clientSecret: string } | null
}

type BridgeEnv = Record<string, string | undefined>

/**
 * null when the integration is not configured (both URL and token are required).
 * The Cloudflare Access pair is optional but must be complete: one header without the
 * other would be rejected by Access, so a half-set pair disables the integration.
 */
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
  const clientId = (env.SUBIEKT_BRIDGE_CF_ACCESS_CLIENT_ID ?? '').trim()
  const clientSecret = (env.SUBIEKT_BRIDGE_CF_ACCESS_CLIENT_SECRET ?? '').trim()
  if ((clientId === '') !== (clientSecret === '')) return null
  return { url, token, access: clientId ? { clientId, clientSecret } : null }
}

/** Request headers for the bridge: bearer token plus the Cloudflare Access service-token pair when configured. */
export function bridgeRequestHeaders(config: SubiektBridgeConfig): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${config.token}`, Accept: 'application/json' }
  if (config.access) {
    headers['CF-Access-Client-Id'] = config.access.clientId
    headers['CF-Access-Client-Secret'] = config.access.clientSecret
  }
  return headers
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface SalesSummaryQuery {
  from: string
  to: string
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

async function readErrorBody(response: Response): Promise<{ code: typeof bridgeErrorCodes[number] | null }> {
  try {
    const parsed = errorBodySchema.safeParse(await response.json())
    if (!parsed.success) return { code: null }
    return { code: parsed.data.error.code ?? null }
  } catch {
    return { code: null }
  }
}

async function bridgeGetJson(
  config: SubiektBridgeConfig | null,
  path: string,
  params: URLSearchParams,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<unknown> {
  if (!config) throw new SubiektBridgeError('not_configured', SUBIEKT_BRIDGE_MESSAGES.not_configured)
  const url = `${config.url}${path}?${params.toString()}`

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: bridgeRequestHeaders(config),
      // Access headers are custom headers and fetch may forward them across origins.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (error) {
    if (isAbortError(error)) throw new SubiektBridgeError('timeout', SUBIEKT_BRIDGE_MESSAGES.timeout)
    throw new SubiektBridgeError('unavailable', SUBIEKT_BRIDGE_MESSAGES.unavailable)
  }

  if (response.status === 401 || response.status === 403) {
    const body = await readErrorBody(response)
    if (config.access && !body.code) {
      throw new SubiektBridgeError('unauthorized', 'Dostęp do mostka został odrzucony. Sprawdź parę tokenów Cloudflare Access, jej ważność i politykę Service Auth, a następnie token mostka.')
    }
    throw new SubiektBridgeError('unauthorized', SUBIEKT_BRIDGE_MESSAGES.unauthorized, body.code)
  }
  if (response.status >= 500 && response.status <= 599) {
    const body = await readErrorBody(response)
    const message = response.status === 504 ? SUBIEKT_BRIDGE_MESSAGES.timeout : SUBIEKT_BRIDGE_MESSAGES.unavailable
    throw new SubiektBridgeError(response.status === 504 ? 'timeout' : 'unavailable', message, body.code)
  }
  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new SubiektBridgeError('bridge_error', (body.code && bridgeErrorMessages[body.code]) || SUBIEKT_BRIDGE_MESSAGES.bridge_error, body.code)
  }

  try {
    return await response.json()
  } catch {
    throw new SubiektBridgeError('invalid_response', SUBIEKT_BRIDGE_MESSAGES.invalid_response)
  }
}

function parseOrThrow<T extends z.ZodType>(schema: T, json: unknown): z.infer<T> {
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    // Server log only: field paths help diagnose a contract drift; values never leave the server.
    console.warn(JSON.stringify({ event: 'SUBIEKT_BRIDGE_INVALID_RESPONSE', issues: parsed.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }))
    throw new SubiektBridgeError('invalid_response', SUBIEKT_BRIDGE_MESSAGES.invalid_response)
  }
  return parsed.data
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
  if (!DATE_RE.test(query.from) || !DATE_RE.test(query.to)) {
    throw new SubiektBridgeError('bridge_error', 'Nieprawidłowy zakres dat zapytania do mostka.', 'INVALID_INPUT')
  }
  const params = new URLSearchParams({ from: query.from, to: query.to, group_by: 'month_warehouse_kind' })
  const data = parseOrThrow(salesSummarySchema, await bridgeGetJson(config, '/api/sales/summary', params, fetchImpl, timeoutMs))
  // The bridge's total comes from document headers; rows come from document positions.
  // Never replace the last valid snapshot with an inconsistent breakdown.
  for (const field of ['net_total', 'gross_total'] as const) {
    const total = data.total?.[field]
    if (total === undefined) continue
    const rowCents = data.rows.reduce((sum, row) => sum + Math.round(row[field] * 100), 0)
    if (Math.abs(rowCents - Math.round(total * 100)) > 1) {
      throw new SubiektBridgeError('invalid_response', 'Kwoty towarów i usług z mostka nie zgadzają się z sumą dokumentów. Poprzedni odczyt został zachowany. Wymagana jest weryfikacja mostka.', 'AMOUNT_MISMATCH')
    }
  }
  return data
}

const dateString = z.string().regex(DATE_RE)

export const purchaseDocumentSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(['FZ', 'KFZ']),
  number: z.string().min(1),
  original_number: z.string().nullable(),
  issued_at: dateString,
  parent_id: z.number().int().nullable(),
  supplier_name: z.string().nullable(),
  supplier_tax_id: z.string().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  exchange_rate: numericValue.nullable(),
  net_total: amount,
  gross_total: amount,
  ksef_number: z.string().nullable(),
  payable: amount.nullable(),
  remaining: amount.nullable(),
  is_paid: z.boolean().nullable(),
  due_date: dateString.nullable(),
})

export const purchaseDocumentsSchema = z.object({
  from: dateString,
  to: dateString,
  rows: z.array(purchaseDocumentSchema),
  truncated: z.boolean(),
  total: z.object({ documents: count }),
})

export type PurchaseDocument = z.infer<typeof purchaseDocumentSchema>
export const PURCHASE_PAGE_LIMIT = 500

/** FZ/KFZ issued in [from, to]. Never returns a truncated list: callers query month by month. */
export async function fetchPurchaseDocuments(
  config: SubiektBridgeConfig | null,
  query: SalesSummaryQuery,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SUBIEKT_BRIDGE_TIMEOUT_MS,
): Promise<z.infer<typeof purchaseDocumentsSchema>> {
  if (!DATE_RE.test(query.from) || !DATE_RE.test(query.to)) {
    throw new SubiektBridgeError('bridge_error', 'Nieprawidłowy zakres dat zapytania do mostka.', 'INVALID_INPUT')
  }
  const params = new URLSearchParams({ from: query.from, to: query.to, limit: String(PURCHASE_PAGE_LIMIT) })
  const data = parseOrThrow(purchaseDocumentsSchema, await bridgeGetJson(config, '/api/purchases/documents', params, fetchImpl, timeoutMs))
  if (data.truncated) {
    throw new SubiektBridgeError('invalid_response', `Subiekt zwrócił ponad ${PURCHASE_PAGE_LIMIT} faktur zakupu w okresie ${query.from} – ${query.to}. Import przerwany bez zmian.`, 'LIMIT_EXCEEDED')
  }
  return data
}

/** Message safe to show to an ADMIN; unknown errors never expose internals. */
export function describeSubiektBridgeError(error: unknown): string {
  if (error instanceof SubiektBridgeError) return error.message
  return 'Nie udało się odczytać danych z Subiekta.'
}
