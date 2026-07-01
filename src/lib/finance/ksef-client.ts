import {
  X509Certificate,
  constants,
  publicEncrypt,
  type KeyLike,
} from 'crypto'
import { roundMoney } from '@/lib/finance/ksef-inbox'

export type KsefEnvironment = 'test' | 'demo' | 'production'

export interface KsefPublicKeyCertificate {
  certificate: string
  publicKeyId: string
  usage: string[]
  validFrom: string
  validTo: string
}

export interface KsefTokenInfo {
  token: string
  validUntil: string
}

export interface KsefChallengeResponse {
  challenge: string
  timestamp: string
  timestampMs: number
  clientIp: string
}

export interface KsefAuthInitResponse {
  referenceNumber: string
  authenticationToken: KsefTokenInfo
}

export interface KsefAuthStatusResponse {
  status: {
    code: number
    description: string
  }
}

export interface KsefAuthTokensResponse {
  accessToken: KsefTokenInfo
  refreshToken: KsefTokenInfo
}

export interface KsefInvoiceMetadata {
  ksefNumber: string
  invoiceNumber: string
  issueDate: string
  seller: {
    nip: string
    name?: string | null
  }
  grossAmount: number
  netAmount: number
  vatAmount: number
  currency: string
  paymentDueDate?: string | null
  dueDate?: string | null
  bankAccount?: string | null
  documentType?: string | null
  invoiceType?: string | null
  formType?: string | null
  documentStatus?: string | null
  status?: string | null
  correctedKsefNumber?: string | null
  correctedInvoiceNumber?: string | null
  correction?: {
    correctedKsefNumber?: string | null
    correctedInvoiceNumber?: string | null
  } | null
  correctedInvoice?: {
    ksefNumber?: string | null
    invoiceNumber?: string | null
  } | null
}

export interface KsefMetadataResponse {
  hasMore: boolean
  isTruncated: boolean
  invoices: KsefInvoiceMetadata[]
}

export class KsefApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`KSeF API error ${status}: ${body.slice(0, 500)}`)
    this.name = 'KsefApiError'
  }
}

export function describeKsefApiError(error: unknown) {
  if (!(error instanceof KsefApiError)) {
    return error instanceof Error ? error.message : 'Nieznany błąd KSeF.'
  }

  try {
    const parsed = JSON.parse(error.body) as {
      detail?: string
      title?: string
      errors?: Array<{ description?: string; details?: string[] }>
    }
    const validationDetails = parsed.errors
      ?.flatMap((entry) => [entry.description, ...(entry.details ?? [])])
      .filter(Boolean)
      .join(' ')
    const message = [parsed.detail, validationDetails].filter(Boolean).join(' ')
    return `KSeF API ${error.status}: ${message || parsed.title || 'Żądanie nie powiodło się.'}`
  } catch {
    return `KSeF API ${error.status}: ${error.body.slice(0, 500)}`
  }
}

export function getKsefBaseUrl(environment: KsefEnvironment) {
  if (environment === 'production') return 'https://api.ksef.mf.gov.pl/v2'
  if (environment === 'demo') return 'https://api-demo.ksef.mf.gov.pl/v2'
  return 'https://api-test.ksef.mf.gov.pl/v2'
}

export function encryptKsefToken({
  token,
  timestampMs,
  publicKey,
}: {
  token: string
  timestampMs: number
  publicKey: KeyLike
}) {
  return publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(`${token}|${timestampMs}`, 'utf8')
  ).toString('base64')
}

export function publicKeyFromCertificateDerBase64(certificate: string) {
  const x509 = new X509Certificate(Buffer.from(certificate, 'base64'))
  return x509.publicKey
}

