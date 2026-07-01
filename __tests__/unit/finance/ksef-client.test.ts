import { generateKeyPairSync, privateDecrypt, constants } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildInvoiceMetadataQuery,
  chooseKsefTokenEncryptionCertificate,
  encryptKsefToken,
  getKsefBaseUrl,
  mapKsefMetadataToInvoice,
  KsefApiClient,
  KsefApiError,
  describeKsefApiError,
  publicKeyFromCertificateDerBase64,
} from '@/lib/finance/ksef-client'

describe('getKsefBaseUrl', () => {
  it('returns the official v2 API URL for each supported environment', () => {
    expect(getKsefBaseUrl('test')).toBe('https://api-test.ksef.mf.gov.pl/v2')
    expect(getKsefBaseUrl('demo')).toBe('https://api-demo.ksef.mf.gov.pl/v2')
    expect(getKsefBaseUrl('production')).toBe('https://api.ksef.mf.gov.pl/v2')
  })
})

describe('encryptKsefToken', () => {
  it('encrypts token and timestamp using RSA-OAEP SHA-256', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const encrypted = encryptKsefToken({
      token: 'ksef-token',
      timestampMs: 1782890000000,
      publicKey,
    })

    const decrypted = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encrypted, 'base64')
    ).toString('utf8')

    expect(decrypted).toBe('ksef-token|1782890000000')
  })
})

describe('publicKeyFromCertificateDerBase64', () => {
  it('extracts a public key from a DER base64 certificate', () => {
    const certificate =
      'MIIDFzCCAf+gAwIBAgIUJu2coy5KtZlshqUZT1NML0MNaeEwDQYJKoZIhvcNAQELBQAwGzEZMBcGA1UEAwwQa3NlZi1jbGllbnQtdGVzdDAeFw0yNjA3MDExMDU2MzhaFw0yNjA3MDIxMDU2MzhaMBsxGTAXBgNVBAMMEGtzZWYtY2xpZW50LXRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDijDtUH5UqVTb6jFq+kj48rhtjLAcv+3lZjJgNN0/w+B64ieH3V81Whs2qzTjzRczG9rGPcQKXwP7vOSU47ZJSx6CjUdTpAsTVQwyh+zvparKFCFPQhBUnhbebr23YLQ0+/NsSawA3mqctqTHMq9KwQmcZLWKN4gOpZv9iLj7xsQHPi8LTW6TAC86uQNzvRPTIiKeTaCiUks73c3MnX+n8hTT2GHdeoVqaHMyVcYiEaMEINQj30zq2oNFnUAYGZRYre3FakPL8i3ZcGJ8qxW0qEM66TjHvJVoRflPaHkaaOsGpeDyodpMwXeEr5e+uC4nfLlMpKR6Q4ncAxBSW6xvRAgMBAAGjUzBRMB0GA1UdDgQWBBRC5zn6A0qtYba4cWlNvbP/Er8e8TAfBgNVHSMEGDAWgBRC5zn6A0qtYba4cWlNvbP/Er8e8TAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBhFFG/R1DL5scNRoiqc9k9VT7lUX/fulMktCDeJgNxXr/pw9Q5r7Kb8Kfu8Ow+stzhhu74TtpBnScjXUt9OvPFdmfIRm875Mj051mHPP99kBuluY2vDzNg7LxFTOHMU5xfmqnMFSR0Ys5+HgTUQioifoNkkiTc6O4HlTkqfZId5U4WG1Kw+/UJvBoyZ0Y7xRrf/RfEoVjASBldBsRWKy9Qk2ESDOPggC3sX4soVJV51VrkCY8eOprGyz033EdxLCURL+IlFxtT6fQ2FsMTvNWaWPu09unJSwxxogvmeUFn7ekGX0SLqT4UJE0psSLxm3/G6Odjuxb0guLUh5qDa13x'

    expect(publicKeyFromCertificateDerBase64(certificate).type).toBe('public')
  })
})

describe('chooseKsefTokenEncryptionCertificate', () => {
  it('selects an active certificate for KSeF token encryption', () => {
    const selected = chooseKsefTokenEncryptionCertificate([
      {
        publicKeyId: 'sym',
        certificate: 'sym-cert',
        usage: ['SymmetricKeyEncryption'],
        validFrom: '2026-01-01T00:00:00Z',
        validTo: '2027-01-01T00:00:00Z',
      },
      {
        publicKeyId: 'token',
        certificate: 'token-cert',
        usage: ['KsefTokenEncryption'],
        validFrom: '2026-01-01T00:00:00Z',
        validTo: '2027-01-01T00:00:00Z',
      },
    ], new Date('2026-07-01T00:00:00Z'))

    expect(selected.publicKeyId).toBe('token')
  })
})

describe('buildInvoiceMetadataQuery', () => {
  it('queries purchase invoices for the company as buyer', () => {
    expect(buildInvoiceMetadataQuery('2026-07-01', '2026-07-31T23:59:59Z')).toEqual({
      subjectType: 'Subject2',
      dateRange: {
        dateType: 'Issue',
        from: '2026-07-01T00:00:00Z',
        to: '2026-07-31T23:59:59Z',
      },
    })
  })
})

