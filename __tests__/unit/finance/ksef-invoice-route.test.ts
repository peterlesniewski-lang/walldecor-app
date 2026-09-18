import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as LIST_INVOICES } from '@/app/api/finance/ksef/invoices/route'
import { PATCH } from '@/app/api/finance/ksef/invoices/[id]/route'
import { applySupplierRuleToNewInvoices } from '@/lib/finance/ksef-rule-application'

const txMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(async () => 1),
  aiQueueLease: {
    findUniqueOrThrow: vi.fn(async () => ({ id: 'shared-ai', updatedAt: new Date() })),
  },
  invoiceImportDraft: {
    findUnique: vi.fn(async () => null),
  },
  ksefInvoice: {
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  ksefInvoicePart: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  ksefInvoicePartTag: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  ksefInvoicePartAllocation: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  ksefSupplierRule: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

const prismaMock = vi.hoisted(() => ({
  ksefInvoice: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => unknown) => callback(txMock)),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(async () => ({
    session: { user: { id: 'admin-1', role: 'ADMIN' } },
  })),
}))

vi.mock('@/lib/finance/ksef-rule-application', () => ({
  applySupplierRuleToNewInvoices: vi.fn(async () => 2),
}))

function request(body: unknown) {
  return new NextRequest('http://localhost/api/finance/ksef/invoices/invoice-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /api/finance/ksef/invoices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.ksefInvoice.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    prismaMock.ksefInvoice.count.mockResolvedValue(0)
    prismaMock.ksefInvoice.groupBy.mockResolvedValue([])
  })

  it('lists newest invoices first instead of grouping by status first', async () => {
    const response = await LIST_INVOICES(new NextRequest('http://localhost/api/finance/ksef/invoices'))

    expect(response.status).toBe(200)
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderBy: [{ issueDate: 'desc' }, { invoiceNumber: 'asc' }, { status: 'asc' }],
    }))
  })

  it('applies requested invoice sorting from query parameters', async () => {
    const response = await LIST_INVOICES(new NextRequest('http://localhost/api/finance/ksef/invoices?sortBy=grossAmount&sortDir=asc'))

    expect(response.status).toBe(200)
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderBy: [{ grossAmount: 'asc' }, { issueDate: 'desc' }, { invoiceNumber: 'asc' }],
    }))
  })

  it('reports only active known PLN and keeps unconverted and uncertain payment metadata', async () => {
    prismaMock.ksefInvoice.findMany.mockReset()
    prismaMock.ksefInvoice.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { currency: 'PLN', grossAmount: 100, reportingGrossAmount: null, paymentStatus: 'UNPAID', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: null },
        { currency: 'EUR', grossAmount: 20, reportingGrossAmount: null, paymentStatus: 'UNKNOWN', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: null },
        { currency: 'USD', grossAmount: 30, reportingGrossAmount: 120, paymentStatus: 'PARTIAL', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: { state: 'APPROVED' } },
        { currency: 'PLN', grossAmount: 0, reportingGrossAmount: null, paymentStatus: 'PAID', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: null },
        { currency: 'PLN', grossAmount: -2, reportingGrossAmount: null, paymentStatus: 'UNPAID', dueDate: null, documentStatus: 'CORRECTION', invoiceImportDraft: null },
        { currency: 'EUR', grossAmount: 50, reportingGrossAmount: null, paymentStatus: 'UNPAID', dueDate: null, documentStatus: 'CANCELLED', invoiceImportDraft: null },
        { currency: 'GBP', grossAmount: 70, reportingGrossAmount: null, paymentStatus: 'UNPAID', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: { state: 'ARCHIVED' } },
      ])

    const response = await LIST_INVOICES(new NextRequest('http://localhost/api/finance/ksef/invoices'))
    const body = await response.json()

    expect(body.grossAmountTotal).toBe(218)
    expect(body.grossAmountSummary).toEqual({
      plnAmount: 218,
      unconvertedCount: 1,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }],
    })
    expect(body.unpaidAmountTotal).toBe(218)
    expect(body.unpaidAmountSummary).toEqual({
      plnAmount: 218,
      unconvertedCount: 1,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }],
    })
    expect(body.unpaidCount).toBe(4)
    expect(body.uncertainPaymentCount).toBe(2)
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      include: expect.objectContaining({ invoiceImportDraft: { select: expect.objectContaining({ id: true, state: true, dataJson: true,
        ksefReconciliations: { select: expect.objectContaining({ snapshotJson: true, snapshotHash: true }) },
      }) } }),
    }))
    expect(body.paymentAging.MISSING_DUE_DATE).toEqual({
      count: 4,
      grossAmount: 218,
      plnAmount: 218,
      unconvertedCount: 1,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }],
    })
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      select: expect.objectContaining({
        currency: true,
        documentStatus: true,
        invoiceImportDraft: { select: { state: true } },
      }),
    }))
  })

  it('includes every non-paid status in deadline filters', async () => {
    prismaMock.ksefInvoice.findMany.mockReset()
    prismaMock.ksefInvoice.findMany
      .mockResolvedValueOnce([{ id: 'unknown-1', dueDate: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const response = await LIST_INVOICES(new NextRequest('http://localhost/api/finance/ksef/invoices?paymentDeadline=MISSING_DUE_DATE'))

    expect(response.status).toBe(200)
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { AND: [{ paymentStatus: { not: 'PAID' } }] },
    }))
  })
})

