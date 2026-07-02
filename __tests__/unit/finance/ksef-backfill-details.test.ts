import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/finance/ksef/invoices/backfill-details/route'

const prismaMock = vi.hoisted(() => ({
  appSetting: { findMany: vi.fn() },
  ksefInvoice: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
}))

const ksefClientMock = vi.hoisted(() => ({
  authenticateWithToken: vi.fn(),
  downloadInvoiceXml: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(async () => ({ session: { user: { id: 'admin', role: 'ADMIN' } } })),
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

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/finance/ksef/invoices/backfill-details', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]
}

const XML_WITH_TERM = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Fa><Platnosc><TerminPlatnosci><Termin>2026-07-21</Termin></TerminPlatnosci></Platnosc></Fa>
</Faktura>`

describe('POST /api/finance/ksef/invoices/backfill-details', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.appSetting.findMany.mockResolvedValue([
      { key: 'ksef_enabled', value: 'true' },
      { key: 'ksef_environment', value: 'test' },
      { key: 'ksef_company_nip', value: '5210000000' },
      { key: 'ksef_token', value: 'token' },
    ])
    prismaMock.ksefInvoice.update.mockResolvedValue({})
    prismaMock.ksefInvoice.count.mockResolvedValue(0)
    ksefClientMock.authenticateWithToken.mockResolvedValue({
      accessToken: { token: 'access-token', validUntil: '2026-07-01T12:00:00Z' },
    })
  })

  it('blocks when KSeF integration is disabled', async () => {
    prismaMock.appSetting.findMany.mockResolvedValue([{ key: 'ksef_enabled', value: 'false' }])

    const response = await POST(makeRequest({}))

    expect(response.status).toBe(400)
    expect(ksefClientMock.authenticateWithToken).not.toHaveBeenCalled()
  })

  it('re-downloads XML for due-date-less invoices and fills the due date', async () => {
    prismaMock.ksefInvoice.findMany.mockResolvedValue([
      { id: 'inv-1', externalId: 'KSEF-1', issueDate: new Date('2026-07-01T00:00:00.000Z'), bankAccount: null },
    ])
    ksefClientMock.downloadInvoiceXml.mockResolvedValue(XML_WITH_TERM)

    const response = await POST(makeRequest({}))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ scanned: 1, updated: 1, failed: 0, done: true })
    expect(prismaMock.ksefInvoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: expect.objectContaining({
        dueDate: new Date('2026-07-21T00:00:00.000Z'),
        xmlContent: expect.stringContaining('<Faktura'),
        xmlFetchedAt: expect.any(Date),
      }),
    })
  })

  it('marks an invoice paid when KSeF confirms it has no payment term', async () => {
    prismaMock.ksefInvoice.findMany.mockResolvedValue([
      { id: 'inv-2', externalId: 'KSEF-2', issueDate: new Date('2026-06-10T00:00:00.000Z'), bankAccount: null },
    ])
    // XML with no <TerminPlatnosci> at all.
    ksefClientMock.downloadInvoiceXml.mockResolvedValue(
      '<?xml version="1.0"?><Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/"><Fa></Fa></Faktura>'
    )

    const response = await POST(makeRequest({}))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ scanned: 1, updated: 0, markedPaid: 1, failed: 0 })
    expect(prismaMock.ksefInvoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-2' },
      data: expect.objectContaining({
        paymentStatus: 'PAID',
        paidAt: new Date('2026-06-10T00:00:00.000Z'),
        xmlContent: expect.stringContaining('<Faktura'),
        xmlFetchedAt: expect.any(Date),
      }),
    })
  })

  it('reports done=false and a nextBefore cursor when a full batch is returned', async () => {
    prismaMock.ksefInvoice.findMany.mockResolvedValue([
      { id: 'inv-1', externalId: 'KSEF-1', issueDate: new Date('2026-07-05T00:00:00.000Z'), bankAccount: null },
    ])
    ksefClientMock.downloadInvoiceXml.mockResolvedValue(XML_WITH_TERM)

    const response = await POST(makeRequest({ limit: 1 }))
    const body = await response.json()

    expect(body.done).toBe(false)
    expect(body.nextBefore).toBe('2026-07-05T00:00:00.000Z')
  })

  it('counts a failed XML download without throwing', async () => {
    prismaMock.ksefInvoice.findMany.mockResolvedValue([
      { id: 'inv-1', externalId: 'KSEF-1', issueDate: new Date('2026-07-01T00:00:00.000Z'), bankAccount: null },
    ])
    ksefClientMock.downloadInvoiceXml.mockRejectedValue(new Error('network down'))

    const response = await POST(makeRequest({}))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ scanned: 1, updated: 0, failed: 1 })
    expect(prismaMock.ksefInvoice.update).not.toHaveBeenCalled()
  })
})
