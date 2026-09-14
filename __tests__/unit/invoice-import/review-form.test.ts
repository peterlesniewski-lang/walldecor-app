import { describe, expect, it } from 'vitest'
import { invoiceDataToForm, invoiceFormPatch, invoiceReviewFormSchema } from '@/lib/invoice-import/review-form'
import { invoiceClassificationHint } from '@/lib/invoice-import/classification-hint'

describe('invoice reviewer form conversion', () => {
  it('roundtrips structured conversion while keeping UI-only rate text out of the API patch', () => {
    const conversion = { mode: 'MANUAL_RATE' as const, paymentDate: null, rate: '4.25', rateDate: null, tableNumber: null }
    const initial = invoiceDataToForm({ currency: 'EUR', gross: 360.2, reportingGross: 1530.85, conversion })
    expect(initial).toMatchObject({ conversion, conversionMode: 'MANUAL_RATE', conversionRate: '4.25' })
    expect(invoiceFormPatch(initial, initial)).toEqual({})
    expect(invoiceFormPatch(initial, { ...initial, conversionRate: '4,25' })).toEqual({})
    expect(invoiceFormPatch(initial, { ...initial, conversion: null, conversionRate: 'oops', conversionConfirmed: false })).toEqual({ conversion: null })
  })

  it('defaults legacy reporting to manual amount and new EUR drafts to NBP without inventing metadata', () => {
    expect(invoiceDataToForm({ currency: 'EUR', reportingGross: 0 })).toMatchObject({ conversionMode: 'MANUAL_AMOUNT', conversion: null })
    expect(invoiceDataToForm({ currency: 'EUR' })).toMatchObject({ conversionMode: 'NBP', conversionRate: '', conversion: null })
  })

  it.each([{ reportingNet: 1562.94 }, { reportingVat: 0 }])('protects any legacy manual reporting amount even when gross is missing', (data) => {
    expect(invoiceDataToForm({ currency: 'EUR', ...data })).toMatchObject({ conversionMode: 'MANUAL_AMOUNT', conversion: null })
  })

  it('invalidates confirmation for paidAt, metadata and PLN changes, and refuses invalid raw rates when confirmed', () => {
    const conversion = { mode: 'MANUAL_RATE' as const, paymentDate: null, rate: '4.25', rateDate: null, tableNumber: null }
    const initial = invoiceDataToForm({ currency: 'EUR', gross: 100, reportingGross: 425, conversion, conversionConfirmed: true })
    for (const changes of [{ paidAt: '2026-09-14' }, { reportingGross: '426' }, { conversion: { ...conversion, rate: '4.26' } }]) {
      expect(invoiceFormPatch(initial, { ...initial, ...changes, conversionConfirmed: false }).conversionConfirmed).toBe(false)
    }
    for (const conversionRate of ['0', 'Infinity', 'oops', '']) {
      expect(invoiceReviewFormSchema.safeParse({ ...initial, conversionRate }).success).toBe(false)
      expect(invoiceReviewFormSchema.safeParse({ ...initial, conversionRate, conversion: null, conversionConfirmed: false }).success).toBe(true)
    }
  })
  it('shows missing values as empty and never invents a date, currency, amount or payment confirmation', () => {
    const form = invoiceDataToForm({})
    expect(form.gross).toBe('')
    expect(form.issueDate).toBe('')
    expect(form.paymentStatus).toBe('')
    expect(form.currency).toBe('')
    expect(form.conversionConfirmed).toBe(false)
    expect(invoiceFormPatch(form, form)).toEqual({})
  })

  it('preserves explicit zero and sends only changed fields with cleared fields as null', () => {
    const initial = invoiceDataToForm({ gross: 0, supplierName: 'Original', net: 100, tagIds: ['one'] })
    expect(initial.gross).toBe('0')
    expect(invoiceFormPatch(initial, { ...initial, supplierName: 'Poprawiony', net: '', tagIds: [] })).toEqual({ supplierName: 'Poprawiony', net: null, tagIds: [] })
  })

  it('accepts Polish decimals without silently coercing an invalid number to zero', () => {
    const initial = invoiceDataToForm({})
    expect(invoiceFormPatch(initial, { ...initial, gross: '1 234,50', net: '-12,34' })).toEqual({ gross: 1234.5, net: -12.34 })
    expect(invoiceReviewFormSchema.safeParse({ ...initial, gross: '123,45,6' }).success).toBe(false)
    expect(invoiceReviewFormSchema.safeParse({ ...initial, gross: 'Infinity' }).success).toBe(false)
  })

  it('requires reconfirming FX when the nominal basis changes and preserves explicit confirmation in the same edit', () => {
    const initial = invoiceDataToForm({ currency: 'EUR', gross: 100, reportingGross: 425, conversionConfirmed: true })
    expect(invoiceFormPatch(initial, { ...initial, gross: '101' })).toEqual({ gross: 101, conversionConfirmed: false })
    const unconfirmed = { ...initial, conversionConfirmed: false }
    expect(invoiceFormPatch(unconfirmed, { ...unconfirmed, gross: '101', conversionConfirmed: true })).toEqual({ gross: 101, conversionConfirmed: true })
  })
})

describe('invoice-only supplier classification hints', () => {
  const rule = (id: string, overrides = {}) => ({ id, active: true, supplierNip: null, supplierNamePattern: null, priority: 100, costCenterId: 'JAG', tagIds: ['fixed'], ...overrides })

  it('matches the full foreign identifier and never conflates countries sharing digits', () => {
    const rules = [rule('fr', { supplierNip: 'FR123ABC' }), rule('de', { supplierNip: 'DE123ABC' })]
    expect(invoiceClassificationHint({ taxId: 'de 123-abc' }, rules)).toMatchObject({ status: 'MATCHED', rule: { id: 'de' } })
    expect(invoiceClassificationHint({ taxId: 'GB123ABC' }, rules)).toEqual({ status: 'NO_RULE' })
  })

  it('compares PL prefixes equivalently, prefers tax identity over name and respects priority', () => {
    const rules = [rule('name', { supplierNamePattern: 'Example', priority: 1 }), rule('tax', { supplierNip: 'PL1234567890' })]
    expect(invoiceClassificationHint({ taxId: '123-456-78-90', supplierName: 'Example' }, rules)).toMatchObject({ status: 'MATCHED', rule: { id: 'tax' } })
  })

  it('reports ties and does not change the draft or rules', () => {
    const draft = Object.freeze({ supplierName: 'Example Ltd' })
    const rules = Object.freeze([Object.freeze(rule('a', { supplierNamePattern: 'Example' })), Object.freeze(rule('b', { supplierNamePattern: 'Example' }))])
    expect(invoiceClassificationHint(draft, rules)).toEqual({ status: 'CONFLICT', ruleIds: ['a', 'b'] })
    expect(draft).toEqual({ supplierName: 'Example Ltd' })
  })

  it('ignores inactive rules and prefers exact supplier names over partial names', () => {
    const rules = [rule('inactive', { active: false, supplierNip: 'DE123' }), rule('partial', { supplierNamePattern: 'Example', priority: 1 }), rule('exact', { supplierNamePattern: 'Example Ltd', priority: 100 })]
    expect(invoiceClassificationHint({ taxId: 'DE123', supplierName: 'EXAMPLE LTD' }, rules)).toMatchObject({ status: 'MATCHED', rule: { id: 'exact' } })
  })
})
