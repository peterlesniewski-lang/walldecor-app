// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadActualDashboardModel } from '@/lib/finance/actual-dashboard-model-data'

const db = vi.hoisted(() => ({
  revenue: { findMany: vi.fn() },
  actualEntry: { findMany: vi.fn() },
  costEvent: { findMany: vi.fn() },
  ksefInvoice: { findMany: vi.fn() },
  financePeriodClose: { findMany: vi.fn() },
}))
// Deliberately expose only financial tables: unrelated reads must fail this boundary test.
vi.mock('@/lib/prisma', () => ({ prisma: db }))

beforeEach(() => {
  vi.resetAllMocks()
  for (const table of Object.values(db)) table.findMany.mockResolvedValue([])
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Financial model must not use the network') }))
})
afterEach(() => vi.unstubAllGlobals())

describe('financial-only dashboard loader', () => {
  it('loads the requested year and comparable prior period without cash, notifications or network', async () => {
    const model = await loadActualDashboardModel({ year: 2026, month: 8 }, new Date('2026-09-10T12:00:00Z'))
    expect(model.selected).toMatchObject({ revenue: null, result: null, costs: 0, complete: false })
    expect(model.yoy).toBeNull()
    expect(db.revenue.findMany.mock.calls).toEqual([
      [{ where: { year: 2026, month: { lte: 8 } } }],
      [{ where: { year: 2025, month: { lte: 8 } } }],
    ])
    expect(db.costEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      status: 'APPROVED', eventDate: { gte: new Date('2026-01-01T00:00:00Z'), lt: new Date('2026-09-01T00:00:00Z') },
    } }))
    expect(db.ksefInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      status: { in: ['NEW', 'MAPPED'] }, documentStatus: { not: 'CANCELLED' },
    }) }))
    expect(db.costEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      status: 'DRAFT', documentStatus: { not: 'CANCELLED' },
    }) }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps UTC document months, deduplicates linked pending costs and separates unconverted money', async () => {
    const issueDate = new Date('2026-08-31T23:59:59Z')
    db.ksefInvoice.findMany.mockResolvedValue([{ id: 'pending', issueDate, currency: 'EUR', grossAmount: 100, reportingGrossAmount: null }])
    db.costEvent.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'linked', sourceInvoiceId: 'pending', eventDate: issueDate },
    ])
    db.financePeriodClose.findMany.mockResolvedValue([{ year: 2026, month: 8 }])
    const model = await loadActualDashboardModel({ year: 2026, month: 8 }, new Date('2026-08-31T22:30:00Z'))
    expect(model.today).toBe('2026-09-01')
    expect(model.selected).toMatchObject({ pendingDocumentCount: 1, costsConfirmed: false, periodClosed: true })
    expect(model.waiting).toEqual({ count: 1, plnAmount: 0, unconverted: [{ currency: 'EUR', amount: 100 }] })
  })

  it.each(['OPEN', 'ARCHIVED'])('does not reuse the old invoice amount of a %s import as a pending cost', async (state) => {
    db.ksefInvoice.findMany.mockResolvedValue([{
      id: 'revoked-import', issueDate: new Date('2026-08-10T00:00:00Z'),
      currency: 'EUR', grossAmount: 100, reportingGrossAmount: null,
      invoiceImportDraft: { state },
    }])
    db.financePeriodClose.findMany.mockResolvedValue([{ year: 2026, month: 8 }])

    const model = await loadActualDashboardModel({ year: 2026, month: 8 }, new Date('2026-09-10T12:00:00Z'))

    expect(model.waiting).toEqual({ count: 0, plnAmount: 0, unconverted: [] })
    expect(model.selected).toMatchObject({ costs: 0, pendingDocumentCount: 0, costsConfirmed: true, periodClosed: true })
    expect(db.ksefInvoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ invoiceImportDraft: { select: { state: true } } }),
    }))
  })
})
