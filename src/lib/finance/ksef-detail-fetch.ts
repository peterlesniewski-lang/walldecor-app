import {
  KsefApiClient,
  KsefApiError,
  dateFromKsefDate,
} from '@/lib/finance/ksef-client'
import { parseKsefInvoiceXmlDetails } from '@/lib/finance/ksef-xml-details'

// Full invoice XML (which carries the payment due date + bank account) must be
// downloaded per invoice. KSeF rate-limits aggressively, so we throttle between
// requests and back off exponentially on transient errors to avoid 429 storms
// that would otherwise silently leave hundreds of invoices without a due date.
export const XML_DETAILS_MAX_ATTEMPTS = 4
export const XML_DETAILS_THROTTLE_MS = process.env.NODE_ENV === 'test' ? 0 : 200
const RETRYABLE_XML_DETAIL_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export interface KsefInvoiceDetailResult {
  dueDate: Date | null
  bankAccount: string | null
  xml: string
}

export async function wait(ms: number) {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function xmlDetailsRetryDelayMs(attempt: number) {
  if (process.env.NODE_ENV === 'test') return 0
  // Exponential backoff with jitter: ~750ms, 1.5s, 3s.
  const base = 750 * 2 ** (attempt - 1)
  return base + Math.floor(Math.random() * 250)
}

export async function fetchKsefInvoiceDetail({
  client,
  accessToken,
  ksefNumber,
}: {
  client: KsefApiClient
  accessToken: string
  ksefNumber: string
}): Promise<KsefInvoiceDetailResult> {
  const xml = await client.downloadInvoiceXml({ accessToken, ksefNumber })
  const details = parseKsefInvoiceXmlDetails(xml)

  return {
    dueDate: dateFromKsefDate(details.paymentDueDate),
    bankAccount: details.bankAccounts[0] ?? null,
    xml,
  }
}

export async function fetchKsefInvoiceDetailWithRetry(args: {
  client: KsefApiClient
  accessToken: string
  ksefNumber: string
}): Promise<KsefInvoiceDetailResult> {
  let lastError: unknown

  for (let attempt = 1; attempt <= XML_DETAILS_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchKsefInvoiceDetail(args)
    } catch (err) {
      lastError = err
      const canRetry = err instanceof KsefApiError && RETRYABLE_XML_DETAIL_STATUSES.has(err.status)
      if (!canRetry || attempt === XML_DETAILS_MAX_ATTEMPTS) throw err
      await wait(xmlDetailsRetryDelayMs(attempt))
    }
  }

  throw lastError
}
