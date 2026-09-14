import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InvoiceReviewEditor, type InvoiceReviewEditorProps } from '@/components/invoice-import/invoice-review-editor'
import type { InvoiceDraftData } from '@/lib/invoice-import/contracts'
import type { NbpEurQuote } from '@/lib/invoice-import/eur-conversion'
import { validateInvoiceApproval } from '@/lib/invoice-import/approval-policy'

const quote: NbpEurQuote = { currency: 'EUR', paymentDate: '2026-09-14', rate: '4.3228', rateDate: '2026-09-11', tableNumber: '177/A/NBP/2026' }
const manual = { mode: 'MANUAL_RATE' as const, paymentDate: null, rate: '4.25', rateDate: null, tableNumber: null }
function input(data: InvoiceDraftData = {}, extra: Partial<InvoiceReviewEditorProps> = {}): InvoiceReviewEditorProps {
  const values = { currency: 'EUR', gross: 360.2, ...data }
  return {
    draft: { id: 'eur-draft', batchId: 'batch', version: 1, extractionRevision: 0, state: 'OPEN', skippedAt: null, invoiceId: null,
      ksef: { linkedCount: 0, conflictCount: 0 }, display: { fileName: 'eur.pdf', supplierName: null, invoiceNumber: null, gross: 360.2, currency: 'EUR' },
      latestJob: null, createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z', data: values, manualFields: [],
      attachment: { id: 'original', sha256: 'a'.repeat(64), originalName: 'eur.pdf', mimeType: 'application/pdf', byteSize: 1, pageCount: 2, state: 'READY', createdAt: '2026-09-14T00:00:00.000Z', updatedAt: '2026-09-14T00:00:00.000Z' },
    }, costCenters: [], tagGroups: [], rules: [], busy: false,
    onSave: vi.fn(async () => {}), onApprove: vi.fn(async () => {}), onRevoke: vi.fn(async () => {}), onAction: vi.fn(async () => {}),
    eurRate: vi.fn(async () => quote), ...extra,
  }
}
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const edit = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }))
const confirmation = () => screen.getByRole('checkbox', { name: /Potwierdzam przeliczenie/ }) as HTMLInputElement
function pending<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }

