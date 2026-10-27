import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KsefInboxView } from '@/components/shared/ksef-inbox-view'
import { selectedInvoiceTotals } from '@/lib/finance/ksef-selection'

const invoices = [
  { id: 'a', invoiceNumber: 'A', grossAmount: 0.1, currency: 'PLN', paymentStatus: 'UNPAID' as const },
  { id: 'b', invoiceNumber: 'B', grossAmount: 0.2, currency: 'PLN', paymentStatus: 'PAID' as const },
  { id: 'c', invoiceNumber: 'C', grossAmount: -10, currency: 'EUR', paymentStatus: 'UNPAID' as const },
].map((invoice) => ({ ...invoice, externalId: null, supplierName: 'Test', supplierNip: null,
  issueDate: '2026-09-01', netAmount: null, vatAmount: null, status: 'APPROVED' as const,
  notes: null, costCenterId: null, subCategoryId: null, costCenter: null, subCategory: null,
}))
const page = { invoices, total: 3, page: 1, pageSize: 50 as const, totalPages: 2, grossAmountTotal: 0.3, counts: { NEW: 0, MAPPED: 0, APPROVED: 3, IGNORED: 0 } }
function mount() {
  render(<KsefInboxView initialInvoices={invoices} initialTotal={3} initialPage={1} initialPageSize={50} initialTotalPages={2} initialGrossAmountTotal={0.3} initialCounts={page.counts} initialRules={[]} costCenters={[]} subCategories={[]} />)
}
afterEach(() => vi.restoreAllMocks())

describe('invoice selection and payment workflow', () => {
  it('sums in minor units per currency including negative corrections', () => {
    expect(selectedInvoiceTotals(invoices)).toEqual([{ currency: 'EUR', amount: -10 }, { currency: 'PLN', amount: 0.3 }])
  })
  it('selects individual invoices, shows mixed header and sums, and clears after changing page', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...page, page: 2 })))
    mount()
    const bar = within(screen.getByRole('region', { name: 'Zaznaczone faktury' }))
    await user.click(screen.getByLabelText('Zaznacz fakturę A'))
    expect((screen.getByLabelText('Zaznacz wszystkie faktury na stronie') as HTMLInputElement).indeterminate).toBe(true)
    expect(bar.getByText('0,10 PLN')).toBeTruthy()
    await user.click(screen.getByLabelText('Zaznacz wszystkie faktury na stronie'))
    expect(bar.getByText('-10,00 EUR · 0,30 PLN')).toBeTruthy()
    expect(bar.getByRole('button', { name: 'Oznacz jako zapłacone (2)' })).toBeTruthy()
    await user.click(screen.getAllByTitle('Następna strona')[0])
    expect(bar.getByText('Zaznaczono: 0')).toBeTruthy()
    expect((screen.getByLabelText('Zaznacz wszystkie faktury na stronie') as HTMLInputElement).checked).toBe(false)
  })
  it('submits the selected IDs and date, then keeps only failed invoices selected', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [
        { id: 'a', outcome: 'paid' }, { id: 'b', outcome: 'already_paid' }, { id: 'c', outcome: 'failed', error: 'Spróbuj ponownie.' },
      ], paidAt: '2026-09-08T10:00:00Z' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...page, invoices: invoices.map((invoice) => invoice.id === 'a' ? { ...invoice, paymentStatus: 'PAID' } : invoice) })))
    mount()
    await user.click(screen.getByLabelText('Zaznacz wszystkie faktury na stronie'))
    const date = screen.getByLabelText('Data płatności grupowej')
    await user.clear(date)
    await user.type(date, '2026-09-08')
    await user.click(screen.getByRole('button', { name: 'Oznacz jako zapłacone (2)' }))
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options!.body as string)).toEqual({ invoiceIds: ['a', 'b', 'c'], paidDate: '2026-09-08' })
    expect(await screen.findByText(/Oznaczono jako zapłacone: 1. Już zapłacone: 1. Błędy: 1/)).toBeTruthy()
    expect((screen.getByLabelText('Zaznacz fakturę C') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Zaznacz fakturę A') as HTMLInputElement).checked).toBe(false)
  })
  it('shows editable invoice numbers with a character counter and copies sum and numbers', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    await user.click(screen.getByLabelText('Zaznacz fakturę A'))
    await user.click(screen.getByLabelText('Zaznacz fakturę B'))
    const field = screen.getByLabelText('Tytuł przelewu') as HTMLInputElement
    expect(field.value).toBe('A, B')
    expect(screen.getByText('4 / 140 znaków')).toBeTruthy()
    await user.clear(field)
    await user.type(field, 'A+B')
    expect(screen.getByText('3 / 140 znaków')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Kopiuj numery faktur' }))
    expect(writeText).toHaveBeenLastCalledWith('A+B')
    await user.click(screen.getByRole('button', { name: 'Kopiuj sumę brutto' }))
    expect(writeText).toHaveBeenLastCalledWith('0,30')
    await user.click(screen.getByLabelText('Zaznacz fakturę C'))
    expect((screen.getByLabelText('Tytuł przelewu') as HTMLInputElement).value).toBe('A, B, C')
  })
  it('flags a transfer title longer than 140 characters', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByLabelText('Zaznacz fakturę A'))
    const field = screen.getByLabelText('Tytuł przelewu') as HTMLInputElement
    await user.clear(field)
    await user.click(field)
    await user.paste('x'.repeat(145))
    expect(screen.getByText('145 / 140 znaków (za dużo o 5)')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
  })
  it('tints rows by due date and states the deadline in words', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-27T10:00:00+01:00') })
    try {
      const withDue = [
        { ...invoices[0], paymentStatus: 'UNKNOWN' as const, dueDate: '2026-10-22T00:00:00.000Z' },
        { ...invoices[1], paymentStatus: 'UNPAID' as const, dueDate: '2026-10-27T00:00:00.000Z' },
        { ...invoices[2], paymentStatus: 'PAID' as const, dueDate: '2026-10-01T00:00:00.000Z' },
      ]
      render(<KsefInboxView initialInvoices={withDue} initialTotal={3} initialPage={1} initialPageSize={50} initialTotalPages={1} initialGrossAmountTotal={0.3} initialCounts={page.counts} initialRules={[]} costCenters={[]} subCategories={[]} />)
      const rowOf = (label: string) => screen.getByLabelText(label).closest('tr')!
      expect(rowOf('Zaznacz fakturę A').getAttribute('data-due-urgency')).toBe('5')
      expect(within(rowOf('Zaznacz fakturę A')).getByText(/po terminie: 5 dni/)).toBeTruthy()
      expect(rowOf('Zaznacz fakturę B').getAttribute('data-due-urgency')).toBe('4')
      expect(rowOf('Zaznacz fakturę C').getAttribute('data-due-urgency')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
