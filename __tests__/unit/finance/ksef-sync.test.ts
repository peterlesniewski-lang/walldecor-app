import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/finance/ksef/sync/route'
import { KsefApiError } from '@/lib/finance/ksef-client'

const prismaMock = vi.hoisted(() => ({
  appSetting: {
    findMany: vi.fn(),
  },
  ksefSupplierRule: {
    findMany: vi.fn(),
  },
  ksefInvoice: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

const ksefClientMock = vi.hoisted(() => ({
  authenticateWithToken: vi.fn(),
  queryPurchaseInvoiceMetadata: vi.fn(),
  downloadInvoiceXml: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(async () => ({ session: { user: { id: 'admin', role: 'ADMIN' } } })),
}))

vi.mock('@/lib/finance/ksef-rule-application', () => ({
  applySupplierRulesToNewInvoices: vi.fn().mockResolvedValue(0),
}))

vi.mock('@/lib/finance/ksef-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/finance/ksef-client')>()
  return {
    ...actual,
    KsefApiClient: vi.fn(function KsefApiClient() {
      return ksefClientMock
    }),
  }
})

describe('POST /api/finance/ksef/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.appSetting.findMany.mockResolvedValue([
      { key: 'ksef_enabled', value: 'true' },
      { key: 'ksef_environment', value: 'test' },
      { key: 'ksef_company_nip', value: '5210000000' },
      { key: 'ksef_token', value: 'token' },
      { key: 'ksef_sync_from', value: '2026-07-01' },
    ])
    prismaMock.ksefSupplierRule.findMany.mockResolvedValue([])
    prismaMock.ksefInvoice.findUnique.mockResolvedValue(null)
    prismaMock.ksefInvoice.findFirst.mockResolvedValue(null)
    prismaMock.ksefInvoice.create.mockResolvedValue({})
    prismaMock.ksefInvoice.update.mockResolvedValue({})
    ksefClientMock.authenticateWithToken.mockResolvedValue({
      accessToken: { token: 'access-token', validUntil: '2026-07-01T12:00:00Z' },
    })
  })

  it('enriches imported metadata with payment due date and bank account from invoice XML', async () => {
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({
      hasMore: false,
      isTruncated: false,
      invoices: [
        {
          ksefNumber: 'KSEF-XML-1',
          invoiceNumber: 'FV/7/2026',
          issueDate: '2026-07-01',
          seller: { nip: '5250007133', name: 'Dostawca Testowy' },
          grossAmount: 123,
          netAmount: 100,
          vatAmount: 23,
          currency: 'PLN',
        },
      ],
    })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Fa>
    <Platnosc>
      <TerminPlatnosci>
        <Termin>2026-07-21</Termin>
      </TerminPlatnosci>
      <RachunekBankowy>
        <NrRB>12 3456 7890 1234 5678 9012 3456</NrRB>
      </RachunekBankowy>
    </Platnosc>
  </Fa>
</Faktura>`)

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ imported: 1, xmlDetailsFetched: 1, xmlDetailsFailed: 0 })
    expect(ksefClientMock.downloadInvoiceXml).toHaveBeenCalledWith({
      accessToken: 'access-token',
      ksefNumber: 'KSEF-XML-1',
    })
    expect(prismaMock.ksefInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: 'KSEF-XML-1',
        dueDate: new Date('2026-07-21T00:00:00.000Z'),
        bankAccount: '12345678901234567890123456',
        paymentDetailsFetchedAt: expect.any(Date),
        xmlContent: expect.stringContaining('<Faktura'),
        xmlFetchedAt: expect.any(Date),
      }),
    })
  })

  it('retries transient XML detail failures before importing the invoice', async () => {
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({
      hasMore: false,
      isTruncated: false,
      invoices: [
        {
          ksefNumber: 'KSEF-XML-RETRY',
          invoiceNumber: 'FV/8/2026',
          issueDate: '2026-07-02',
          seller: { nip: '5250007133', name: 'Dostawca Testowy' },
          grossAmount: 246,
          netAmount: 200,
          vatAmount: 46,
          currency: 'PLN',
        },
      ],
    })
    ksefClientMock.downloadInvoiceXml
      .mockRejectedValueOnce(new KsefApiError(429, '{"detail":"Too Many Requests"}'))
      .mockResolvedValueOnce(`<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Fa>
    <Platnosc>
      <TerminPlatnosci>
        <Termin>2026-07-22</Termin>
      </TerminPlatnosci>
      <RachunekBankowy>
        <NrRB>12 3456 7890 1234 5678 9012 3456</NrRB>
      </RachunekBankowy>
    </Platnosc>
  </Fa>
</Faktura>`)

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ imported: 1, xmlDetailsFetched: 1, xmlDetailsFailed: 0 })
    expect(ksefClientMock.downloadInvoiceXml).toHaveBeenCalledTimes(2)
    expect(prismaMock.ksefInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: 'KSEF-XML-RETRY',
        dueDate: new Date('2026-07-22T00:00:00.000Z'),
        bankAccount: '12345678901234567890123456',
        paymentDetailsFetchedAt: expect.any(Date),
        xmlContent: expect.stringContaining('<Faktura'),
        xmlFetchedAt: expect.any(Date),
      }),
    })
  })

  it('does not download full XML again when existing invoice already has payment details', async () => {
    prismaMock.ksefInvoice.findUnique.mockResolvedValue({
      id: 'invoice-existing',
      externalId: 'KSEF-EXISTING',
      dueDate: new Date('2026-07-21T00:00:00.000Z'),
      bankAccount: '12345678901234567890123456',
      reportingGrossAmount: null,
      reportingNetAmount: null,
      reportingVatAmount: null,
      status: 'MAPPED',
    })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({
      hasMore: false,
      isTruncated: false,
      invoices: [
        {
          ksefNumber: 'KSEF-EXISTING',
          invoiceNumber: 'FV/9/2026',
          issueDate: '2026-07-03',
          seller: { nip: '5250007133', name: 'Dostawca Testowy' },
          grossAmount: 369,
          netAmount: 300,
          vatAmount: 69,
          currency: 'PLN',
        },
      ],
    })

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ updated: 1, xmlDetailsFetched: 0, xmlDetailsFailed: 0 })
    expect(ksefClientMock.downloadInvoiceXml).not.toHaveBeenCalled()
    expect(prismaMock.ksefInvoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-existing' },
      data: expect.objectContaining({
        dueDate: new Date('2026-07-21T00:00:00.000Z'),
        bankAccount: '12345678901234567890123456',
      }),
    })
  })

  it('does not download full XML again when payment details were already checked', async () => {
    prismaMock.ksefInvoice.findUnique.mockResolvedValue({
      id: 'invoice-checked',
      externalId: 'KSEF-CHECKED',
      dueDate: new Date('2026-07-23T00:00:00.000Z'),
      bankAccount: null,
      paymentDetailsFetchedAt: new Date('2026-07-04T10:00:00.000Z'),
      reportingGrossAmount: null,
      reportingNetAmount: null,
      reportingVatAmount: null,
      status: 'MAPPED',
    })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({
      hasMore: false,
      isTruncated: false,
      invoices: [
        {
          ksefNumber: 'KSEF-CHECKED',
          invoiceNumber: 'FV/10/2026',
          issueDate: '2026-07-04',
          seller: { nip: '5250007133', name: 'Dostawca Testowy' },
          grossAmount: 492,
          netAmount: 400,
          vatAmount: 92,
          currency: 'PLN',
        },
      ],
    })

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ updated: 1, xmlDetailsFetched: 0, xmlDetailsFailed: 0 })
    expect(ksefClientMock.downloadInvoiceXml).not.toHaveBeenCalled()
  })

  it('marks imported invoice as paid when fetched XML confirms missing payment due date', async () => {
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({
      hasMore: false,
      isTruncated: false,
      invoices: [
        {
          ksefNumber: 'KSEF-NO-DUE',
          invoiceNumber: 'FV/11/2026',
          issueDate: '2026-07-05',
          seller: { nip: '5250007133', name: 'Dostawca Testowy' },
          grossAmount: 615,
          netAmount: 500,
          vatAmount: 115,
          currency: 'PLN',
        },
      ],
    })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue(`<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Fa>
    <Platnosc />
  </Fa>
</Faktura>`)

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ imported: 1, xmlDetailsFetched: 1, xmlDetailsFailed: 0 })
    expect(prismaMock.ksefInvoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: 'KSEF-NO-DUE',
        paymentStatus: 'PAID',
        paidAt: new Date('2026-07-05T00:00:00.000Z'),
        paymentDetailsFetchedAt: expect.any(Date),
        xmlContent: expect.stringContaining('<Faktura'),
        xmlFetchedAt: expect.any(Date),
      }),
    })
  })
})