export function chooseKsefTokenEncryptionCertificate(
  certificates: KsefPublicKeyCertificate[],
  now = new Date()
) {
  const selected = certificates.find((certificate) => {
    const validFrom = new Date(certificate.validFrom)
    const validTo = new Date(certificate.validTo)
    return (
      certificate.usage.includes('KsefTokenEncryption') &&
      validFrom.getTime() <= now.getTime() &&
      validTo.getTime() > now.getTime()
    )
  })

  if (!selected) {
    throw new Error('Brak aktywnego certyfikatu MF do szyfrowania tokena KSeF.')
  }

  return selected
}

function toKsefStartDate(value: string) {
  return value.includes('T') ? value : `${value}T00:00:00Z`
}

export function buildInvoiceMetadataQuery(from: string, to?: string) {
  return {
    subjectType: 'Subject2',
    dateRange: {
      dateType: 'Issue',
      from: toKsefStartDate(from),
      ...(to ? { to } : {}),
    },
  }
}

export type KsefLocalDocumentStatus = 'ACTIVE' | 'CORRECTED' | 'CORRECTION' | 'CANCELLED'

function normalizeCurrency(currency: string | null | undefined) {
  return (currency || 'PLN').trim().toUpperCase()
}

function normalizeMetadataLabel(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase()
}

function documentStatusFromMetadata(metadata: KsefInvoiceMetadata): KsefLocalDocumentStatus {
  const rawStatus = normalizeMetadataLabel(metadata.documentStatus ?? metadata.status)
  const rawType = normalizeMetadataLabel(metadata.documentType ?? metadata.invoiceType ?? metadata.formType)
  const hasCorrectionReference = Boolean(
    metadata.correctedKsefNumber ||
    metadata.correctedInvoiceNumber ||
    metadata.correction?.correctedKsefNumber ||
    metadata.correction?.correctedInvoiceNumber ||
    metadata.correctedInvoice?.ksefNumber ||
    metadata.correctedInvoice?.invoiceNumber
  )

  if (
    rawStatus.includes('CANCEL') ||
    rawStatus.includes('ANUL') ||
    rawStatus.includes('INVALID') ||
    rawStatus.includes('UNVALID')
  ) {
    return 'CANCELLED'
  }

  if (
    rawType.includes('CORRECTION') ||
    rawType.includes('KOREKT') ||
    rawType === 'KOR' ||
    hasCorrectionReference
  ) {
    return 'CORRECTION'
  }

  if (rawStatus.includes('CORRECTED') || rawStatus.includes('SKORYG')) {
    return 'CORRECTED'
  }

  return 'ACTIVE'
}

