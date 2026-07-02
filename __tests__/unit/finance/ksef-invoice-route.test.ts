import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/finance/ksef/invoices/[id]/route'
import { applySupplierRuleToNewInvoices } from '@/lib/finance/ksef-rule-application'

const txMock = vi.hoisted(() => ({
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

describe('PATCH /api/finance/ksef/invoices/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.ksefInvoice.findUnique.mockResolvedValue({
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
    txMock.ksefInvoice.findUnique.mockResolvedValue({
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
