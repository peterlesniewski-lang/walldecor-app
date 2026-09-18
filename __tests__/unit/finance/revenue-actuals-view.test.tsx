import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueTabs } from '@/components/shared/revenue-tabs'
import { CsvRevenuePanel } from '@/components/shared/csv-revenue-panel'
import { CsvColumnMapper } from '@/components/shared/csv-column-mapper'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const props = {
  year: 2026, costCenterId: 'JAG', editable: true,
  entries: [{ year: 2026, month: 9, costCenterId: 'JAG', channel: 'SALON', amount: 0, asOfDate: null }],
  // Existing legacy props deliberately contain a plan: it must never affect the actual editor.
  activeTab: 'actuals' as const, planEntries: { SALON_9: 900000 }, actualEntries: { SALON_9: 0 }, canEditPlan: true, canEditActuals: true,
}
const editName = 'Edytuj Sprzedaż towaru — wrzesień 2026'
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'))
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.clearAllMocks()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('actual monthly revenue editor', () => {
  it('removes plan and percentages, while displaying explicit zero and missing records separately', () => {
    render(<RevenueTabs {...props} />)
    expect(screen.queryByRole('button', { name: 'Plan sprzedaży' })).toBeNull()
    expect(screen.queryByText('% wykonania')).toBeNull()
    const zeroCell = screen.getByRole('button', { name: editName })
    expect(within(zeroCell).getByText(/0,00/)).toBeTruthy()
    expect(within(zeroCell).getByText('Data stanu niepodana')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: 'Edytuj Sprzedaż towaru — sierpień 2026' })).getByText('Brak wpisu')).toBeTruthy()
    expect(screen.queryByText(/900.?000/)).toBeNull()
  })

  it('saves a signed replacement together with its date and updates the visible record', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'r1', ...props.entries[0], amount: -120.45, asOfDate: '2026-09-09' }), { status: 200 }))
    render(<RevenueTabs {...props} />)
    fireEvent.click(screen.getByRole('button', { name: editName }))
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '-120,45' } })
    fireEvent.change(screen.getByLabelText('Stan na dzień (opcjonalnie)'), { target: { value: '2026-09-09' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz obrót' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ year: 2026, month: 9, costCenterId: 'JAG', channel: 'SALON', amount: -120.45, asOfDate: '2026-09-09' })
    const cell = screen.getByRole('button', { name: editName })
    expect(within(cell).getByText(/-120,45/)).toBeTruthy()
    expect(within(cell).getByText(/09\.09\.2026/)).toBeTruthy()
  })

  it('keeps an empty amount unsaved and shows failure without closing the editor', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Nie udało się zapisać obrotu' }), { status: 500 }))
    render(<RevenueTabs {...props} />)
    fireEvent.click(screen.getByRole('button', { name: editName }))
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz obrót' }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/kwotę/i)
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz obrót' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Nie udało się zapisać obrotu'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(screen.getByRole('button', { name: editName })).getByText(/0,00/)).toBeTruthy()
  })

  it('does not expose an editable company aggregate', () => {
    render(<RevenueTabs {...props} costCenterId="GLOBAL" editable={false} />)
    expect(screen.queryByRole('button', { name: /Edytuj/ })).toBeNull()
    expect(screen.getByText(/Podsumowanie obu salonów/)).toBeTruthy()
  })

  it('shows changed server entries after refresh without resetting a draft for an unchanged snapshot', () => {
    const { rerender } = render(<RevenueTabs {...props} />)
    fireEvent.click(screen.getByRole('button', { name: editName }))
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '150' } })
    rerender(<RevenueTabs {...props} entries={props.entries.map((entry) => ({ ...entry }))} />)
    expect((screen.getByLabelText('Kwota brutto narastająco (PLN)') as HTMLInputElement).value).toBe('150')
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    rerender(<RevenueTabs {...props} entries={[{ ...props.entries[0], amount: 120, asOfDate: '2026-09-08' }]} />)
    const cell = screen.getByRole('button', { name: editName })
    expect(within(cell).getByText(/120,00/)).toBeTruthy()
    expect(within(cell).getByText('Stan na 08.09.2026')).toBeTruthy()
  })

  it('preserves and saves the next month draft when the previous save refresh arrives late', async () => {
    const january = { ...props.entries[0], month: 1, amount: 100, asOfDate: '2026-01-31' }
    const savedJanuary = { ...january, amount: 150 }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(savedJanuary), { status: 200 }))
    const { rerender } = render(<RevenueTabs {...props} entries={[january]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj Sprzedaż towaru — styczeń 2026' }))
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz obrót' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(router.refresh).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Edytuj Sprzedaż towaru — luty 2026' }))
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '999' } })
    fireEvent.change(screen.getByLabelText('Stan na dzień (opcjonalnie)'), { target: { value: '2026-02-28' } })
    rerender(<RevenueTabs {...props} entries={[savedJanuary]} />)

    expect(screen.getByRole('dialog', { name: 'Obrót — luty 2026' })).toBeTruthy()
    expect((screen.getByLabelText('Kwota brutto narastająco (PLN)') as HTMLInputElement).value).toBe('999')
    expect((screen.getByLabelText('Stan na dzień (opcjonalnie)') as HTMLInputElement).value).toBe('2026-02-28')
    const savedFebruary = { ...january, month: 2, amount: 999, asOfDate: '2026-02-28' }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(savedFebruary), { status: 200 }))
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz obrót' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(savedFebruary)
    expect(within(screen.getByRole('button', { name: 'Edytuj Sprzedaż towaru — styczeń 2026' })).getByText(/150,00/)).toBeTruthy()
    expect(within(screen.getByRole('button', { name: 'Edytuj Sprzedaż towaru — luty 2026' })).getByText(/999,00/)).toBeTruthy()
  })

  it('retains a confirmed save when an unrelated render supplies the unchanged old server snapshot', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...props.entries[0], amount: 150 }), { status: 200 }))
    const { rerender } = render(<RevenueTabs {...props} />)
    fireEvent.click(screen.getByRole('button', { name: editName }))
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz obrót' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    rerender(<RevenueTabs {...props} entries={props.entries.map((entry) => ({ ...entry }))} />)
    expect(within(screen.getByRole('button', { name: editName })).getByText(/150,00/)).toBeTruthy()
  })

  it('keeps the active draft while cancellation reveals changed server values', () => {
    const { rerender } = render(<RevenueTabs {...props} />)
    fireEvent.click(screen.getByRole('button', { name: editName }))
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '999' } })
    fireEvent.change(screen.getByLabelText('Stan na dzień (opcjonalnie)'), { target: { value: '2026-09-09' } })
    rerender(<RevenueTabs {...props} entries={[{ ...props.entries[0], amount: 125, asOfDate: '2026-09-08' }]} />)

    expect((screen.getByLabelText('Kwota brutto narastająco (PLN)') as HTMLInputElement).value).toBe('999')
    expect((screen.getByLabelText('Stan na dzień (opcjonalnie)') as HTMLInputElement).value).toBe('2026-09-09')
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    const cell = screen.getByRole('button', { name: editName })
    expect(within(cell).getByText(/125,00/)).toBeTruthy()
    expect(within(cell).getByText('Stan na 08.09.2026')).toBeTruthy()
  })

  it('refreshes imported zero, cleared dates and missing records with the editor closed', () => {
    const { rerender } = render(<RevenueTabs {...props} entries={[{ ...props.entries[0], amount: 125, asOfDate: '2026-09-08' }]} />)
    rerender(<RevenueTabs {...props} />)
    const zeroCell = screen.getByRole('button', { name: editName })
    expect(within(zeroCell).getByText(/0,00/)).toBeTruthy()
    expect(within(zeroCell).getByText('Data stanu niepodana')).toBeTruthy()

    rerender(<RevenueTabs {...props} entries={[]} />)
    expect(within(screen.getByRole('button', { name: editName })).getByText('Brak wpisu')).toBeTruthy()
  })

  it.each([{ year: 2025, costCenterId: 'JAG' }, { year: 2026, costCenterId: 'PUL' }])('closes the old draft when navigating to %j', (period) => {
    const { rerender } = render(<RevenueTabs {...props} />)
    fireEvent.click(screen.getByRole('button', { name: editName }))
    fireEvent.change(screen.getByLabelText('Kwota brutto narastająco (PLN)'), { target: { value: '999' } })
    rerender(<RevenueTabs {...props} {...period} entries={[]} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByDisplayValue('999')).toBeNull()
  })
})

