// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { InvoiceImportError } from '@/lib/invoice-import/errors'
import { invoiceHttpErrorResponse, InvoiceImportHttpError } from '@/lib/invoice-import/http-errors'

describe('KSeF errors explain the required administrator action', () => {
  it.each([
    { error: new InvoiceImportError('KSEF_CONFLICT', 409), message: 'Rozstrzygnij różnice z KSeF przed zatwierdzeniem kosztu.' },
    { error: new InvoiceImportError('KSEF_AMBIGUOUS_MATCH', 409), message: 'Kilka dokumentów pasuje do faktury KSeF. Sprawdź powiązania i zbędne szkice przed ponowną synchronizacją.' },
    { error: new InvoiceImportHttpError('INVALID_KSEF_SNAPSHOT', 422), message: 'Dane faktury KSeF są niepełne lub nieprawidłowe. Dokument nie został zapisany.' },
  ])('returns controlled actionable $error.code', async ({ error, message }) => {
    const response = invoiceHttpErrorResponse(error)
    expect(response.status).toBe(error.status)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ code: error.code, error: message })
  })
})