describe('PATCH /api/finance/ksef/invoices/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    txMock.invoiceImportDraft.findUnique.mockResolvedValue(null)
    txMock.ksefInvoice.findUnique.mockResolvedValueOnce({
      id: 'invoice-1',
      status: 'NEW',
      supplierNip: '5250007133',
      supplierName: 'Dostawca Testowy',
      invoiceNumber: 'FV/1/2026',
      grossAmount: 123,
      reportingGrossAmount: null,
      subCategoryId: null,
    })
    txMock.ksefInvoice.update.mockResolvedValue({
      id: 'invoice-1',
      status: 'MAPPED',
      supplierNip: '5250007133',
      supplierName: 'Dostawca Testowy',
      invoiceNumber: 'FV/1/2026',
      grossAmount: 123,
      reportingGrossAmount: null,
      subCategoryId: null,
    })
    txMock.ksefInvoice.findUnique.mockResolvedValueOnce({
      id: 'invoice-1',
      status: 'MAPPED',
      parts: [],
    })
    txMock.ksefInvoicePart.findMany.mockResolvedValue([])
    txMock.ksefInvoicePart.create.mockResolvedValue({ id: 'part-1' })
    txMock.ksefSupplierRule.findFirst.mockResolvedValue(null)
    txMock.ksefSupplierRule.create.mockResolvedValue({
      id: 'rule-1',
      supplierNip: '5250007133',
      supplierNamePattern: 'Dostawca Testowy',
      costCenterId: 'GLOBAL',
      subCategoryId: null,
      active: true,
      tags: [{ tagId: 'tag-goods' }],
    })
  })

  it('creates a supplier rule from tag-based classification without requiring legacy subcategory', async () => {
    const response = await PATCH(
      request({ costCenterId: 'GLOBAL', tagIds: ['tag-goods'] }),
      { params: Promise.resolve({ id: 'invoice-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(txMock.ksefSupplierRule.create).toHaveBeenCalledWith({
      data: {
        supplierNip: '5250007133',
        supplierNamePattern: 'Dostawca Testowy',
        costCenterId: 'GLOBAL',
        subCategoryId: null,
        active: true,
        tags: { create: [{ tagId: 'tag-goods' }] },
      },
      include: { tags: true },
    })
    expect(applySupplierRuleToNewInvoices).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({ id: 'rule-1', subCategoryId: null, tags: [{ tagId: 'tag-goods' }] })
    )
    expect(body.appliedCount).toBe(2)
  })
})