describe('EUR review operator flow', () => {
  it.each([{ reportingNet: 1562.94 }, { reportingVat: 0 }])('preserves incomplete legacy manual PLN fields after the payment date is entered', (data) => {
    const props = input({ ...data, conversionConfirmed: true })
    render(<InvoiceReviewEditor {...props} />)
    expect(screen.getByRole('button', { name: 'Kwota PLN ręcznie' }).getAttribute('aria-pressed')).toBe('true')
    edit('Data zapłaty (opcjonalnie)', quote.paymentDate)
    expect(props.eurRate).not.toHaveBeenCalled()
    expect(field('Netto w PLN').value).toBe('reportingNet' in data ? String(data.reportingNet) : '')
    expect(field('VAT w PLN').value).toBe('reportingVat' in data ? '0' : '')
    expect(confirmation().checked).toBe(false)
  })
  it('opens confirmed saved NBP offline without changing its basis or making the form dirty', () => {
    const dirty = vi.fn()
    const props = input({ paidAt: quote.paymentDate, conversion: { mode: 'NBP', paymentDate: quote.paymentDate, rate: quote.rate, rateDate: quote.rateDate, tableNumber: quote.tableNumber },
      reportingGross: 1557.07, conversionConfirmed: true, conversionNote: 'Zapisana podstawa NBP',
    }, { onDirtyChange: dirty, eurRate: vi.fn(async () => { throw new Error('offline') }) })
    render(<InvoiceReviewEditor {...props} />)
    expect(confirmation().checked).toBe(true)
    expect(field('Brutto w PLN').value).toBe('1557.07')
    expect(props.eurRate).not.toHaveBeenCalled()
    expect(dirty).toHaveBeenLastCalledWith(false)
  })

  it.each(['APPROVED', 'BUSY'] as const)('fences a pending request when the editor becomes %s', async (state) => {
    const delayed = pending<NbpEurQuote>()
    const props = input({ paidAt: quote.paymentDate }, { eurRate: vi.fn(() => delayed.promise) })
    const view = render(<InvoiceReviewEditor {...props} />)
    await waitFor(() => expect(props.eurRate).toHaveBeenCalledOnce())
    view.rerender(<InvoiceReviewEditor {...props} busy={state === 'BUSY'} draft={state === 'APPROVED' ? { ...props.draft, version: 2, state: 'APPROVED', invoiceId: 'invoice' } : props.draft} />)
    await act(async () => delayed.resolve(quote))
    expect(field('Brutto w PLN').value).toBe('')
    expect(field('Kwota do zapłaty (EUR)').disabled).toBe(true)
  })

  it('aborts old lookup on load-latest and keeps the new manual basis', async () => {
    const delayed = pending<NbpEurQuote>()
    const props = input({ paidAt: quote.paymentDate }, { eurRate: vi.fn(() => delayed.promise) })
    const view = render(<InvoiceReviewEditor {...props} />)
    await waitFor(() => expect(props.eurRate).toHaveBeenCalledOnce())
    edit('Nazwa dostawcy', 'Moja poprawka')
    const latest = { ...props.draft, version: 2, data: { ...props.draft.data, paidAt: null, conversion: manual, reportingGross: 1530.85 } }
    view.rerender(<InvoiceReviewEditor {...props} draft={latest} />)
    click('Wczytaj aktualne dane')
    await act(async () => delayed.resolve(quote))
    expect(field('1 EUR = … PLN').value).toBe('4.25')
    expect(field('Brutto w PLN').value).toBe('1530.85')
    expect(field('Nazwa dostawcy').value).toBe('')
  })

  it.each([
    { paidAt: '2026-09-14', conversion: { ...manual, paymentDate: '2026-09-14' } },
    { conversion: { ...manual, rate: '4.26' }, reportingGross: 1534.45 },
    { conversion: { mode: 'MANUAL_AMOUNT' as const, paymentDate: null, rate: null, rateDate: null, tableNumber: null }, reportingGross: 1500 },
  ])('does not inherit stale local confirmation after rebase changes paidAt, rate or final PLN', async (incoming) => {
    const props = input({ conversion: manual, reportingGross: 1530.85 })
    const view = render(<InvoiceReviewEditor {...props} />)
    fireEvent.click(confirmation())
    view.rerender(<InvoiceReviewEditor {...props} draft={{ ...props.draft, version: 2, data: { ...props.draft.data, ...incoming } }} />)
    click('Zapisz moje poprawki na aktualnej wersji')
    expect(confirmation().checked).toBe(false)
    expect(screen.getByText('Przeliczenie wymaga ponownego potwierdzenia')).toBeTruthy()
  })

  it('keeps PLN values when leaving EUR and returning, until an explicit NBP selection', async () => {
    const props = input({ conversion: manual, reportingGross: 1530.85, conversionConfirmed: true })
    render(<InvoiceReviewEditor {...props} />)
    edit('Waluta', 'USD')
    expect(field('Kwota brutto').value).toBe('360.2')
    expect(confirmation().checked).toBe(false)
    edit('Waluta', 'EUR')
    expect(field('Brutto w PLN').value).toBe('1530.85')
    expect(screen.getByRole('button', { name: 'Kwota PLN ręcznie' }).getAttribute('aria-pressed')).toBe('true')
    expect(props.eurRate).not.toHaveBeenCalled()
  })

  it('preserves user-written notes and marks a superseded NBP note when PLN is overridden', async () => {
    const props = input({ paidAt: quote.paymentDate, conversionNote: 'NBP sprawdzony przez Piotra — ważna uwaga' })
    render(<InvoiceReviewEditor {...props} />)
    await waitFor(() => expect(field('Brutto w PLN').value).toBe('1557.07'))
    expect(field('Podstawa i uwaga do przeliczenia').value).toBe('NBP sprawdzony przez Piotra — ważna uwaga')
    edit('Brutto w PLN', '1500')
    expect(field('Podstawa i uwaga do przeliczenia').value).toContain('Kwota PLN ustalona ręcznie')
    expect(field('Podstawa i uwaga do przeliczenia').value).toContain('Poprzednia uwaga (nie określa bieżącego przeliczenia): NBP sprawdzony przez Piotra — ważna uwaga')
  })
  it.each(['4,25', '4.25'])('converts 360,20 EUR using editable rate %s and keeps unknown net/VAT unknown', async (rate) => {
    const props = input()
    render(<InvoiceReviewEditor {...props} />)
    expect(field('Kwota do zapłaty (EUR)').value).toBe('360.2')
    click('Wpisz kurs ręcznie')
    edit('Kwota do zapłaty (EUR)', '360,20')
    edit('1 EUR = … PLN', rate)
    await waitFor(() => expect(field('Brutto w PLN').value).toBe('1530.85'))
    expect(field('Netto w PLN').value).toBe('')
    expect(field('VAT w PLN').value).toBe('')
    fireEvent.click(confirmation())
    click('Zapisz szkic')
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ reportingGross: 1530.85, conversionConfirmed: true,
      conversion: manual,
    }), 1))
    expect(props.eurRate).not.toHaveBeenCalled()
  })

  it('automatically fetches NBP once for a valid payment date and rerates source changes without refetching', async () => {
    const props = input({ paidAt: quote.paymentDate })
    render(<InvoiceReviewEditor {...props} />)
    await waitFor(() => expect(field('Brutto w PLN').value).toBe('1557.07'))
    expect(screen.getByText(/177\/A\/NBP\/2026/)).toBeTruthy()
    fireEvent.click(confirmation())
    edit('Kwota do zapłaty (EUR)', '100')
    await waitFor(() => expect(field('Brutto w PLN').value).toBe('432.28'))
    expect(confirmation().checked).toBe(false)
    expect(props.eurRate).toHaveBeenCalledTimes(1)
  })

  it.each(['', '2099-01-01', '2026-02-30'])('does not fabricate a quote for payment date %s', async (paidAt) => {
    const props = input({ paidAt: paidAt === '2026-02-30' ? null : paidAt || null })
    render(<InvoiceReviewEditor {...props} />)
    if (paidAt === '2026-02-30') edit('Data zapłaty (opcjonalnie)', paidAt)
    expect(confirmation().disabled).toBe(true)
    expect(props.eurRate).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Wpisz kurs ręcznie' })).toBeTruthy()
  })

  it('shows an NBP error and offers retry and manual conversion', async () => {
    const eurRate = vi.fn().mockRejectedValueOnce(new Error('do not display internal URL')).mockResolvedValueOnce(quote)
    render(<InvoiceReviewEditor {...input({ paidAt: quote.paymentDate }, { eurRate })} />)
    await waitFor(() => expect(screen.getByText(/Nie udało się pobrać kursu NBP/)).toBeTruthy())
    expect(screen.queryByText(/internal URL/)).toBeNull()
    click('Ponów pobranie kursu')
    await waitFor(() => expect(field('Brutto w PLN').value).toBe('1557.07'))
    expect(eurRate).toHaveBeenCalledTimes(2)
  })

  it('ignores a late NBP response after a manual rate edit', async () => {
    const delayed = pending<NbpEurQuote>()
    const props = input({ paidAt: quote.paymentDate }, { eurRate: vi.fn(() => delayed.promise) })
    render(<InvoiceReviewEditor {...props} />)
    await waitFor(() => expect(props.eurRate).toHaveBeenCalledOnce())
    click('Wpisz kurs ręcznie')
    edit('1 EUR = … PLN', '4,25')
    await act(async () => delayed.resolve(quote))
    expect(field('1 EUR = … PLN').value).toBe('4,25')
    expect(field('Brutto w PLN').value).toBe('1530.85')
    expect(screen.queryByText(/177\/A\/NBP\/2026/)).toBeNull()
  })

  it('ignores an older date response and uses only the new payment date', async () => {
    const old = pending<NbpEurQuote>()
    const eurRate = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValueOnce({ ...quote, paymentDate: '2026-09-11', rateDate: '2026-09-10', tableNumber: '176/A/NBP/2026', rate: '4.25' })
    render(<InvoiceReviewEditor {...input({ paidAt: quote.paymentDate }, { eurRate })} />)
    await waitFor(() => expect(eurRate).toHaveBeenCalledOnce())
    edit('Data zapłaty (opcjonalnie)', '2026-09-11')
    await waitFor(() => expect(field('Brutto w PLN').value).toBe('1530.85'))
    await act(async () => old.resolve(quote))
    expect(field('Brutto w PLN').value).toBe('1530.85')
    expect(screen.queryByText(/177\/A\/NBP\/2026/)).toBeNull()
  })

  it('preserves a final manual amount across source changes and requires explicit return to NBP', async () => {
    const props = input({ paidAt: quote.paymentDate })
    render(<InvoiceReviewEditor {...props} />)
    await waitFor(() => expect(field('Brutto w PLN').value).toBe('1557.07'))
    edit('Brutto w PLN', '1500,00')
    edit('Kwota do zapłaty (EUR)', '100')
    expect(field('Brutto w PLN').value).toBe('1500,00')
    expect(screen.queryByText(/177\/A\/NBP\/2026/)).toBeNull()
    expect(field('Podstawa i uwaga do przeliczenia').value).toContain('Kwota PLN ustalona ręcznie')
    fireEvent.click(confirmation())
    click('Zapisz szkic')
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ reportingGross: 1500,
      conversion: { mode: 'MANUAL_AMOUNT', paymentDate: quote.paymentDate, rate: null, rateDate: null, tableNumber: null },
    }), 1))
    click('Wróć do kursu NBP')
    await waitFor(() => expect(field('Brutto w PLN').value).toBe('432.28'))
  })

  it.each(['0', '-1', 'Infinity', 'NaN', '', '4,2,5'])('does not approve stale metadata with invalid manual rate %s but permits saving an unconfirmed draft', async (rate) => {
    const props = input({ conversion: manual, reportingGross: 1530.85, conversionConfirmed: true,
      net: 360.2, vat: 0, reportingNet: 1530.85, reportingVat: 0,
      documentType: 'INVOICE', supplierName: 'Supplier', taxId: 'DE123456789', invoiceNumber: 'EUR-1', issueDate: '2026-09-10',
      paymentStatus: 'UNPAID', costCenterId: 'JAG', tagIds: ['fixed'], conversionNote: 'Kurs ręczny 4.25',
    })
    const view = render(<InvoiceReviewEditor {...props} />)
    edit('1 EUR = … PLN', rate)
    expect(confirmation().checked).toBe(false)
    expect(confirmation().disabled).toBe(true)
    click('Zatwierdź i następna')
    expect(props.onApprove).not.toHaveBeenCalled()
    click('Zapisz szkic')
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce())
    const savedPatch = vi.mocked(props.onSave).mock.calls[0][0]
    expect(savedPatch).toMatchObject({ conversion: { ...manual, rate: null }, reportingGross: null, reportingNet: null, reportingVat: null, conversionConfirmed: false })
    const saved = { ...props.draft.data, ...savedPatch }
    view.unmount()
    const reopened = input(saved)
    render(<InvoiceReviewEditor {...reopened} />)
    expect(screen.getByRole('button', { name: 'Wpisz kurs ręcznie' }).getAttribute('aria-pressed')).toBe('true')
    expect(field('1 EUR = … PLN').value).toBe('')
    expect(field('Brutto w PLN').value).toBe('')
    expect(field('Netto w PLN').value).toBe('')
    expect(field('VAT w PLN').value).toBe('')
    expect(confirmation().disabled).toBe(true)
    expect(confirmation().checked).toBe(false)
    click('Zatwierdź i następna')
    expect(reopened.onApprove).not.toHaveBeenCalled()
    expect(reopened.eurRate).not.toHaveBeenCalled()
    expect(validateInvoiceApproval({ ...saved, reportingGross: 1530.85, conversionConfirmed: true }).ok).toBe(false)
  })

  it('saves failed NBP retry without stale PLN and reopens as incomplete NBP instead of legacy manual amount', async () => {
    const props = input({ paidAt: quote.paymentDate, conversion: { mode: 'NBP', paymentDate: quote.paymentDate, rate: quote.rate,
      rateDate: quote.rateDate, tableNumber: quote.tableNumber }, reportingGross: 1557.07, conversionConfirmed: true,
    }, { eurRate: vi.fn(async () => { throw new Error('offline') }) })
    const view = render(<InvoiceReviewEditor {...props} />)
    click('Kurs NBP')
    await waitFor(() => expect(screen.getByText(/Nie udało się pobrać kursu NBP/)).toBeTruthy())
    click('Zapisz szkic')
    await waitFor(() => expect(props.onSave).toHaveBeenCalledOnce())
    const patch = vi.mocked(props.onSave).mock.calls[0][0]
    expect(patch).toMatchObject({ conversion: null, reportingGross: null, conversionConfirmed: false })
    view.unmount()
    const reopened = input({ ...props.draft.data, ...patch }, { eurRate: props.eurRate })
    render(<InvoiceReviewEditor {...reopened} />)
    expect(screen.getByRole('button', { name: 'Kurs NBP' }).getAttribute('aria-pressed')).toBe('true')
    expect(field('Brutto w PLN').value).toBe('')
    expect(confirmation().disabled).toBe(true)
    await waitFor(() => expect(screen.getByText(/Nie udało się pobrać kursu NBP/)).toBeTruthy())
  })

  it('reopens saved manual and legacy amounts without fetching or overwriting them', () => {
    const first = input({ conversion: manual, reportingGross: 1530.85, conversionNote: 'Moja uwaga' })
    const view = render(<InvoiceReviewEditor {...first} />)
    expect(field('1 EUR = … PLN').value).toBe('4.25')
    expect(field('Brutto w PLN').value).toBe('1530.85')
    expect(field('Podstawa i uwaga do przeliczenia').value).toBe('Moja uwaga')
    expect(first.eurRate).not.toHaveBeenCalled()
    view.unmount()
    const legacy = input({ reportingGross: 1400, paidAt: quote.paymentDate, conversionNote: 'Zapisana ręcznie' })
    render(<InvoiceReviewEditor {...legacy} />)
    expect(field('Brutto w PLN').value).toBe('1400')
    expect(legacy.eurRate).not.toHaveBeenCalled()
  })
})