export function dateFromKsefDate(value: string | null | undefined) {
  const dateValue = value?.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0]
  if (!dateValue) return null

  const date = new Date(`${dateValue}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function mapKsefMetadataToInvoice(metadata: KsefInvoiceMetadata) {
  const currency = normalizeCurrency(metadata.currency)
  const isForeignCurrency = currency !== 'PLN'

  return {
    externalId: metadata.ksefNumber,
    source: 'KSEF',
    supplierName: metadata.seller.name || metadata.seller.nip,
    supplierNip: metadata.seller.nip,
    invoiceNumber: metadata.invoiceNumber,
    issueDate: new Date(`${metadata.issueDate}T00:00:00.000Z`),
    grossAmount: roundMoney(metadata.grossAmount),
    netAmount: roundMoney(metadata.netAmount),
    vatAmount: roundMoney(metadata.vatAmount),
    currency,
    reportingGrossAmount: null,
    reportingNetAmount: null,
    reportingVatAmount: null,
    originalCurrency: isForeignCurrency ? currency : null,
    originalGrossAmount: isForeignCurrency ? roundMoney(metadata.grossAmount) : null,
    originalNetAmount: isForeignCurrency ? roundMoney(metadata.netAmount) : null,
    originalVatAmount: isForeignCurrency ? roundMoney(metadata.vatAmount) : null,
    documentStatus: documentStatusFromMetadata(metadata),
    dueDate: dateFromKsefDate(metadata.paymentDueDate ?? metadata.dueDate),
    bankAccount: metadata.bankAccount ?? null,
    correctedKsefNumber:
      metadata.correctedKsefNumber ??
      metadata.correction?.correctedKsefNumber ??
      metadata.correctedInvoice?.ksefNumber ??
      null,
    correctedInvoiceNumber:
      metadata.correctedInvoiceNumber ??
      metadata.correction?.correctedInvoiceNumber ??
      metadata.correctedInvoice?.invoiceNumber ??
      null,
  }
}

interface KsefApiClientOptions {
  environment: KsefEnvironment
  fetchImpl?: typeof fetch
}

export class KsefApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor({ environment, fetchImpl = fetch }: KsefApiClientOptions) {
    this.baseUrl = getKsefBaseUrl(environment)
    this.fetchImpl = fetchImpl
  }

  private async requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'X-Error-Format': 'problem-details',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new KsefApiError(response.status, text)
    }

    return response.json() as Promise<T>
  }

  private async requestText(path: string, init: RequestInit = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/xml',
        'X-Error-Format': 'problem-details',
        ...(init.headers ?? {}),
      },
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new KsefApiError(response.status, text)
    }

    return response.text()
  }

  async getChallenge() {
    return this.requestJson<KsefChallengeResponse>('/auth/challenge', {
      method: 'POST',
    })
  }

  async getPublicKeyCertificates() {
    return this.requestJson<KsefPublicKeyCertificate[]>('/security/public-key-certificates')
  }

  async authenticateWithToken({ companyNip, token }: { companyNip: string; token: string }) {
    const [challenge, certificates] = await Promise.all([
      this.getChallenge(),
      this.getPublicKeyCertificates(),
    ])
    const certificate = chooseKsefTokenEncryptionCertificate(certificates)
    const encryptedToken = encryptKsefToken({
      token,
      timestampMs: challenge.timestampMs,
      publicKey: publicKeyFromCertificateDerBase64(certificate.certificate),
    })

    const init = await this.requestJson<KsefAuthInitResponse>('/auth/ksef-token', {
      method: 'POST',
      body: JSON.stringify({
        challenge: challenge.challenge,
        contextIdentifier: {
          type: 'Nip',
          value: companyNip,
        },
        encryptedToken,
        publicKeyId: certificate.publicKeyId,
      }),
    })

    const status = await this.waitForAuthentication(init)
    if (status.status.code !== 200) {
      throw new Error(`KSeF auth failed: ${status.status.code} ${status.status.description}`)
    }

    return this.requestJson<KsefAuthTokensResponse>('/auth/token/redeem', {
      method: 'POST',
      headers: { Authorization: `Bearer ${init.authenticationToken.token}` },
    })
  }

  private async waitForAuthentication(init: KsefAuthInitResponse) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const status = await this.requestJson<KsefAuthStatusResponse>(`/auth/${init.referenceNumber}`, {
        headers: { Authorization: `Bearer ${init.authenticationToken.token}` },
      })
      if (status.status.code !== 100) return status
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
    throw new Error('KSeF auth timeout: uwierzytelnianie nadal w toku.')
  }

  async queryPurchaseInvoiceMetadata({
    accessToken,
    from,
    to,
    pageOffset = 0,
    pageSize = 250,
  }: {
    accessToken: string
    from: string
    to?: string
    pageOffset?: number
    pageSize?: number
  }) {
    const query = new URLSearchParams({
      pageOffset: String(pageOffset),
      pageSize: String(pageSize),
      sortOrder: 'Desc',
    })
    return this.requestJson<KsefMetadataResponse>(`/invoices/query/metadata?${query.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(buildInvoiceMetadataQuery(from, to)),
    })
  }

  async downloadInvoiceXml({
    accessToken,
    ksefNumber,
  }: {
    accessToken: string
    ksefNumber: string
  }) {
    return this.requestText(`/invoices/ksef/${encodeURIComponent(ksefNumber)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  }
}
