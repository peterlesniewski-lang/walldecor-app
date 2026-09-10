import { describe, expect, it } from 'vitest'
import { CashierCommandSchema, CashierQuerySchema, MAX_MONEY_CENTS } from '@/lib/cashier/contracts'

describe('cashier request contracts', () => {
  it('accepts explicitly entered zero sales but not decimals, negative sales or overflowing cents', () => {
    const command = { action: 'updateReport', costCenterId: 'PUL', reportId: 'report', version: 1, cashReceiptsCents: 0, cardReceiptsCents: 0 }
    expect(CashierCommandSchema.safeParse(command).success).toBe(true)
    for (const cashReceiptsCents of [-1, 1.25, MAX_MONEY_CENTS + 1]) {
      expect(CashierCommandSchema.safeParse({ ...command, cashReceiptsCents }).success).toBe(false)
    }
  })

  it('requires a positive amount and reference for cash movements', () => {
    const command = { action: 'addOperation', costCenterId: 'PUL', reportId: 'report', version: 1, kind: 'SALES_REFUND', method: 'CASH', amountCents: 100, reference: 'ZW/1' }
    expect(CashierCommandSchema.safeParse(command).success).toBe(true)
    expect(CashierCommandSchema.safeParse({ ...command, amountCents: 0 }).success).toBe(false)
    expect(CashierCommandSchema.safeParse({ ...command, reference: ' ' }).success).toBe(false)
  })

  it('requires a separate positive confirmation and request id at close', () => {
    const command = { action: 'closeReport', costCenterId: 'PUL', reportId: 'report', version: 1, requestId: 'close-report-12345', retainedConfirmed: true, depositConfirmed: true }
    expect(CashierCommandSchema.safeParse(command).success).toBe(true)
    expect(CashierCommandSchema.safeParse({ ...command, retainedConfirmed: false }).success).toBe(false)
    expect(CashierCommandSchema.safeParse({ ...command, requestId: '' }).success).toBe(false)
  })

  it('accepts only real ISO business dates and JAG/PUL', () => {
    expect(CashierQuerySchema.safeParse({ costCenterId: 'PUL', from: '2026-09-01' }).success).toBe(true)
    expect(CashierQuerySchema.safeParse({ costCenterId: 'GLOBAL' }).success).toBe(false)
    expect(CashierQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false)
    expect(CashierQuerySchema.safeParse({ from: '2026-09-10', to: '2026-09-01' }).success).toBe(false)
  })

  it('defaults audit history to page one and accepts only bounded positive integer pages', () => {
    expect(CashierQuerySchema.parse({}).auditPage).toBe(1)
    expect(CashierQuerySchema.parse({ auditPage: '2' }).auditPage).toBe(2)
    expect(CashierQuerySchema.parse({ auditPage: 3 }).auditPage).toBe(3)
    for (const auditPage of [0, -1, 1.5, '', '1.5', 'one', true, null, 21_474_838]) {
      expect(CashierQuerySchema.safeParse({ auditPage }).success).toBe(false)
    }
  })

  it('requires exactly one setup account choice and explicit no-duplication confirmation for a new account', () => {
    const base = { action: 'setup', costCenterId: 'PUL', startDate: '2026-09-01', initialCashCents: 27000, targetFloatCents: 27000, sourceReportConfirmed: true }
    expect(CashierCommandSchema.safeParse({ ...base, cashAccountId: 'cash-1' }).success).toBe(true)
    expect(CashierCommandSchema.safeParse({ ...base, newAccountName: 'Kasa Puławska', noDuplicateCashConfirmed: true }).success).toBe(true)
    expect(CashierCommandSchema.safeParse({ ...base, newAccountName: 'Kasa Puławska' }).success).toBe(false)
    expect(CashierCommandSchema.safeParse({ ...base, cashAccountId: 'cash-1', newAccountName: 'Kasa' }).success).toBe(false)
    expect(CashierCommandSchema.safeParse({ ...base, cashAccountId: 'cash-1', sourceReportConfirmed: false }).success).toBe(false)
  })
})