describe('both actual-revenue CSV entry points', () => {
  it('removes the sales-plan switch from direct CSV import', () => {
    render(<CsvRevenuePanel userRole="ADMIN" />)
    expect(screen.queryByRole('button', { name: 'Plan sprzedaży' })).toBeNull()
    expect(screen.getByText(/stan_na_dzien/)).toBeTruthy()
  })

  it('imports the optional date from a real CSV file and surfaces HTTP failure', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Brak dostępu do importu' }), { status: 403 }))
    const { container } = render(<CsvRevenuePanel userRole="ADMIN" />)
    const file = new File(['rok,miesiac,centrum_kosztow,kanal,kwota,stan_na_dzien\n2026,9,JAG,SALON,120,2026-09-09'], 'obroty.csv', { type: 'text/csv' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importuj 1 wierszy' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Importuj 1 wierszy' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Brak dostępu do importu'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ type: 'actuals', rows: [{ stan_na_dzien: '2026-09-09' }] })
    expect(screen.queryByText(/Zaimportowano:/)).toBeNull()
  })

  it('keeps cost budgeting in the mapper, removes revenue planning and accepts old CSV without a date', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ imported: 1, errors: [] }), { status: 200 }))
    const { container } = render(<CsvColumnMapper userRole="ADMIN" />)
    expect(screen.getByRole('button', { name: 'Plan budżetowy' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Przychody' }))
    expect(screen.queryByRole('button', { name: 'Plan sprzedaży' })).toBeNull()
    const file = new File(['rok,miesiac,centrum_kosztow,kanal,kwota\n2026,9,JAG,SALON,-120.45'], 'stare-obroty.csv', { type: 'text/csv' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importuj 1 wierszy' })).toBeTruthy())
    expect((screen.getByRole('button', { name: 'Importuj 1 wierszy' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Importuj 1 wierszy' }))
    await waitFor(() => expect(screen.getByText('Zaimportowano 1 z 1 wierszy')).toBeTruthy())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ type: 'actuals', rows: [{ rok: '2026', miesiac: '9', centrum_kosztow: 'JAG', kanal: 'SALON', kwota: '-120.45', stan_na_dzien: '' }] })
    expect(router.refresh).toHaveBeenCalledOnce()
  })

  it('refreshes current data after a successful direct revenue import', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ imported: 1, errors: [] }), { status: 200 }))
    const { container } = render(<CsvRevenuePanel userRole="ADMIN" />)
    const file = new File(['rok,miesiac,centrum_kosztow,kanal,kwota\n2026,9,JAG,SALON,0'], 'zero.csv', { type: 'text/csv' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importuj 1 wierszy' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Importuj 1 wierszy' }))
    await waitFor(() => expect(screen.getByText(/Zaimportowano:/)).toBeTruthy())
    expect(router.refresh).toHaveBeenCalledOnce()
  })

  it('preserves the cost budget payload and cost amount normalization', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ imported: 1, errors: [] }), { status: 200 }))
    const { container } = render(<CsvColumnMapper userRole="ADMIN" />)
    fireEvent.click(screen.getByRole('button', { name: 'Plan budżetowy' }))
    const file = new File(['rok;miesiac;centrum_kosztow;kategoria;podkategoria;kwota\n2026;9;JAG;Koszty lokalu;Czynsz;1 234,50 PLN'], 'koszty.csv', { type: 'text/csv' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Importuj 1 wierszy' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Importuj 1 wierszy' }))
    await waitFor(() => expect(screen.getByText('Zaimportowano 1 z 1 wierszy')).toBeTruthy())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/import/costs')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ type: 'budget', rows: [{ rok: '2026', miesiac: '9', centrum_kosztow: 'JAG', kategoria: 'Koszty lokalu', podkategoria: 'Czynsz', kwota: '1234.50' }] })
  })
})
