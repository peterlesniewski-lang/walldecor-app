import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  InvoiceKsefReconciliationPanel,
  type InvoiceKsefReconciliationPanelProps,
} from '@/components/invoice-import/invoice-ksef-reconciliation-panel'
import type { InvoiceDraftKsefReconciliation } from '@/lib/invoice-import/client-contracts'

type Link = InvoiceDraftKsefReconciliation['links'][number]
const KEEP = 'Zachowaj moje dane'
const APPLY = 'Przyjmij dane KSeF do szkicu'
const RETRY = 'Ponów sprawdzenie KSeF'

function link(overrides: Partial<Link> = {}): Link {
  return {
    id: 'link-1',
    externalId: '1234567890-20260912-ABCDEF123456-01',
    version: 2,
    status: 'CONFLICT',
    approvalBlocked: true,
    differences: [{ field: 'gross', localValue: 123, ksefValue: 125 }],
    snapshot: {
      externalId: '1234567890-20260912-ABCDEF123456-01',
      documentStatus: 'ACTIVE',
      data: {
        documentType: 'INVOICE', supplierName: 'Dostawca bez różnicy', taxId: '1234567890',
        invoiceNumber: 'FV/2026/9/12', issueDate: '2026-09-12', currency: 'PLN',
        gross: 125, net: 100, vat: 25, dueDate: null, bankAccount: null,
        paymentStatus: 'UNKNOWN', paidAt: null,
      },
    },
    createdAt: '2026-09-12T08:00:00.000Z',
    updatedAt: '2026-09-12T08:00:00.000Z',
    ...overrides,
  }
}

function reconciliation(overrides: Partial<InvoiceDraftKsefReconciliation> = {}): InvoiceDraftKsefReconciliation {
  return { draftId: 'draft-1', draftVersion: 3, draftState: 'OPEN', links: [link()], ...overrides }
}

