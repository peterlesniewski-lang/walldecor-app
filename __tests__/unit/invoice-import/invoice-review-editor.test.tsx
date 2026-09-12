import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { InvoiceReviewEditor, type InvoiceReviewEditorProps } from '@/components/invoice-import/invoice-review-editor'
import type { InvoiceDraftData } from '@/lib/invoice-import/contracts'
import type { InvoiceDraftDetail } from '@/lib/invoice-import/client-contracts'

const tagGroups = [
  {
    id: 'kind',
    name: 'Rodzaj kosztu',
    slug: 'kind',
    tags: [
      { id: 'tag-materials', name: 'Materiały', slug: 'materials' },
      { id: 'tag-services', name: 'Usługi', slug: 'services' },
    ],
  },
]

function draft(
  data: InvoiceDraftData = {},
  overrides: Partial<InvoiceDraftDetail> = {},
): InvoiceDraftDetail {
  return {
    id: 'draft-1',
    batchId: 'batch-1',
    version: 3,
    extractionRevision: 1,
    state: 'OPEN',
    skippedAt: null,
    invoiceId: null,
    ksef: { linkedCount: 0, conflictCount: 0 },
    display: {
      fileName: 'faktura.pdf',
      supplierName: data.supplierName ?? null,
      invoiceNumber: data.invoiceNumber ?? null,
      gross: data.gross ?? null,
      currency: data.currency ?? null,
    },
    latestJob: null,
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:00:00.000Z',
    data,
    manualFields: [],
    attachment: {
      id: 'attachment-1',
      sha256: 'a'.repeat(64),
      originalName: 'faktura.pdf',
      mimeType: 'application/pdf',
      byteSize: 1234,
      pageCount: 1,
      state: 'READY',
      createdAt: '2026-09-11T08:00:00.000Z',
      updatedAt: '2026-09-11T08:00:00.000Z',
    },
    ...overrides,
  }
}

