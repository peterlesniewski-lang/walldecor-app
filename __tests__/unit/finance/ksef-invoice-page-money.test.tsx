import { beforeEach, describe, expect, it, vi } from 'vitest'
import KsefInboxPage from '@/app/(dashboard)/finance/ksef/page'

const prismaMock = vi.hoisted(() => ({
  ksefInvoice: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  ksefSupplierRule: { findMany: vi.fn() },
  costCenter: { findMany: vi.fn() },
  subCategory: { findMany: vi.fn() },
  costTagGroup: { findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => ({ user: { id: 'admin-1', role: 'ADMIN' } })),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))

describe('KSeF inbox SSR money summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    prismaMock.ksefInvoice.count.mockResolvedValue(0)
    prismaMock.ksefInvoice.groupBy.mockResolvedValue([])
    prismaMock.ksefSupplierRule.findMany.mockResolvedValue([])
    prismaMock.costCenter.findMany.mockResolvedValue([])
    prismaMock.subCategory.findMany.mockResolvedValue([])
    prismaMock.costTagGroup.findMany.mockResolvedValue([])
  })

  it('uses the same active mixed-currency semantics and metadata as the list API', async () => {
    const view = await KsefInboxPage()

    expect(view.props.initialGrossAmountTotal).toBe(218)
    expect(view.props.initialGrossAmountSummary).toEqual({
      plnAmount: 218,
      unconvertedCount: 1,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }],
    })
    expect(view.props.initialUnpaidAmountSummary).toEqual({
      plnAmount: 218,
      unconvertedCount: 1,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }],
    })
    expect(view.props.initialUnpaidCount).toBe(4)
    expect(view.props.initialUncertainPaymentCount).toBe(2)
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      include: expect.objectContaining({ invoiceImportDraft: { select: expect.objectContaining({ id: true, state: true, dataJson: true,
        ksefReconciliations: { select: expect.objectContaining({ snapshotJson: true, snapshotHash: true }) },
      }) } }),
    }))
    expect(view.props.initialPaymentAging.MISSING_DUE_DATE).toEqual({
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
})