function props(overrides: Partial<InvoiceKsefReconciliationPanelProps> = {}): InvoiceKsefReconciliationPanelProps {
  return {
    draft: { id: 'draft-1', version: 3, state: 'OPEN' },
    reconciliation: reconciliation(),
    localCurrency: 'PLN',
    loading: false,
    error: null,
    dirty: false,
    busy: false,
    onRetry: vi.fn(),
    onResolve: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

describe('InvoiceKsefReconciliationPanel', () => {
  it('compares only different fields without making an automatic choice', () => {
    const panelProps = props()
    render(<InvoiceKsefReconciliationPanel {...panelProps} />)

    expect(screen.getByRole('heading', { name: 'Porównanie z KSeF' })).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Dane zapisane' })).toBeTruthy()
    expect(within(table).getByRole('columnheader', { name: 'KSeF' })).toBeTruthy()
    expect(within(table).getByText('Kwota brutto')).toBeTruthy()
    expect(screen.queryByText('Dostawca bez różnicy')).toBeNull()
    expect(screen.queryByText('Nazwa dostawcy')).toBeNull()
    expect(panelProps.onResolve).not.toHaveBeenCalled()
    expect(screen.getByText(/oryginał i klasyfikacja kosztu pozostają zachowane/i)).toBeTruthy()
    expect(screen.getByText(/sam wybór nie tworzy kosztu ani przelewu/i)).toBeTruthy()
  })

  it.each([[KEEP, 'KEEP_LOCAL'], [APPLY, 'APPLY_TO_DRAFT']] as const)(
    'maps the explicit choice %s to its reconciliation and action', async (label, action) => {
      const user = userEvent.setup()
      const onResolve = vi.fn().mockResolvedValue(undefined)
      render(<InvoiceKsefReconciliationPanel {...props({ onResolve })} />)

      await user.click(button(label))

      expect(onResolve).toHaveBeenCalledExactlyOnceWith('link-1', action)
    },
  )

  it('requires saving or discarding local edits before either decision', async () => {
    const user = userEvent.setup()
    const panelProps = props({ dirty: true })
    render(<InvoiceKsefReconciliationPanel {...panelProps} />)

    expect(button(KEEP).disabled).toBe(true)
    expect(button(APPLY).disabled).toBe(true)
    expect(screen.getByText(/zapisz lub odrzuć.*zmiany/i)).toBeTruthy()
    await user.click(button(KEEP))
    await user.click(button(APPLY))
    expect(panelProps.onResolve).not.toHaveBeenCalled()
  })

  it('locks all decisions and retry while the parent is busy', async () => {
    const user = userEvent.setup()
    const panelProps = props({ busy: true })
    render(<InvoiceKsefReconciliationPanel {...panelProps} />)

    for (const label of [KEEP, APPLY, RETRY]) {
      expect(button(label).disabled).toBe(true)
      await user.click(button(label))
    }
    expect(panelProps.onResolve).not.toHaveBeenCalled()
    expect(panelProps.onRetry).not.toHaveBeenCalled()
  })

  it('allows only KEEP for approved drafts and explains revoking the cost first', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn().mockResolvedValue(undefined)
    render(<InvoiceKsefReconciliationPanel {...props({
      draft: { id: 'draft-1', version: 3, state: 'APPROVED' },
      reconciliation: reconciliation({ draftState: 'APPROVED' }), onResolve,
    })} />)

    expect(button(KEEP).disabled).toBe(false)
    expect(button(APPLY).disabled).toBe(true)
    expect(screen.getByText('Aby przyjąć dane KSeF, najpierw wybierz „Cofnij z kosztów”.')).toBeTruthy()
    await user.click(button(APPLY))
    expect(onResolve).not.toHaveBeenCalled()
    await user.click(button(KEEP))
    expect(onResolve).toHaveBeenCalledExactlyOnceWith('link-1', 'KEEP_LOCAL')
  })

  it('requires restoring an archived draft before choosing', () => {
    render(<InvoiceKsefReconciliationPanel {...props({
      draft: { id: 'draft-1', version: 3, state: 'ARCHIVED' },
      reconciliation: reconciliation({ draftState: 'ARCHIVED' }),
    })} />)

    expect(button(KEEP).disabled).toBe(true)
    expect(button(APPLY).disabled).toBe(true)
    expect(screen.getByText(/przywróć.*z archiwum/i)).toBeTruthy()
  })

  it.each(['CORRECTION', 'CORRECTED', 'CANCELLED'] as const)(
    'disables both decisions for a %s KSeF document', (documentStatus) => {
      render(<InvoiceKsefReconciliationPanel {...props({ reconciliation: reconciliation({
        links: [link({ snapshot: { ...link().snapshot, documentStatus } })],
      }) })} />)

      expect(button(KEEP).disabled).toBe(true)
      expect(button(APPLY).disabled).toBe(true)
      expect(screen.getByText('Ten dokument KSeF wymaga osobnej obsługi. Nie można zatwierdzić go jako zwykłego kosztu.')).toBeTruthy()
    },
  )

  it.each([
    { draftId: 'old-draft' },
    { draftVersion: 2 },
    { draftState: 'APPROVED' as const },
  ])('hides stale comparisons and disables decisions for stale %j', (staleData) => {
    render(<InvoiceKsefReconciliationPanel {...props({ reconciliation: reconciliation(staleData) })} />)

    expect(screen.queryByRole('table')).toBeNull()
    expect(button(KEEP).disabled).toBe(true)
    expect(button(APPLY).disabled).toBe(true)
    expect(screen.getByText(/porównanie dotyczy wcześniejszej wersji lub innego stanu dokumentu/i)).toBeTruthy()
    expect(button(RETRY).disabled).toBe(false)
  })

  it('shows meaningful loading and disables existing decisions', () => {
    render(<InvoiceKsefReconciliationPanel {...props({ loading: true })} />)

    expect(screen.getByText('Sprawdzanie powiązania i różnic z KSeF…')).toBeTruthy()
    expect(button(KEEP).disabled).toBe(true)
    expect(button(APPLY).disabled).toBe(true)
    expect(button(RETRY).disabled).toBe(true)
  })

  it('shows a controlled loading error and retries without resolving', async () => {
    const user = userEvent.setup()
    const panelProps = props({ error: 'Nie można teraz odczytać danych KSeF.' })
    render(<InvoiceKsefReconciliationPanel {...panelProps} />)

    expect(screen.getByRole('alert').textContent).toContain('Nie można teraz odczytać danych KSeF.')
    expect(button(KEEP).disabled).toBe(true)
    expect(button(APPLY).disabled).toBe(true)
    await user.click(button(RETRY))
    expect(panelProps.onRetry).toHaveBeenCalledExactlyOnceWith()
    expect(panelProps.onResolve).not.toHaveBeenCalled()
  })

  it('distinguishes no KSeF links from a missing response', () => {
    const panelProps = props({ reconciliation: reconciliation({ links: [] }) })
    const { rerender } = render(<InvoiceKsefReconciliationPanel {...panelProps} />)

    expect(screen.getByText('Brak powiązania z KSeF')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: KEEP })).toBeNull()
    rerender(<InvoiceKsefReconciliationPanel {...panelProps} reconciliation={null} />)
    expect(screen.queryByText('Brak powiązania z KSeF')).toBeNull()
    expect(screen.getByText(/porównanie z KSeF nie zostało jeszcze wczytane/i)).toBeTruthy()
  })

  it('identifies multiple documents by their full external IDs and resolves the chosen one', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn().mockResolvedValue(undefined)
    const second = link({ id: 'link-2', externalId: '1234567890-20260912-ABCDEF123456-02' })
    render(<InvoiceKsefReconciliationPanel {...props({
      reconciliation: reconciliation({ links: [link(), second] }), onResolve,
    })} />)

    expect(screen.getByRole('heading', { name: `Dokument KSeF ${link().externalId}` })).toBeTruthy()
    const secondSection = screen.getByRole('region', { name: `Dokument KSeF ${second.externalId}` })
    await user.click(within(secondSection).getByRole('button', { name: APPLY }))
    expect(onResolve).toHaveBeenCalledExactlyOnceWith('link-2', 'APPLY_TO_DRAFT')
  })

  it.each([
    ['MATCHED', 'Dane zgodne z KSeF'],
    ['APPLIED_TO_DRAFT', 'Dane KSeF przyjęte do szkicu'],
  ] as const)('shows the %s result without unnecessary decisions', (status, message) => {
    render(<InvoiceKsefReconciliationPanel {...props({ reconciliation: reconciliation({
      links: [link({ status, approvalBlocked: false, differences: [] })],
    }) })} />)

    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByRole('button', { name: KEEP })).toBeNull()
    expect(screen.queryByRole('button', { name: APPLY })).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('preserves the differences after KEEP without claiming the data match', () => {
    render(<InvoiceKsefReconciliationPanel {...props({ reconciliation: reconciliation({
      links: [link({ status: 'KEPT_LOCAL', approvalBlocked: false })],
    }) })} />)

    expect(screen.getByText('Zachowano dane administratora')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('Kwota brutto')).toBeTruthy()
    expect(screen.queryByText('Dane zgodne z KSeF')).toBeNull()
    expect(button(APPLY).disabled).toBe(false)
  })

  it('shows two decimal places and each side’s currency for gross, net and VAT', () => {
    render(<InvoiceKsefReconciliationPanel {...props({
      localCurrency: 'EUR',
      reconciliation: reconciliation({ links: [link({
        differences: [
          { field: 'gross', localValue: 1234.5, ksefValue: 5432.1 },
          { field: 'net', localValue: 1000, ksefValue: 4000 },
          { field: 'vat', localValue: 234.5, ksefValue: 1432.1 },
        ],
      })] }),
    })} />)

    for (const amount of [/^1\s234,50 EUR$/, /^5\s432,10 PLN$/, /^1\s000,00 EUR$/, /^4\s000,00 PLN$/, /^234,50 EUR$/, /^1\s432,10 PLN$/]) {
      expect(screen.getByText(amount)).toBeTruthy()
    }
    for (const label of ['Kwota brutto', 'Kwota netto', 'Kwota VAT']) expect(screen.getByText(label)).toBeTruthy()
  })

  it('does not invent a currency when the local currency is missing', () => {
    render(<InvoiceKsefReconciliationPanel {...props({ localCurrency: null })} />)
    expect(screen.getByText('123,00 (brak waluty)')).toBeTruthy()
    expect(screen.getByText('125,00 PLN')).toBeTruthy()
  })

  it('renders full tax IDs, Polish enums, missing data and calendar dates without shifting days', () => {
    render(<InvoiceKsefReconciliationPanel {...props({ reconciliation: reconciliation({ links: [link({
      differences: [
        { field: 'taxId', localValue: 'DE 123-456-789-ABC', ksefValue: 'PL 987-654-321-XYZ' },
        { field: 'paymentStatus', localValue: 'UNKNOWN', ksefValue: 'PAID' },
        { field: 'documentType', localValue: 'PROFORMA', ksefValue: 'INVOICE' },
        { field: 'bankAccount', localValue: null, ksefValue: 'PL00111122223333444455556666' },
        { field: 'issueDate', localValue: '2026-03-29', ksefValue: '2026-10-25' },
      ],
    })] }) })} />)

    for (const value of ['DE 123-456-789-ABC', 'PL 987-654-321-XYZ', 'Nieustalony', 'Zapłacona', 'Pro forma', 'Faktura', 'Brak danych', '29.03.2026', '25.10.2026']) {
      expect(screen.getByText(value)).toBeTruthy()
    }
    expect(screen.queryByText('UNKNOWN')).toBeNull()
    expect(screen.queryByText('PAID')).toBeNull()
  })

  it('prevents double clicks and locks decisions plus retry until the callback settles', async () => {
    let finish!: () => void
    const onResolve = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const panelProps = props({ onResolve })
    render(<InvoiceKsefReconciliationPanel {...panelProps} />)

    act(() => {
      fireEvent.click(button(KEEP))
      fireEvent.click(button(KEEP))
      fireEvent.click(button(APPLY))
      fireEvent.click(button(RETRY))
    })

    expect(onResolve).toHaveBeenCalledExactlyOnceWith('link-1', 'KEEP_LOCAL')
    expect(panelProps.onRetry).not.toHaveBeenCalled()
    for (const name of [KEEP, APPLY, RETRY]) expect(button(name).disabled).toBe(true)
    expect(screen.getByText('Zapisywanie wyboru…')).toBeTruthy()
    await act(async () => { finish() })
    expect(button(KEEP).disabled).toBe(false)
  })

  it('catches rejected decisions visibly and clears the local failure on retry', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<InvoiceKsefReconciliationPanel {...props({
      onResolve: vi.fn().mockRejectedValue(new Error('INTERNAL_RESOLUTION_ERROR')),
      onRetry,
    })} />)

    await user.click(button(APPLY))

    expect(screen.getByRole('alert').textContent).toMatch(/nie udało się zapisać wyboru/i)
    expect(screen.queryByText('INTERNAL_RESOLUTION_ERROR')).toBeNull()
    expect(button(RETRY).disabled).toBe(false)
    await user.click(button(RETRY))
    expect(onRetry).toHaveBeenCalledExactlyOnceWith()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears the local resolution error when the draft version changes', async () => {
    const user = userEvent.setup()
    const panelProps = props({ onResolve: vi.fn().mockRejectedValue(new Error('failed')) })
    const { rerender } = render(<InvoiceKsefReconciliationPanel {...panelProps} />)
    await user.click(button(KEEP))
    expect(screen.getByRole('alert')).toBeTruthy()

    rerender(<InvoiceKsefReconciliationPanel {...panelProps}
      draft={{ ...panelProps.draft, version: 4 }}
      reconciliation={reconciliation({ draftVersion: 4 })}
    />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    { id: 'draft-2', version: 3, state: 'OPEN' as const },
    { id: 'draft-1', version: 4, state: 'OPEN' as const },
    { id: 'draft-1', version: 3, state: 'APPROVED' as const },
  ])('does not resurrect a cleared failure after switching to %j and returning', async (otherDraft) => {
    const user = userEvent.setup()
    const panelProps = props({ onResolve: vi.fn().mockRejectedValue(new Error('failed')) })
    const { rerender } = render(<InvoiceKsefReconciliationPanel {...panelProps} />)
    await user.click(button(KEEP))
    expect(screen.getByRole('alert')).toBeTruthy()

    rerender(<InvoiceKsefReconciliationPanel {...panelProps}
      draft={otherDraft}
      reconciliation={reconciliation({
        draftId: otherDraft.id, draftVersion: otherDraft.version, draftState: otherDraft.state,
      })}
    />)
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<InvoiceKsefReconciliationPanel {...panelProps} />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores the previous selection’s late rejection after switching away and returning', async () => {
    let fail!: (error: Error) => void
    const panelProps = props({
      onResolve: vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject })),
    })
    const { rerender } = render(<InvoiceKsefReconciliationPanel {...panelProps} />)
    fireEvent.click(button(KEEP))
    rerender(<InvoiceKsefReconciliationPanel {...panelProps}
      draft={{ id: 'draft-2', version: 1, state: 'OPEN' }}
      reconciliation={reconciliation({ draftId: 'draft-2', draftVersion: 1 })}
    />)
    rerender(<InvoiceKsefReconciliationPanel {...panelProps} />)

    await act(async () => { fail(new Error('Previous selection failed')) })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(button(KEEP).disabled).toBe(false)
  })

  it('does not show a late failure from the previous draft on a newly selected draft', async () => {
    let fail!: (error: Error) => void
    const onResolve = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject }))
    const panelProps = props({ onResolve })
    const { rerender } = render(<InvoiceKsefReconciliationPanel {...panelProps} />)
    fireEvent.click(button(KEEP))
    rerender(<InvoiceKsefReconciliationPanel {...panelProps}
      draft={{ id: 'draft-2', version: 1, state: 'OPEN' }}
      reconciliation={reconciliation({ draftId: 'draft-2', draftVersion: 1 })}
    />)

    await act(async () => { fail(new Error('Previous draft failed')) })

    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(button(KEEP).disabled).toBe(false))
  })

  it('can be embedded in the editor without adding a nested form or submit buttons', () => {
    const { container } = render(<form aria-label="Edytor"><InvoiceKsefReconciliationPanel {...props()} /></form>)
    expect(container.querySelectorAll('form')).toHaveLength(1)
    for (const action of screen.getAllByRole('button')) expect(action.getAttribute('type')).toBe('button')
  })
})