function props(overrides: Partial<InvoiceReviewEditorProps> = {}): InvoiceReviewEditorProps {
  return {
    draft: draft(),
    costCenters: [
      { id: 'JAG', name: 'Jagielońska' },
      { id: 'PUL', name: 'Puławska' },
      { id: 'GLOBAL', name: 'Globalne' },
    ],
    tagGroups,
    rules: [],
    busy: false,
    onSave: vi.fn().mockResolvedValue(undefined),
    onApprove: vi.fn().mockResolvedValue(undefined),
    onRevoke: vi.fn().mockResolvedValue(undefined),
    onAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('InvoiceReviewEditor', () => {
  it('explains a KSeF approval block without blocking saving corrections or revoking an existing cost', async () => {
    const reason = 'Rozstrzygnij różnice z KSeF przed zatwierdzeniem kosztu.'
    const input = props({ approvalBlockReason: reason })
    const view = render(<InvoiceReviewEditor {...input} />)
    expect((screen.getByRole('button', { name: 'Zatwierdź i następna' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(reason)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Zapisz szkic' }) as HTMLButtonElement).disabled).toBe(false)
    view.rerender(<InvoiceReviewEditor {...input} approvalBlockReason={null} />)
    expect((screen.getByRole('button', { name: 'Zatwierdź i następna' }) as HTMLButtonElement).disabled).toBe(false)
    view.unmount()
    render(<InvoiceReviewEditor {...props({ draft: draft({}, { state: 'APPROVED', invoiceId: 'invoice' }), approvalBlockReason: reason })} />)
    expect((screen.getByRole('button', { name: 'Cofnij z kosztów' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps unknown values empty and renders an explicit zero without invention', () => {
    render(<InvoiceReviewEditor {...props({ draft: draft({ gross: 0 }) })} />)

    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('0')
    expect((screen.getByLabelText('Data wystawienia') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Waluta') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'Status płatności' }).textContent).toContain('Wybierz')
  })

  it('saves only edited fields and represents an explicitly cleared value as null', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<InvoiceReviewEditor {...props({
      draft: draft({ supplierName: 'Dostawca', net: 100, gross: 0 }),
      onSave,
    })} />)

    const supplier = screen.getByLabelText('Nazwa dostawcy')
    await user.clear(supplier)
    await user.type(supplier, 'Poprawiony dostawca')
    await user.click(screen.getByText('Dane szczegółowe'))
    await user.clear(screen.getByLabelText('Kwota netto'))
    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      { supplierName: 'Poprawiony dostawca', net: null },
      3,
    ))
  })

  it('invalidates an FX confirmation on basis edits and records only a later explicit reconfirmation', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<InvoiceReviewEditor {...props({
      draft: draft({
        currency: 'EUR',
        gross: 100,
        reportingGross: 425,
        conversionNote: 'Kurs NBP z dnia poprzedniego',
        conversionConfirmed: true,
      }),
      onSave,
    })} />)

    const confirmation = screen.getByRole('checkbox', { name: /potwierdzam przeliczenie/i })
    expect((confirmation as HTMLInputElement).checked).toBe(true)

    const gross = screen.getByLabelText('Kwota brutto')
    await user.clear(gross)
    await user.type(gross, '101')
    expect((confirmation as HTMLInputElement).checked).toBe(false)

    await user.click(confirmation)
    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      { gross: 101, conversionConfirmed: true },
      3,
    ))
  })

  it('shows Polish server issues beside fields and never exposes their internal codes', () => {
    render(<InvoiceReviewEditor {...props({
      draft: draft({ gross: 125 }),
      issues: [{ field: 'gross', code: 'AMOUNT_MISMATCH_INTERNAL', messagePolish: 'Kwota brutto nie zgadza się z sumą pozycji.' }],
    })} />)

    const gross = screen.getByLabelText('Kwota brutto')
    expect(gross.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getAllByText('Kwota brutto nie zgadza się z sumą pozycji.').length).toBeGreaterThan(0)
    expect(screen.queryByText('AMOUNT_MISMATCH_INTERNAL')).toBeNull()
  })

  it('keeps supplier classification as a suggestion until the administrator applies it', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<InvoiceReviewEditor {...props({
      draft: draft({ supplierName: 'Papier GmbH', taxId: 'DE 123-ABC' }),
      rules: [{
        id: 'paper-rule',
        active: true,
        supplierNip: 'DE123ABC',
        supplierNamePattern: null,
        priority: 1,
        costCenterId: 'PUL',
        tagIds: ['tag-materials'],
      }],
      onSave,
    })} />)

    expect(screen.getByRole('button', { name: 'Miejsce kosztu' }).textContent).toContain('Wybierz')
    expect(screen.getByRole('button', { name: 'Materiały' }).getAttribute('aria-pressed')).toBe('false')
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Użyj podpowiedzi' }))
    expect(screen.getByRole('button', { name: 'Miejsce kosztu' }).textContent).toContain('Puławska')
    expect(screen.getByRole('button', { name: 'Materiały' }).getAttribute('aria-pressed')).toBe('true')
    expect(onSave).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      { costCenterId: 'PUL', tagIds: ['tag-materials'] },
      3,
    ))
  })

  it('shows the effective rebased values before saving only the real manual patch on the latest version', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const initial = draft({ supplierName: 'Odczyt 1', gross: 100 }, { version: 1 })
    const editorProps = props({ draft: initial, onSave })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    const supplier = screen.getByLabelText('Nazwa dostawcy')
    await user.clear(supplier)
    await user.type(supplier, 'Poprawka ręczna')

    const latest = draft({ supplierName: 'Odczyt 2', gross: 120 }, { version: 2 })
    rerender(<InvoiceReviewEditor {...editorProps} draft={latest} />)

    expect((screen.getByLabelText('Nazwa dostawcy') as HTMLInputElement).value).toBe('Poprawka ręczna')
    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('100')
    expect(screen.getByRole('status').textContent).toContain('nowsza wersja')
    expect((screen.getByRole('button', { name: 'Zatwierdź i następna' }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Zapisz moje poprawki na aktualnej wersji' }))
    expect(onSave).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Nazwa dostawcy') as HTMLInputElement).value).toBe('Poprawka ręczna')
    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('120')

    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ supplierName: 'Poprawka ręczna' }, 2))
  })

  it('never confirms a polled FX basis that was not visible when the administrator checked confirmation', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const initial = draft({ currency: 'EUR', gross: 100, reportingGross: 425, conversionConfirmed: false }, { version: 1 })
    const editorProps = props({ draft: initial, onSave })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    const confirmation = screen.getByRole('checkbox', { name: /potwierdzam przeliczenie/i })
    await user.click(confirmation)
    expect((confirmation as HTMLInputElement).checked).toBe(true)

    const latest = draft({ currency: 'EUR', gross: 200, reportingGross: 850, conversionConfirmed: false }, { version: 2 })
    rerender(<InvoiceReviewEditor {...editorProps} draft={latest} />)
    await user.click(screen.getByRole('button', { name: 'Zapisz moje poprawki na aktualnej wersji' }))

    expect(onSave).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('200')
    expect((screen.getByRole('checkbox', { name: /potwierdzam przeliczenie/i }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('status').textContent).toMatch(/ponownego potwierdzenia/i)
    expect(screen.getByRole('status').textContent).toMatch(/200/)

    await user.click(screen.getByRole('checkbox', { name: /potwierdzam przeliczenie/i }))
    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ conversionConfirmed: true }, 2))
  })

  it('does not require an FX confirmation after editing a staged PLN basis', async () => {
    const user = userEvent.setup()
    const initial = draft({ currency: 'PLN', gross: 100, supplierName: 'Odczyt 1' }, { version: 1 })
    const editorProps = props({ draft: initial })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.clear(screen.getByLabelText('Nazwa dostawcy'))
    await user.type(screen.getByLabelText('Nazwa dostawcy'), 'Poprawka ręczna')
    rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ currency: 'PLN', gross: 120, supplierName: 'Odczyt 2' }, { version: 2 })} />)
    await user.click(screen.getByRole('button', { name: 'Zapisz moje poprawki na aktualnej wersji' }))

    await user.clear(screen.getByLabelText('Kwota brutto'))
    await user.type(screen.getByLabelText('Kwota brutto'), '121')
    expect((screen.getByRole('button', { name: 'Zatwierdź i następna' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not gate approval when polling replaces an explicitly confirmed EUR basis with PLN', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn().mockResolvedValue(undefined)
    const initial = draft({ currency: 'EUR', gross: 100, conversionConfirmed: false }, { version: 1 })
    const editorProps = props({ draft: initial, onApprove })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.click(screen.getByRole('checkbox', { name: /potwierdzam przeliczenie/i }))
    rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ currency: 'PLN', gross: 200, conversionConfirmed: false }, { version: 2 })} />)
    await user.click(screen.getByRole('button', { name: 'Zapisz moje poprawki na aktualnej wersji' }))

    expect((screen.getByLabelText('Waluta') as HTMLInputElement).value).toBe('PLN')
    expect(screen.queryByRole('checkbox', { name: /potwierdzam przeliczenie/i })).toBeNull()
    const approve = screen.getByRole('button', { name: 'Zatwierdź i następna' }) as HTMLButtonElement
    expect(approve.disabled).toBe(false)

    await user.click(approve)
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({}, 2))
  })

  it('does not display a latest-server confirmation on a retained local nominal basis it never confirmed', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const initial = draft({ currency: 'EUR', gross: 100, conversionConfirmed: false }, { version: 1 })
    const editorProps = props({ draft: initial, onSave })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.clear(screen.getByLabelText('Kwota brutto'))
    await user.type(screen.getByLabelText('Kwota brutto'), '101')
    rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ currency: 'EUR', gross: 200, conversionConfirmed: true }, { version: 2 })} />)
    await user.click(screen.getByRole('button', { name: 'Zapisz moje poprawki na aktualnej wersji' }))

    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('101')
    expect((screen.getByRole('checkbox', { name: /potwierdzam przeliczenie/i }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('status').textContent).toMatch(/ponownego potwierdzenia/i)

    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ gross: 101, conversionConfirmed: false }, 2))
  })

  it('loads the latest polled data only after explicit confirmation to discard local edits', async () => {
    const user = userEvent.setup()
    const initial = draft({ supplierName: 'Odczyt 1', gross: 100 }, { version: 1 })
    const editorProps = props({ draft: initial })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.clear(screen.getByLabelText('Nazwa dostawcy'))
    await user.type(screen.getByLabelText('Nazwa dostawcy'), 'Poprawka ręczna')
    rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ supplierName: 'Odczyt 2', gross: 120 }, { version: 2 })} />)

    await user.click(screen.getByRole('button', { name: 'Wczytaj aktualne dane' }))
    expect((screen.getByLabelText('Nazwa dostawcy') as HTMLInputElement).value).toBe('Odczyt 2')
    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('120')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reveals an invalid FX value after currency changes to PLN instead of leaving a hidden validation dead end', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<InvoiceReviewEditor {...props({
      draft: draft({ currency: 'EUR', reportingGross: 425 }),
      onSave,
    })} />)

    const reportingGross = screen.getByLabelText('Brutto w PLN')
    await user.clear(reportingGross)
    await user.type(reportingGross, 'oops')
    await user.clear(screen.getByLabelText('Waluta'))
    await user.type(screen.getByLabelText('Waluta'), 'PLN')
    expect(screen.queryByLabelText('Brutto w PLN')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))

    expect(onSave).not.toHaveBeenCalled()
    const revealed = screen.getByLabelText('Brutto w PLN')
    expect(revealed.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(/wpisz poprawną kwotę/i)).toBeTruthy()
  })

  it('reveals an invalid payment date after status changes away from paid', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<InvoiceReviewEditor {...props({ draft: draft({ paymentStatus: 'PAID' }), onSave })} />)

    await user.type(screen.getByLabelText('Data zapłaty (opcjonalnie)'), 'nie-data')
    // Await Radix's portal mount before continuing with userEvent interactions.
    await act(async () => {
      const trigger = screen.getByRole('button', { name: 'Status płatności' })
      trigger.focus()
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    })
    await user.click(screen.getByRole('menuitemradio', { name: 'Niezapłacona' }))
    await waitFor(() => expect(screen.queryByRole('menuitemradio', { name: 'Niezapłacona' })).toBeNull())
    expect(screen.queryByLabelText('Data zapłaty (opcjonalnie)')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))

    expect(onSave).not.toHaveBeenCalled()
    const revealed = screen.getByLabelText('Data zapłaty (opcjonalnie)')
    expect(revealed.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(/wpisz datę w formacie/i)).toBeTruthy()
  })

  it.each(['APPROVED', 'BUSY'] as const)(
    'closes an open choice menu and prevents changes when the editor becomes %s',
    async (transition) => {
      const user = userEvent.setup()
      const initial = draft({ paymentStatus: 'PAID' }, { version: 1 })
      const editorProps = props({ draft: initial })
      const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

      await user.click(screen.getByRole('button', { name: 'Status płatności' }))
      expect(screen.getByRole('menuitemradio', { name: 'Niezapłacona' })).toBeTruthy()

      if (transition === 'APPROVED') {
        rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ paymentStatus: 'PAID' }, { state: 'APPROVED', version: 2, invoiceId: 'invoice-1' })} />)
      } else {
        rerender(<InvoiceReviewEditor {...editorProps} busy />)
      }

      expect(screen.queryByRole('menuitemradio', { name: 'Niezapłacona' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Status płatności' }).textContent).toContain('Zapłacona')
    },
  )

  it('opens collapsed details when an invalid detailed field blocks saving', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<InvoiceReviewEditor {...props({ onSave })} />)

    const summary = screen.getByText('Dane szczegółowe')
    await user.click(summary)
    await user.type(screen.getByLabelText('Kwota netto'), 'oops')
    await user.click(summary)
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))

    expect(onSave).not.toHaveBeenCalled()
    await waitFor(() => expect(details.open).toBe(true))
    expect(screen.getByLabelText('Kwota netto').getAttribute('aria-invalid')).toBe('true')
    expect(within(details).getByText(/wpisz poprawną kwotę/i)).toBeTruthy()
  })

  it('guards rebase when a dirty draft becomes approved', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    const initial = draft({ supplierName: 'Odczyt 1' }, { version: 1 })
    const editorProps = props({ draft: initial, onSave })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.clear(screen.getByLabelText('Nazwa dostawcy'))
    await user.type(screen.getByLabelText('Nazwa dostawcy'), 'Lokalna poprawka')
    rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ supplierName: 'Zatwierdzony dostawca' }, { state: 'APPROVED', version: 2, invoiceId: 'invoice-1' })} />)

    const rebase = screen.getByRole('button', { name: 'Zapisz moje poprawki na aktualnej wersji' }) as HTMLButtonElement
    expect(rebase.disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/nie jest już szkicem/i)

    rebase.removeAttribute('disabled')
    fireEvent.click(rebase)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('guards revoke until dirty pre-approval values are discarded and the approved values are visible', async () => {
    const user = userEvent.setup()
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    const initial = draft({ gross: 100, supplierName: 'Odczyt 1' }, { version: 1 })
    const editorProps = props({ draft: initial, onRevoke })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.clear(screen.getByLabelText('Nazwa dostawcy'))
    await user.type(screen.getByLabelText('Nazwa dostawcy'), 'Lokalna poprawka')
    rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ gross: 200, supplierName: 'Zatwierdzony dostawca' }, { state: 'APPROVED', version: 2, invoiceId: 'invoice-1' })} />)

    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('100')
    const revoke = screen.getByRole('button', { name: 'Cofnij z kosztów' }) as HTMLButtonElement
    expect(revoke.disabled).toBe(true)
    expect(screen.getByText(/wczytaj aktualne dane, aby zobaczyć zatwierdzone wartości/i)).toBeTruthy()

    revoke.removeAttribute('disabled')
    fireEvent.click(revoke)
    expect(onRevoke).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Wczytaj aktualne dane' }))
    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('200')
    expect((screen.getByRole('button', { name: 'Cofnij z kosztów' }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Cofnij z kosztów' }))
    expect(onRevoke).toHaveBeenCalledWith(2)
  })

  it('disables restore after a dirty archive transition until latest data is explicitly loaded', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    const initial = draft({ supplierName: 'Odczyt 1' }, { version: 1 })
    const editorProps = props({ draft: initial, onAction })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.clear(screen.getByLabelText('Nazwa dostawcy'))
    await user.type(screen.getByLabelText('Nazwa dostawcy'), 'Lokalna poprawka')
    rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ supplierName: 'Wersja archiwalna' }, { state: 'ARCHIVED', version: 2 })} />)

    const restore = screen.getByRole('button', { name: 'Przywróć szkic' }) as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    expect(screen.getByText(/wczytaj aktualne dane, aby odrzucić lokalne poprawki/i)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Wczytaj aktualne dane' }))
    expect((screen.getByRole('button', { name: 'Przywróć szkic' }) as HTMLButtonElement).disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Przywróć szkic' }))
    expect(onAction).toHaveBeenCalledWith('RESTORE', 2)
  })

  it('retains the visible rebase and manual edits when saving the staged patch fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockRejectedValue(new Error('network'))
    const initial = draft({ supplierName: 'Odczyt 1', gross: 100 }, { version: 1 })
    const editorProps = props({ draft: initial, onSave })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.clear(screen.getByLabelText('Nazwa dostawcy'))
    await user.type(screen.getByLabelText('Nazwa dostawcy'), 'Poprawka ręczna')
    rerender(<InvoiceReviewEditor {...editorProps} draft={draft({ supplierName: 'Odczyt 2', gross: 120 }, { version: 2 })} />)
    await user.click(screen.getByRole('button', { name: 'Zapisz moje poprawki na aktualnej wersji' }))
    await user.click(screen.getByRole('button', { name: 'Zapisz szkic' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/nie udało się zapisać szkicu/i))
    expect((screen.getByLabelText('Nazwa dostawcy') as HTMLInputElement).value).toBe('Poprawka ręczna')
    expect((screen.getByLabelText('Kwota brutto') as HTMLInputElement).value).toBe('120')
    expect((screen.getByRole('button', { name: 'Pomiń na teraz' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('makes an approved draft read-only and clearly offers revocation from active costs', async () => {
    const user = userEvent.setup()
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    render(<InvoiceReviewEditor {...props({
      draft: draft({ supplierName: 'Dostawca' }, { state: 'APPROVED', version: 7, invoiceId: 'invoice-1' }),
      onRevoke,
    })} />)

    expect((screen.getByLabelText('Nazwa dostawcy') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Zapisz szkic' })).toBeNull()
    expect(screen.getByText(/zachowuje ten sam dokument i pełną historię/i)).toBeTruthy()
    expect(screen.getByText(/nie wykonuje ani nie cofa przelewu bankowego/i)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Cofnij z kosztów' }))
    expect(onRevoke).toHaveBeenCalledWith(7)
  })

  it('explains that a reopened legacy invoice remains outside active costs until reapproval', () => {
    render(<InvoiceReviewEditor {...props({
      draft: draft({ gross: 100 }, { invoiceId: 'invoice-legacy' }),
    })} />)

    expect(screen.getByText(/poprzedni koszt został unieważniony/i)).toBeTruthy()
    expect(screen.getByText(/poza aktywnymi kosztami/i)).toBeTruthy()
    expect(screen.getByText(/do czasu ponownego zatwierdzenia/i)).toBeTruthy()
    expect(screen.getByText(/historia dokumentu pozostaje zachowana/i)).toBeTruthy()
    expect(screen.queryByText(/aktywne sumy korzystają/i)).toBeNull()
  })

  it('runs draft-only actions only without edits and restores archived drafts', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn().mockResolvedValue(undefined)
    const editorProps = props({ onAction })
    const { rerender } = render(<InvoiceReviewEditor {...editorProps} />)

    await user.click(screen.getByRole('button', { name: 'Pomiń na teraz' }))
    await user.click(screen.getByRole('button', { name: 'Odczytaj ponownie' }))
    await user.click(screen.getByRole('button', { name: 'Archiwizuj szkic' }))
    expect(onAction.mock.calls).toEqual([
      ['SKIP', 3],
      ['EXTRACT', 3],
      ['ARCHIVE', 3],
    ])

    await user.click(screen.getByText('Dane szczegółowe'))
    await user.type(screen.getByLabelText('Uwagi'), 'Do sprawdzenia')
    expect((screen.getByRole('button', { name: 'Pomiń na teraz' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/najpierw zapisz poprawki/i)).toBeTruthy()

    rerender(<InvoiceReviewEditor key="archived" {...editorProps} draft={draft({}, { id: 'draft-archived', state: 'ARCHIVED', version: 9 })} />)
    const archived = screen.getByRole('region', { name: 'Dane faktury' })
    await user.click(within(archived).getByRole('button', { name: 'Przywróć szkic' }))
    expect(onAction).toHaveBeenLastCalledWith('RESTORE', 9)
  })
})
