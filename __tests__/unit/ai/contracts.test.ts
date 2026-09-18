import { describe, expect, it } from 'vitest'
import {
  aiJobInputSchema,
  aiChatResultSchema,
  aiInvoiceResultSchema,
  aiJobResultJsonSchema,
  parseAiJobResult,
} from '@/lib/ai/contracts'

const unknownInvoice = {
  documentType: null, supplierName: null, taxId: null, invoiceNumber: null,
  issueDate: null, dueDate: null, currency: null, gross: null, net: null, vat: null,
  bankAccount: null, paymentStatus: null, warnings: ['Unreadable document'],
}

describe('data-only shared AI contracts', () => {
  it('validates only the three job shapes with bounded context and no executable fields', () => {
    expect(aiJobInputSchema.parse({ kind: 'FINANCE_CHAT', payload: { question: 'Czy rośnie marża?', context: 'Zweryfikowany kontekst' } })).toMatchObject({ kind: 'FINANCE_CHAT' })
    expect(aiJobInputSchema.parse({ kind: 'WIKI_CHAT', payload: { question: 'Procedura?', context: '' } })).toMatchObject({ kind: 'WIKI_CHAT' })
    expect(aiJobInputSchema.parse({ kind: 'INVOICE_EXTRACT', payload: { draftId: 'draft-a', revision: 1, attachmentId: 'attachment-a' } })).toMatchObject({ kind: 'INVOICE_EXTRACT' })
    for (const input of [
      { kind: 'UNKNOWN', payload: {} },
      { kind: 'FINANCE_CHAT', payload: { question: '', context: '' } },
      { kind: 'FINANCE_CHAT', payload: { question: 'x'.repeat(501), context: '' } },
      { kind: 'FINANCE_CHAT', payload: { question: 'q', context: 'x'.repeat(80_001) } },
      { kind: 'FINANCE_CHAT', payload: { question: 'q', context: '', command: 'mutate' } },
      { kind: 'INVOICE_EXTRACT', payload: { draftId: 'draft-a', revision: 0, attachmentId: 'attachment-a' } },
      { kind: 'INVOICE_EXTRACT', payload: { draftId: 'draft-a', revision: 1, attachmentId: 'attachment-a', filePath: '/secrets' } },
    ]) expect(aiJobInputSchema.safeParse(input).success).toBe(false)
  })

  it('preserves unknown fields as null and accepts signed correction amounts without guessing payment', () => {
    expect(aiInvoiceResultSchema.parse(unknownInvoice)).toEqual(unknownInvoice)
    const correction = { ...unknownInvoice, documentType: 'CORRECTION', gross: -123, net: -100, vat: -23, issueDate: '2026-09-10', currency: 'PLN', paymentStatus: 'UNKNOWN' }
    expect(aiInvoiceResultSchema.parse(correction)).toEqual(correction)
    expect(aiInvoiceResultSchema.safeParse({ warnings: [] }).success).toBe(false)
    expect(aiInvoiceResultSchema.safeParse({ ...unknownInvoice, gross: '123' }).success).toBe(false)
    expect(aiInvoiceResultSchema.safeParse({ ...unknownInvoice, dueDate: '2026-02-31' }).success).toBe(false)
    expect(aiInvoiceResultSchema.safeParse({ ...unknownInvoice, commit: true }).success).toBe(false)
  })

  it('requires strict JSON result data and derives the runtime JSON schema from the same validator', () => {
    expect(parseAiJobResult('WIKI_CHAT', { answer: 'Odpowiedź' })).toEqual({ answer: 'Odpowiedź' })
    expect(aiChatResultSchema.safeParse({ answer: '', actions: [] }).success).toBe(false)
    expect(() => parseAiJobResult('INVOICE_EXTRACT', { answer: 'Not an invoice' })).toThrow()
    expect(aiJobResultJsonSchema('FINANCE_CHAT')).toMatchObject({ type: 'object', additionalProperties: false, required: ['answer'] })
    expect(aiJobResultJsonSchema('INVOICE_EXTRACT')).toMatchObject({ type: 'object', additionalProperties: false })
  })
})
