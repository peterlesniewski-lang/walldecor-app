import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/finance/ksef/sync/route'
import { KsefApiError } from '@/lib/finance/ksef-client'
import { applySupplierRulesToNewInvoices } from '@/lib/finance/ksef-rule-application'
import { withAiQueueMutation } from '@/lib/ai/queue'

const transactionMarker = vi.hoisted(() => ({ writerTransaction: true }))
const writerState = vi.hoisted(() => ({ depth: 0, retryFirstWrite: false }))
const reconciliationMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/invoice-import/ksef-reconciliation-service', () => ({ reconcileImportedKsefInvoice: reconciliationMock }))
vi.mock('@/lib/ai/queue', () => ({
  withAiQueueMutation: vi.fn(async (_db, _clock, operation) => {
    writerState.depth += 1
    try {
      if (writerState.retryFirstWrite) {
        writerState.retryFirstWrite = false
        await operation(transactionMarker, {}, new Date())
      }
      return await operation(transactionMarker, {}, new Date())
    } finally { writerState.depth -= 1 }
  }),
}))

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  invoiceImportDraft: { findUnique: vi.fn() },
  invoiceKsefReconciliation: { findUnique: vi.fn() },
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
    writerState.depth = 0
    writerState.retryFirstWrite = false
    Object.assign(transactionMarker, prismaMock)
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN', isActive: true, mustChangePassword: false })
    prismaMock.invoiceImportDraft.findUnique.mockResolvedValue(null)
    prismaMock.invoiceKsefReconciliation.findUnique.mockResolvedValue(null)
    reconciliationMock.mockResolvedValue({ outcome: 'NOT_MATCHED' })
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
    ksefClientMock.downloadInvoiceXml.mockReset().mockResolvedValue('<Faktura />')
  })

  it('keeps the complete supplier-rule pass inside the shared writer transaction', async () => {
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [] })
    const response = await POST()
    expect(response.status).toBe(200)
    expect(withAiQueueMutation).toHaveBeenCalledWith(prismaMock, expect.any(Function), expect.any(Function))
    expect(applySupplierRulesToNewInvoices).toHaveBeenCalledWith(transactionMarker, [])
  })

  it.each([{ currency: 123 }, { issueDate: 'not-a-date' }, { seller: null }, { ksefNumber: null }])(
    'rejects malformed raw metadata before legacy mapping or invoice/cache reads (%j)', async (invalid) => {
      ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
        ksefNumber: 'KSEF-INVALID', invoiceNumber: 'INVALID/01', issueDate: '2026-07-01',
        seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23,
        currency: 'PLN', ...invalid,
      }] })
      const response = await POST()
      expect(response.status).toBe(422)
      expect(await response.json()).toMatchObject({ code: 'INVALID_KSEF_SNAPSHOT' })
      expect(prismaMock.ksefInvoice.findUnique).not.toHaveBeenCalled()
      expect(prismaMock.ksefInvoice.findFirst).not.toHaveBeenCalled()
      expect(prismaMock.invoiceKsefReconciliation.findUnique).not.toHaveBeenCalled()
      expect(ksefClientMock.downloadInvoiceXml).not.toHaveBeenCalled()
      expect(withAiQueueMutation).not.toHaveBeenCalled()
    },
  )

  it('re-reads each invoice and creates it only inside the writer reservation', async () => {
    const reads: number[] = []
    const writes: number[] = []
    prismaMock.ksefInvoice.findUnique.mockImplementation(async () => { reads.push(writerState.depth); return null })
    prismaMock.ksefInvoice.create.mockImplementation(async () => { writes.push(writerState.depth); return {} })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
      ksefNumber: 'KSEF-RESERVATION', invoiceNumber: 'RESERVATION/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
    }] })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue('<Faktura />')

    expect((await POST()).status).toBe(200)
    expect(writes).toEqual([1])
    expect(reads).toEqual([0, 1])
  })

  it('counts one committed invoice when its writer callback is retried', async () => {
    writerState.retryFirstWrite = true
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
      ksefNumber: 'KSEF-WRITE-RETRY', invoiceNumber: 'WRITE-RETRY/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
    }] })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue('<Faktura />')

    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ imported: 1, updated: 0 })
    expect(prismaMock.ksefInvoice.create).toHaveBeenCalledTimes(2)
  })

  it.each(['OPEN', 'APPROVED', 'ARCHIVED'])('rejects a legacy update of a permanently linked %s import inside the transaction', async (state) => {
    const guardReads: number[] = []
    prismaMock.ksefInvoice.findUnique.mockResolvedValue({
      id: 'invoice-imported', externalId: null, dueDate: null, bankAccount: null,
      reportingGrossAmount: 123, reportingNetAmount: 100, reportingVatAmount: 23, status: 'MAPPED',
    })
    prismaMock.invoiceImportDraft.findUnique.mockImplementation(async () => {
      guardReads.push(writerState.depth)
      return { id: `draft-${state}`, state }
    })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
      ksefNumber: 'KSEF-IMPORTED', invoiceNumber: 'IMPORTED/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 999, netAmount: 800, vatAmount: 199, currency: 'PLN',
    }] })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue('<Faktura />')

    const response = await POST()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'INVOICE_IMPORT_REVIEW_REQUIRED', draftId: `draft-${state}` })
    expect(guardReads).toEqual([1])
    expect(prismaMock.ksefInvoice.update).not.toHaveBeenCalled()
    expect(prismaMock.ksefInvoice.create).not.toHaveBeenCalled()
    expect(applySupplierRulesToNewInvoices).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { role: 'MANAGER', isActive: true, mustChangePassword: false },
    { role: 'ADMIN', isActive: false, mustChangePassword: false },
    { role: 'ADMIN', isActive: true, mustChangePassword: true },
  ])('denies stale admin sessions before reading credentials or contacting KSeF %#', async (user) => {
    prismaMock.user.findUnique.mockResolvedValue(user)
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [] })

    expect((await POST()).status).toBe(403)
    expect(prismaMock.appSetting.findMany).not.toHaveBeenCalled()
    expect(ksefClientMock.authenticateWithToken).not.toHaveBeenCalled()
    expect(withAiQueueMutation).not.toHaveBeenCalled()
  })

  it.each([false, true])('rechecks ADMIN before %s invoice writes and the final rule pass', async (hasInvoice) => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ role: 'ADMIN', isActive: true, mustChangePassword: false })
      .mockResolvedValue({ role: 'ADMIN', isActive: false, mustChangePassword: false })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: hasInvoice ? [{
      ksefNumber: 'KSEF-REVOKED-ADMIN', invoiceNumber: 'REVOKED-ADMIN/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
    }] : [] })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue('<Faktura />')

    expect((await POST()).status).toBe(403)
    expect(prismaMock.ksefInvoice.update).not.toHaveBeenCalled()
    expect(prismaMock.ksefInvoice.create).not.toHaveBeenCalled()
    expect(applySupplierRulesToNewInvoices).not.toHaveBeenCalled()
  })

  it.each(['MATCHED', 'CONFLICT'])('intercepts a %s imported document before any legacy invoice write', async (status) => {
    const incoming = {
      ksefNumber: 'KSEF-LINK', invoiceNumber: 'LINK/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23,
      currency: 'PLN', dueDate: '2026-07-20', bankAccount: '12345678901234567890123456',
    }
    const xml = '<Faktura><Fa><Platnosc><Zaplacono>1</Zaplacono></Platnosc></Fa></Faktura>'
    const reconciliationDepths: number[] = []
    reconciliationMock.mockImplementation(async () => {
      reconciliationDepths.push(writerState.depth)
      return { outcome: 'LINKED', draftId: 'draft-linked', linkId: 'link-1', status, changed: true }
    })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [incoming] })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue(xml)

    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ imported: 0, updated: 0, linked: 1, conflicts: status === 'CONFLICT' ? 1 : 0 })
    expect(reconciliationDepths).toEqual([1])
    expect(reconciliationMock).toHaveBeenCalledWith(transactionMarker, 'admin', incoming, xml, expect.any(Date))
    expect(ksefClientMock.downloadInvoiceXml).toHaveBeenCalledTimes(1)
    expect(prismaMock.ksefInvoice.create).not.toHaveBeenCalled()
    expect(prismaMock.ksefInvoice.update).not.toHaveBeenCalled()
  })

  it.each(['observation', 'same-external-invoice'])('reuses %s XML when the network download is skipped', async (cache) => {
    const xml = '<Faktura><Fa><Platnosc><Zaplacono>1</Zaplacono></Platnosc></Fa></Faktura>'
    if (cache === 'observation') prismaMock.invoiceKsefReconciliation.findUnique.mockResolvedValue({ xmlContent: xml })
    else prismaMock.ksefInvoice.findUnique.mockResolvedValue({
      id: 'cached-invoice', externalId: 'KSEF-CACHED-LINK', dueDate: null, bankAccount: null,
      xmlContent: xml, paymentDetailsFetchedAt: new Date(), status: 'MAPPED',
    })
    reconciliationMock.mockResolvedValue({ outcome: 'LINKED', draftId: 'draft-cached', linkId: 'link-1', status: 'MATCHED', changed: false })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
      ksefNumber: 'KSEF-CACHED-LINK', invoiceNumber: 'CACHED-LINK/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
    }] })

    expect((await POST()).status).toBe(200)
    expect(ksefClientMock.downloadInvoiceXml).not.toHaveBeenCalled()
    expect(reconciliationMock).toHaveBeenCalledWith(transactionMarker, 'admin', expect.any(Object), xml, expect.any(Date))
    expect(prismaMock.ksefInvoice.update).not.toHaveBeenCalled()
  })

  it('does not reuse another KSeF number\'s XML for a naturally matched imported invoice', async () => {
    prismaMock.ksefInvoice.findUnique.mockResolvedValue(null)
    prismaMock.ksefInvoice.findFirst.mockResolvedValue({
      id: 'cached-other', externalId: 'KSEF-OLD-NUMBER', dueDate: null, bankAccount: null,
      xmlContent: '<Faktura><Fa><Platnosc><Zaplacono>1</Zaplacono></Platnosc></Fa></Faktura>',
      paymentDetailsFetchedAt: new Date(), invoiceImportDraft: { id: 'draft-natural' }, status: 'MAPPED',
    })
    reconciliationMock.mockResolvedValue({ outcome: 'LINKED', draftId: 'draft-natural', linkId: 'link-new', status: 'MATCHED', changed: true })
    const incomingXml = '<Faktura><Fa><Platnosc><ZnacznikZaplatyCzesciowej>1</ZnacznikZaplatyCzesciowej></Platnosc></Fa></Faktura>'
    ksefClientMock.downloadInvoiceXml.mockResolvedValue(incomingXml)
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
      ksefNumber: 'KSEF-NEW-NUMBER', invoiceNumber: 'SAME-NATURAL/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
    }] })

    expect((await POST()).status).toBe(200)
    expect(ksefClientMock.downloadInvoiceXml).toHaveBeenCalledTimes(1)
    expect(reconciliationMock).toHaveBeenCalledWith(transactionMarker, 'admin', expect.any(Object), incomingXml, expect.any(Date))
    expect(prismaMock.ksefInvoice.update).not.toHaveBeenCalled()
  })

  it.each([
    ['<Zaplacono>1</Zaplacono><DataZaplaty>2026-07-02</DataZaplaty>', 'PAID', '2026-07-02T00:00:00.000Z'],
    ['<ZnacznikZaplatyCzesciowej>1</ZnacznikZaplatyCzesciowej>', 'PARTIAL', null],
    ['<ZnacznikZaplatyCzesciowej>2</ZnacznikZaplatyCzesciowej>', 'PAID', null],
  ])('uses explicit payment markers for a new KSeF invoice %#', async (markers, paymentStatus, paidAt) => {
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
      ksefNumber: 'KSEF-EXPLICIT-PAYMENT', invoiceNumber: 'EXPLICIT/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
    }] })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue(`<Faktura><Fa><Platnosc>${markers}</Platnosc></Fa></Faktura>`)

    expect((await POST()).status).toBe(200)
    expect(prismaMock.ksefInvoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      paymentStatus, paidAt: paidAt ? new Date(paidAt) : null,
    }) })
  })

  it('keeps an explicitly unsupported KSeF correction blocked instead of mapping it as ACTIVE', async () => {
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
      ksefNumber: 'KSEF-KOR-ZAL', invoiceNumber: 'KOR-ZAL/01', issueDate: '2026-07-01', documentType: 'KOR_ZAL',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
    }] })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue('<Faktura />')

    expect((await POST()).status).toBe(200)
    expect(prismaMock.ksefInvoice.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      documentStatus: 'CORRECTION', status: 'NEW', costCenterId: null, supplierRuleId: null,
    }) })
  })

  it('rejects malformed XML before creating a legacy KSeF invoice', async () => {
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({ hasMore: false, isTruncated: false, invoices: [{
      ksefNumber: 'KSEF-BROKEN-XML', invoiceNumber: 'BROKEN-XML/01', issueDate: '2026-07-01',
      seller: { nip: '5250007133', name: 'Dostawca' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
    }] })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue('<Faktura><Fa><Platnosc><Zaplacono garbage>1</Zaplacono></Platnosc></Fa></Faktura>')

    const response = await POST()
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'INVALID_KSEF_SNAPSHOT' })
    expect(prismaMock.ksefInvoice.create).not.toHaveBeenCalled()
  })

  it('does not expose internal exception text in the synchronization response', async () => {
    ksefClientMock.queryPurchaseInvoiceMetadata.mockRejectedValue(new Error('PRIVATE_RECONCILIATION_DIAGNOSTIC'))
    const response = await POST()
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('PRIVATE_RECONCILIATION_DIAGNOSTIC')
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

  it('does not infer payment or payment date from an XML without a due date', async () => {
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
        paymentStatus: 'UNKNOWN',
        paidAt: null,
        paymentDetailsFetchedAt: expect.any(Date),
        xmlContent: expect.stringContaining('<Faktura'),
        xmlFetchedAt: expect.any(Date),
      }),
    })
  })

  it.each(['UNPAID', 'PARTIAL', 'UNKNOWN'])('keeps existing %s payment when XML has no explicit payment marker', async (paymentStatus) => {
    prismaMock.ksefInvoice.findUnique.mockResolvedValue({
      id: 'existing-no-payment-marker', externalId: 'KSEF-NO-PAYMENT',
      dueDate: null, bankAccount: null, paymentDetailsFetchedAt: null,
      reportingGrossAmount: null, reportingNetAmount: null, reportingVatAmount: null,
      status: 'MAPPED', paymentStatus, paidAt: null,
    })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({
      hasMore: false, isTruncated: false, invoices: [{
        ksefNumber: 'KSEF-NO-PAYMENT', invoiceNumber: 'NO-PAYMENT/2026', issueDate: '2026-07-05',
        seller: { nip: '5250007133', name: 'Dostawca Testowy' }, grossAmount: 123, netAmount: 100, vatAmount: 23, currency: 'PLN',
      }],
    })
    ksefClientMock.downloadInvoiceXml.mockResolvedValue('<Faktura><Fa><Platnosc><FormaPlatnosci>6</FormaPlatnosci></Platnosc></Fa></Faktura>')
    expect((await POST()).status).toBe(200)
    const written = prismaMock.ksefInvoice.update.mock.calls.at(-1)![0].data
    expect(written).not.toHaveProperty('paymentStatus')
    expect(written).not.toHaveProperty('paidAt')
  })

  it('updates an existing invoice matched by supplier, number, and issue date instead of creating a duplicate', async () => {
    prismaMock.ksefInvoice.findUnique.mockResolvedValue(null)
    prismaMock.ksefInvoice.findFirst.mockResolvedValue({
      id: 'invoice-natural-match',
      source: 'MANUAL',
      externalId: null,
      dueDate: null,
      bankAccount: null,
      paymentDetailsFetchedAt: null,
      reportingGrossAmount: null,
      reportingNetAmount: null,
      reportingVatAmount: null,
      status: 'NEW',
      paymentStatus: 'UNPAID',
      paidAt: null,
      xmlContent: null,
      xmlFetchedAt: null,
    })
    ksefClientMock.queryPurchaseInvoiceMetadata.mockResolvedValue({
      hasMore: false,
      isTruncated: false,
      invoices: [
        {
          ksefNumber: 'KSEF-NATURAL-MATCH',
          invoiceNumber: '006680/F/PL/06/2026',
          issueDate: '2026-06-30',
          seller: { nip: '7251846123', name: 'Mardom Spółka z ograniczoną odpowiedzialnością' },
          grossAmount: 1250.21,
          netAmount: 1016.43,
          vatAmount: 233.78,
          currency: 'PLN',
          paymentDueDate: '2026-07-30',
        },
      ],
    })

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ updated: 1, imported: 0 })
    expect(prismaMock.ksefInvoice.create).not.toHaveBeenCalled()
    expect(prismaMock.ksefInvoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-natural-match' },
      data: expect.objectContaining({
        externalId: 'KSEF-NATURAL-MATCH',
        source: 'MANUAL',
        supplierNip: '7251846123',
        invoiceNumber: '006680/F/PL/06/2026',
        issueDate: new Date('2026-06-30T00:00:00.000Z'),
        grossAmount: 1250.21,
        dueDate: new Date('2026-07-30T00:00:00.000Z'),
      }),
    })
  })
})
