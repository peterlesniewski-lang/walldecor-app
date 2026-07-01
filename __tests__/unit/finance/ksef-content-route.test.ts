import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/finance/ksef/invoices/[id]/content/route'

const prismaMock = vi.hoisted(() => ({
  appSetting: {
    findMany: vi.fn(),
  },
  ksefInvoice: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

const ksefClientMock = vi.hoisted(() => ({
  authenticateWithToken: vi.fn(),
  downloadInvoiceXml: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

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

describe('GET /api/finance/ksef/invoices/[id]/content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.ksefInvoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      externalId: 'KSEF-1',
      dueDate: null,
      bankAccount: null,
    })
    prismaMock.ksefInvoice.update.mockResolvedValue({
      id: 'invoice-1',
      externalId: 'KSEF-1',
      dueDate: new Date('2026-07-21T00:00:00.000Z'),
      bankAccount: '12345678901234567890123456',
    })
    prismaMock.appSetting.findMany.mockResolvedValue([
      { key: 'ksef_enabled', value: 'true' },
      { key: 'ksef_environment', value: 'test' },
      { key: 'ksef_company_nip', value: '5210000000' },
      { key: 'ksef_token', value: 'token' },
    ])
    ksefClientMock.authenticateWithToken.mockResolvedValue({
      accessToken: { token: 'access-token', validUntil: '2026-07-01T12:00:00Z' },
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
  })

  it('persists payment due date and bank account parsed from invoice XML', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'invoice-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(prismaMock.ksefInvoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-1' },
      data: {
        dueDate: new Date('2026-07-21T00:00:00.000Z'),
        bankAccount: '12345678901234567890123456',
      },
    })
    expect(body.invoice).toMatchObject({
      id: 'invoice-1',
      dueDate: '2026-07-21T00:00:00.000Z',
      bankAccount: '12345678901234567890123456',
    })
  })
})
