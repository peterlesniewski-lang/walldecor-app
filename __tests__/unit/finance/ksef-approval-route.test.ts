import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as approvalRoute from '@/app/api/finance/ksef/invoices/[id]/approve/route'

const txMock = vi.hoisted(() => ({
  costEvent: {
    updateMany: vi.fn(),
  },
  ksefInvoice: {
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

describe('DELETE /api/finance/ksef/invoices/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.ksefInvoice.findUnique.mockResolvedValue({
      id: 'invoice-1',
      status: 'APPROVED',
      costEvent: { id: 'event-1', status: 'APPROVED' },
    })
    txMock.costEvent.updateMany.mockResolvedValue({ count: 1 })
    txMock.ksefInvoice.update.mockResolvedValue({
      id: 'invoice-1',
      status: 'MAPPED',
      costCenter: null,
      subCategory: null,
      supplierRule: null,
      parts: [],
    })
  })

  it('voids the generated CostEvent and returns the invoice to mapped state', async () => {
    const deleteHandler = (approvalRoute as { DELETE?: typeof approvalRoute.POST }).DELETE
    expect(deleteHandler).toBeTypeOf('function')

    const response = await deleteHandler!(
      new Request('http://localhost/api/finance/ksef/invoices/invoice-1/approve', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'invoice-1' }) }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(txMock.costEvent.updateMany).toHaveBeenCalledWith({
      where: { sourceInvoiceId: 'invoice-1', status: 'APPROVED' },
      data: { status: 'VOID', sourceInvoiceId: null },
    })
    expect(txMock.ksefInvoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-1' },
      data: {
        status: 'MAPPED',
        auditLogs: {
          create: {
            action: 'invoice.unapprove',
            actorId: 'admin-1',
            beforeJson: JSON.stringify({ status: 'APPROVED', costEventId: 'event-1' }),
            afterJson: JSON.stringify({ status: 'MAPPED', costEventStatus: 'VOID' }),
          },
        },
      },
      include: {
        costCenter: true,
        subCategory: { include: { category: true } },
        supplierRule: true,
        parts: {
          include: {
            tags: { include: { tag: true } },
            allocations: true,
          },
          orderBy: { order: 'asc' },
        },
      },
    })
    expect(body.invoice.status).toBe('MAPPED')
    expect(body.voidedCostEvents).toBe(1)
  })
})
