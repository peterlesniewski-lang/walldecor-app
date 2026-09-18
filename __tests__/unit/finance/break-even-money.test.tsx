import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/finance/break-even/route'
import { BreakEvenView } from '@/components/shared/break-even-view'

const prismaMock = vi.hoisted(() => ({
  actualEntry: { findMany: vi.fn() },
  costEvent: { findMany: vi.fn() },
  revenue: { findMany: vi.fn() },
  contributionMarginSetting: { findMany: vi.fn() },
  ksefInvoice: { findMany: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceReportAccess: vi.fn(async () => ({ session: { user: { id: 'admin-1', role: 'ADMIN' } } })),
}))

describe('break-even warning money', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.actualEntry.findMany.mockResolvedValue([])
    prismaMock.costEvent.findMany.mockResolvedValue([])
    prismaMock.revenue.findMany.mockResolvedValue([])
    prismaMock.contributionMarginSetting.findMany.mockResolvedValue([])
    prismaMock.ksefInvoice.findMany.mockResolvedValue([
      { status: 'NEW', documentStatus: 'ACTIVE', currency: 'PLN', grossAmount: 100, reportingGrossAmount: null, invoiceImportDraft: null },
      { status: 'APPROVED', documentStatus: 'ACTIVE', currency: 'EUR', grossAmount: 20, reportingGrossAmount: null, invoiceImportDraft: null },
      { status: 'MAPPED', documentStatus: 'ACTIVE', currency: 'USD', grossAmount: 30, reportingGrossAmount: 120, invoiceImportDraft: { state: 'APPROVED' } },
      { status: 'NEW', documentStatus: 'CANCELLED', currency: 'PLN', grossAmount: 40, reportingGrossAmount: null, invoiceImportDraft: null },
      { status: 'NEW', documentStatus: 'ACTIVE', currency: 'GBP', grossAmount: 50, reportingGrossAmount: null, invoiceImportDraft: { state: 'ARCHIVED' } },
    ])
  })

  it('returns active known PLN and unconverted warning metadata', async () => {
    const response = await GET(new NextRequest('http://localhost/api/finance/break-even?year=2026&month=9'))
    const body = await response.json()

    expect(body.report.warningAmount).toBe(220)
    expect(body.report.warningSummary).toEqual({
      plnAmount: 220,
      unconvertedCount: 1,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }],
    })
    expect(prismaMock.ksefInvoice.findMany).toHaveBeenCalledWith({
      select: expect.objectContaining({ invoiceImportDraft: { select: { state: true } } }),
    })
  })

  it('renders known PLN and each nominal warning currency separately', () => {
    render(<BreakEvenView initialReport={{
      warningAmount: 220,
      warningSummary: {
        plnAmount: 220,
        unconvertedCount: 2,
        unconvertedByCurrency: [
          { currency: 'EUR', amount: 20, count: 1 },
          { currency: 'GBP', amount: 30, count: 1 },
        ],
      },
      byCostCenter: {},
    }} />)

    expect(screen.getByText('220 PLN')).toBeTruthy()
    expect(screen.getByText('Bez przeliczenia: 2 dokumenty')).toBeTruthy()
    expect(screen.getByText('20 EUR · 1 dokument')).toBeTruthy()
    expect(screen.getByText('30 GBP · 1 dokument')).toBeTruthy()
  })
})
