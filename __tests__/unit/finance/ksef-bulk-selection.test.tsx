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
})