describe('mapKsefMetadataToInvoice', () => {
  it('maps KSeF invoice metadata into the local invoice shape', () => {
    const invoice = mapKsefMetadataToInvoice({
      ksefNumber: '123-KSEF',
      invoiceNumber: 'FV/7/2026',
      issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Google Cloud Poland' },
      grossAmount: 123,
      netAmount: 100,
      vatAmount: 23,
      currency: 'PLN',
    })

    expect(invoice).toEqual({
      externalId: '123-KSEF',
      source: 'KSEF',
      supplierName: 'Google Cloud Poland',
      supplierNip: '5250007133',
      invoiceNumber: 'FV/7/2026',
      issueDate: new Date('2026-07-01T00:00:00.000Z'),
      grossAmount: 123,
      netAmount: 100,
      vatAmount: 23,
      currency: 'PLN',
      reportingGrossAmount: null,
      reportingNetAmount: null,
      reportingVatAmount: null,
      originalCurrency: null,
      originalGrossAmount: null,
      originalNetAmount: null,
      originalVatAmount: null,
      documentStatus: 'ACTIVE',
      dueDate: null,
      correctedKsefNumber: null,
      correctedInvoiceNumber: null,
    })
  })

  it('preserves original amounts and blocks PLN reporting amounts for foreign-currency metadata', () => {
    const invoice = mapKsefMetadataToInvoice({
      ksefNumber: 'EUR-KSEF',
      invoiceNumber: 'AWS/7/2026',
      issueDate: '2026-07-01',
      seller: { nip: 'IE6388047V', name: 'AWS EMEA SARL' },
      grossAmount: 100,
      netAmount: 100,
      vatAmount: 0,
      currency: 'EUR',
    })

    expect(invoice).toMatchObject({
      currency: 'EUR',
      grossAmount: 100,
      reportingGrossAmount: null,
      originalCurrency: 'EUR',
      originalGrossAmount: 100,
      originalNetAmount: 100,
      originalVatAmount: 0,
    })
  })

  it('maps correction and cancellation metadata to local document status', () => {
    const correction = mapKsefMetadataToInvoice({
      ksefNumber: 'COR-KSEF',
      invoiceNumber: 'KOR/7/2026',
      issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Google Cloud Poland' },
      grossAmount: -123,
      netAmount: -100,
      vatAmount: -23,
      currency: 'PLN',
      documentType: 'CORRECTION',
      correctedKsefNumber: 'ORIGINAL-KSEF',
      correctedInvoiceNumber: 'FV/6/2026',
    })

    const cancelled = mapKsefMetadataToInvoice({
      ksefNumber: 'CANCELLED-KSEF',
      invoiceNumber: 'FV/CANCELLED/2026',
      issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Google Cloud Poland' },
      grossAmount: 123,
      netAmount: 100,
      vatAmount: 23,
      currency: 'PLN',
      documentStatus: 'CANCELLED',
    })

    expect(correction).toMatchObject({
      documentStatus: 'CORRECTION',
      correctedKsefNumber: 'ORIGINAL-KSEF',
      correctedInvoiceNumber: 'FV/6/2026',
    })
    expect(cancelled.documentStatus).toBe('CANCELLED')
  })
})

describe('KsefApiClient', () => {
  it('formats KSeF API problem details for UI errors', () => {
    const error = new KsefApiError(429, JSON.stringify({
      title: 'Too Many Requests',
      status: 429,
      detail: 'Przekroczono limit 20 żądań na godzinę. Spróbuj ponownie po 33 minutach.',
    }))

    expect(describeKsefApiError(error)).toBe(
      'KSeF API 429: Przekroczono limit 20 żądań na godzinę. Spróbuj ponownie po 33 minutach.'
    )
  })

  it('downloads invoice XML by KSeF number with bearer access token', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<Faktura />', {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      })
    )
    const client = new KsefApiClient({ environment: 'test', fetchImpl })

    const xml = await client.downloadInvoiceXml({
      accessToken: 'access-token',
      ksefNumber: '123-KSEF/2026',
    })

    expect(xml).toBe('<Faktura />')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api-test.ksef.mf.gov.pl/v2/invoices/ksef/123-KSEF%2F2026',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          Accept: 'application/xml',
        }),
      })
    )
  })

  it('posts metadata query with bearer access token', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ invoices: [], hasMore: false, isTruncated: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )
    const client = new KsefApiClient({ environment: 'test', fetchImpl })

    await client.queryPurchaseInvoiceMetadata({
      accessToken: 'access-token',
      from: '2026-07-01',
      to: '2026-07-31T23:59:59Z',
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api-test.ksef.mf.gov.pl/v2/invoices/query/metadata?pageOffset=0&pageSize=250&sortOrder=Desc',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
        }),
      })
    )
  })
})
