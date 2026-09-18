import { beforeEach, describe, expect, it, vi } from 'vitest'
import FinancePage from '@/app/(dashboard)/finance/page'

const prismaMock = vi.hoisted(() => ({
  revenue: { findMany: vi.fn() },
  actualEntry: { findMany: vi.fn() },
  costEvent: { findMany: vi.fn() },
  cashAccount: { findMany: vi.fn() },
  ksefInvoice: { count: vi.fn(), findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => ({ user: { id: 'admin-1', role: 'ADMIN' } })),
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))

describe('Finance page invoice money summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.revenue.findMany.mockResolvedValue([])
    prismaMock.actualEntry.findMany.mockResolvedValue([])
    prismaMock.costEvent.findMany.mockResolvedValue([])
    prismaMock.cashAccount.findMany.mockResolvedValue([])
    prismaMock.ksefInvoice.count.mockResolvedValue(0)
    prismaMock.ksefInvoice.findMany
      .mockResolvedValueOnce([
        { currency: 'PLN', grossAmount: 100, reportingGrossAmount: null, paymentStatus: 'UNPAID', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: null },
        { currency: 'EUR', grossAmount: 20, reportingGrossAmount: null, paymentStatus: 'UNKNOWN', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: null },
        { currency: 'USD', grossAmount: 30, reportingGrossAmount: 120, paymentStatus: 'PARTIAL', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: { state: 'APPROVED' } },
        { currency: 'EUR', grossAmount: 50, reportingGrossAmount: null, paymentStatus: 'UNPAID', dueDate: null, documentStatus: 'CANCELLED', invoiceImportDraft: null },
        { currency: 'GBP', grossAmount: 70, reportingGrossAmount: null, paymentStatus: 'UNPAID', dueDate: null, documentStatus: 'ACTIVE', invoiceImportDraft: { state: 'ARCHIVED' } },
      ])
      .mockResolvedValueOnce([
        { status: 'NEW', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 50, reportingGrossAmount: null, invoiceImportDraft: null },
        { status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'EUR', grossAmount: 10, reportingGrossAmount: null, invoiceImportDraft: null },
        { status: 'MAPPED', documentStatus: 'ACTIVE', currency: 'USD', grossAmount: 100, reportingGrossAmount: 400, invoiceImportDraft: { state: 'APPROVED' } },
        { status: 'NEW', documentStatus: 'ACTIVE', currency: 'GBP', grossAmount: 100, reportingGrossAmount: null, invoiceImportDraft: { state: 'ARCHIVED' } },
        { status: 'NEW', documentStatus: 'CANCELLED', currency: 'PLN', grossAmount: 20, reportingGrossAmount: null, invoiceImportDraft: null },
      ])
  })

  it('includes every active non-paid status and gives the health view bounded summaries', async () => {
    const view = await FinancePage({ searchParams: Promise.resolve({ year: '2026' }) })

    expect(prismaMock.ksefInvoice.count).toHaveBeenCalledWith({ where: {
      status: { in: ['NEW', 'MAPPED'] },
      invoiceImportDraft: { is: null },
    } })
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenNthCalledWith(1, {
      where: { paymentStatus: { not: 'PAID' } },
      select: expect.objectContaining({
        currency: true,
        paymentStatus: true,
        dueDate: true,
        documentStatus: true,
        invoiceImportDraft: { select: { state: true } },
      }),
    })
    expect(view.props.unpaidInvoiceAmount).toBe(220)
    expect(view.props.unpaidInvoiceSummary).toEqual({
      plnAmount: 220,
      unconvertedCount: 1,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }],
    })
    expect(view.props.unpaidInvoiceCount).toBe(3)
    expect(view.props.uncertainPaymentCount).toBe(2)
    expect(view.props.unclassifiedWarningAmount).toBe(450)
    expect(view.props.unclassifiedWarningSummary).toEqual({
      plnAmount: 450,
      unconvertedCount: 1,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 10, count: 1 }],
    })
  })
})
