import { describe, expect, it } from 'vitest'
import { summarizeInvoiceMoney, summarizeInvoicePayments } from '@/lib/finance/invoice-money'

describe('summarizeInvoiceMoney', () => {
  it('keeps nominal foreign currency out of known PLN totals', () => {
    expect(summarizeInvoiceMoney([
      { currency: 'PLN', grossAmount: 100 },
      { currency: 'EUR', grossAmount: 20 },
      { currency: 'EUR', grossAmount: 30, reportingGrossAmount: null },
      { currency: 'USD', grossAmount: 40, reportingGrossAmount: 160 },
      { currency: 'GBP', grossAmount: 10 },
    ])).toEqual({
      plnAmount: 260,
      unconvertedCount: 3,
      unconvertedByCurrency: [
        { currency: 'EUR', amount: 50, count: 2 },
        { currency: 'GBP', amount: 10, count: 1 },
      ],
    })
  })

  it('preserves explicit zero, negative corrections, and empty input', () => {
    expect(summarizeInvoiceMoney([])).toEqual({ plnAmount: 0, unconvertedCount: 0, unconvertedByCurrency: [] })
    expect(summarizeInvoiceMoney([
      { currency: 'EUR', grossAmount: 99, reportingGrossAmount: 0 },
      { currency: 'PLN', grossAmount: -12.34 },
      { currency: 'USD', grossAmount: -10 },
      { currency: 'USD', grossAmount: 10 },
    ])).toEqual({
      plnAmount: -12.34,
      unconvertedCount: 2,
      unconvertedByCurrency: [{ currency: 'USD', amount: 0, count: 2 }],
    })
  })

  it('normalizes currency labels and rounds sums without losing documents', () => {
    expect(summarizeInvoiceMoney([
      { currency: ' pln ', grossAmount: 0.1 },
      { currency: 'PLN', grossAmount: 0.2 },
      { currency: ' eur ', grossAmount: 0.1 },
      { currency: 'EUR', grossAmount: 0.2 },
    ])).toEqual({
      plnAmount: 0.3,
      unconvertedCount: 2,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 0.3, count: 2 }],
    })
  })
})

describe('summarizeInvoicePayments', () => {
  it('counts UNKNOWN and PARTIAL documents without pretending the outstanding amount is known', () => {
    const summary = summarizeInvoicePayments([
      { currency: 'PLN', grossAmount: 100, paymentStatus: 'UNPAID', dueDate: new Date('2026-09-01T00:00:00Z') },
      { currency: 'EUR', grossAmount: 20, paymentStatus: 'UNKNOWN', dueDate: null },
      { currency: 'USD', grossAmount: 30, paymentStatus: 'PARTIAL', dueDate: null },
      { currency: 'PLN', grossAmount: 40, paymentStatus: 'PAID', dueDate: null },
    ], new Date('2026-09-11T12:00:00Z'))
    expect(summary.gross.plnAmount).toBe(140)
    expect(summary.unpaid).toMatchObject({ plnAmount: 100, unconvertedCount: 2 })
    expect(summary.unpaidCount).toBe(3)
    expect(summary.uncertainPaymentCount).toBe(2)
    expect(summary.paymentAging.OVERDUE).toEqual({ count: 1, plnAmount: 100, unconvertedCount: 0, unconvertedByCurrency: [] })
    expect(summary.paymentAging.MISSING_DUE_DATE).toEqual({
      count: 2, plnAmount: 0, unconvertedCount: 2,
      unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }, { currency: 'USD', amount: 30, count: 1 }],
    })
  })

  it('keeps converted invoices in their real aging bucket across a year boundary', () => {
    const summary = summarizeInvoicePayments([
      { currency: 'EUR', grossAmount: 100, reportingGrossAmount: 420, paymentStatus: 'UNPAID', dueDate: new Date('2027-01-02T00:00:00Z') },
      { currency: 'PLN', grossAmount: 0, paymentStatus: 'UNPAID', dueDate: null },
    ], new Date('2026-12-30T12:00:00Z'))
    expect(summary.paymentAging.DUE_0_7).toMatchObject({ count: 1, plnAmount: 420, unconvertedCount: 0 })
    expect(summary.paymentAging.MISSING_DUE_DATE.count).toBe(1)
    expect(Object.keys(summary.paymentAging)).toHaveLength(6)
  })
})
