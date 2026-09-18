import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BreakEvenView } from '@/components/shared/break-even-view'
import type { BreakEvenReport, BreakEvenSalonReport, BreakEvenSource } from '@/lib/finance/break-even-types'

const makeSalon = (costCenterId: 'JAG' | 'PUL'): BreakEvenSalonReport => ({
  costCenterId, revenueGross: 12300, revenueNet: null, revenueBasis: null,
  fixedCosts: [{ id: `fixed-${costCenterId}`, name: `Czynsz ${costCenterId}`, expectedNetAmount: 1000, actualNetAmount: null, includedNetAmount: 1000, status: 'expected', netEstimated: false, matches: [] }],
  expectedFixedNet: 1000, actualFixedNet: 0, fixedNet: 1000, variableNet: 200, fixedOnlyTargetNet: 2000,
  targetNet: 2400, targetGross: null, deltaGross: null, operatingResultNet: null, omittedFixedCount: 0, omittedFixedNet: 0, goodsNet: 4000, oneOffNet: 0,
  hr: { status: 'missing', amount: null }, status: 'provisional', warnings: [],
})
const makeReport = (): BreakEvenReport => ({ year: 2026, month: 9, margin: { id: 'm1', margin: .5, effectiveFrom: '2026-01', note: null }, byCostCenter: { JAG: makeSalon('JAG'), PUL: makeSalon('PUL') }, historicalSuggestion: { status: 'incomplete', margin: null, revenueNet: 0, purchasesNet: 0, months: [], warnings: [] }, warnings: [], warningAmount: 220, warningSummary: { plnAmount: 220, unconvertedCount: 1, unconvertedByCurrency: [{ currency: 'EUR', amount: 20, count: 1 }] } })
const makeSource = (overrides: Partial<BreakEvenSource> = {}): BreakEvenSource => ({ partId: 'part1', eventId: 'event1', sourceInvoiceId: 'invoice1', title: 'FV/09/2026', supplierName: 'Wynajmujący', supplierNip: '1234567890', costCenterId: 'JAG', grossAmount: 1230, netAmount: 1000, netEstimated: true, tags: ['fixed'], matchedFixedCostId: null, ...overrides })
let report: BreakEvenReport
let sources: BreakEvenSource[]
let fetchMock: ReturnType<typeof vi.fn>
let posted: Record<string, unknown>[]
let rejectMutation: boolean
function respond(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }) }
beforeEach(() => {
  report = makeReport(); sources = [makeSource()]; posted = []; rejectMutation = false
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-18T10:00:00Z'))
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'POST') { posted.push(JSON.parse(String(options.body))); return respond(rejectMutation ? { error: 'Nie udało się zapisać zmiany' } : { ok: true }, rejectMutation ? 500 : 200) }
    if (url.includes('/sources?')) return respond({ sources, warnings: [] })
    if (url.includes('/settings?')) return respond({ margins: [report.margin], fixedCosts: [{ id: 'fixed-JAG', name: 'Czynsz JAG', costCenterId: 'JAG', supplierNip: null, supplierName: null, expectedNetAmount: 1000, effectiveFrom: '2026-01', effectiveTo: null, active: true }] })
    return respond({ report })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function load() { render(<BreakEvenView />); await screen.findByRole('region', { name: 'Jagiellońska' }) }
async function settings() { await load(); fireEvent.click(screen.getByRole('button', { name: 'Ustawienia i koszty stałe' })) }

describe('break-even monthly interface', () => {
  it('keeps unknown gross targets and HR explicit, preserves foreign currency warnings, switches the month on all reads', async () => {
    await load()
    const salon = screen.getByTestId('salon-JAG')
    expect(within(salon).getAllByText('Brak danych').length).toBeGreaterThan(1)
    expect(screen.getByText(/Koszty HR nie są jeszcze/)).toBeTruthy()
    expect(screen.getByText('Bez przeliczenia: 1 dokument')).toBeTruthy()
    expect(screen.getByText(/20,00.*EUR/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Miesiąc raportu'), { target: { value: '2026-08' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/finance/break-even?year=2026&month=8', undefined))
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/break-even/settings?year=2026&month=8', undefined)
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/break-even/sources?year=2026&month=8', undefined)
  })

  it('saves company margin as a fraction and retains edits on mutation failure', async () => {
    await settings()
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj marżę' }))
    fireEvent.change(screen.getByLabelText('Marża (%)'), { target: { value: '42,5' } })
    fireEvent.change(screen.getByLabelText('Marża obowiązuje od'), { target: { value: '2026-08' } })
    rejectMutation = true
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz marżę' }))
    await screen.findByText('Nie udało się zapisać zmiany')
    expect((screen.getByLabelText('Marża (%)') as HTMLInputElement).value).toBe('42,5')
    expect(posted[0]).toEqual({ action: 'margin.save', margin: .425, effectiveFrom: '2026-08', note: null })
    rejectMutation = false
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz marżę' }))
    await waitFor(() => expect(screen.queryByLabelText('Marża (%)')).toBeNull())
    expect(screen.getByText('Zapisano zmianę.')).toBeTruthy()
  })

  it('prefills a recurring cost from an invoice, excludes goods and manual events, allows explicit zero', async () => {
    sources.push(makeSource({ partId: 'goods', title: 'TOWAR', tags: ['goods'] }), makeSource({ partId: 'manual', title: 'RĘCZNY', sourceInvoiceId: null }))
    await settings()
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj koszt stały' }))
    const select = screen.getByLabelText('Utwórz na podstawie faktury')
    expect(within(select).queryByText(/TOWAR/)).toBeNull()
    expect(within(select).queryByText(/RĘCZNY/)).toBeNull()
    fireEvent.change(select, { target: { value: 'part1:JAG' } })
    expect((screen.getByLabelText('Nazwa kosztu') as HTMLInputElement).value).toBe('FV/09/2026')
    expect(screen.getByText(/Kwota netto tej części faktury jest oszacowana/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Oczekiwana kwota netto / miesiąc'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz koszt stały' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ action: 'fixed.save', name: 'FV/09/2026', costCenterId: 'JAG', expectedNetAmount: 0, supplierName: 'Wynajmujący', supplierNip: '1234567890', effectiveFrom: '2026-09' })
  })

  it('writes a net revenue companion without deriving VAT or changing gross revenue', async () => {
    await load()
    fireEvent.click(screen.getByRole('button', { name: 'Uzupełnij sprzedaż netto — Jagiellońska' }))
    const input = screen.getByLabelText('Sprzedaż netto — Jagiellońska')
    expect((input as HTMLInputElement).value).toBe('')
    fireEvent.change(input, { target: { value: '11000,25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz sprzedaż netto' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({ action: 'revenue.save', year: 2026, month: 9, costCenterId: 'JAG', netAmount: 11000.25 })
  })

  it('assigns the selected document with an explicit net override and restores expected cost through unlink action', async () => {
    await load()
    const salon = screen.getByTestId('salon-JAG')
    fireEvent.click(within(salon).getByText('Szczegóły kosztów stałych (1)'))
    fireEvent.click(screen.getByRole('button', { name: 'Przypisz fakturę — Czynsz JAG' }))
    fireEvent.change(screen.getByLabelText('Faktura za 2026-09 — Czynsz JAG'), { target: { value: 'part1' } })
    expect(screen.getByText(/Netto oszacowano proporcjonalnie/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Dokładna kwota netto (opcjonalnie)'), { target: { value: '990,50' } })
    report.byCostCenter.JAG.fixedCosts[0].matches = [{ id: 'match1', fixedCostId: 'fixed-JAG', year: 2026, month: 9, costEventPartId: 'part1', costCenterId: 'JAG', actualNetAmount: 990.5 }]
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz przypisanie' }))
    await waitFor(() => expect(posted[0]).toEqual({ action: 'match.save', fixedCostId: 'fixed-JAG', year: 2026, month: 9, costEventPartId: 'part1', actualNetAmount: 990.5 }))
    const linkedInvoice = await screen.findByText('FV/09/2026')
    const details = linkedInvoice.closest('details') as HTMLDetailsElement
    if (!details.open) fireEvent.click(within(details).getByText('Szczegóły kosztów stałych (1)'))
    fireEvent.click(screen.getByRole('button', { name: 'Odłącz fakturę — Czynsz JAG' }))
    await waitFor(() => expect(posted[1]).toEqual({ action: 'match.delete', id: 'match1' }))
  })

  it('edits existing records and confirms deletion or archival before sending mutations', async () => {
    await settings()
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj marżę 2026-01' }))
    fireEvent.change(screen.getByLabelText('Marża (%)'), { target: { value: '55' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz marżę' }))
    await waitFor(() => expect(posted[0]).toMatchObject({ action: 'margin.save', id: 'm1', margin: .55 }))
    await screen.findByRole('button', { name: 'Dodaj marżę' })
    fireEvent.click(screen.getByRole('button', { name: 'Usuń', exact: true }))
    expect(posted).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź', exact: true }))
    await waitFor(() => expect(posted[1]).toEqual({ action: 'margin.delete', id: 'm1' }))
    await screen.findByRole('button', { name: 'Edytuj Czynsz JAG' })
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj Czynsz JAG' }))
    fireEvent.change(screen.getByLabelText('Oczekiwana kwota netto / miesiąc'), { target: { value: '1200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz koszt stały' }))
    await waitFor(() => expect(posted[2]).toMatchObject({ action: 'fixed.save', id: 'fixed-JAG', expectedNetAmount: 1200 }))
    await screen.findByRole('button', { name: 'Archiwizuj' })
    fireEvent.click(screen.getByRole('button', { name: 'Archiwizuj' }))
    expect(posted).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź', exact: true }))
    await waitFor(() => expect(posted[3]).toEqual({ action: 'fixed.archive', id: 'fixed-JAG' }))
  })

  it('accepts signed credit overrides and rejects amounts beyond the allocated gross', async () => {
    sources = [makeSource({ grossAmount: -123, netAmount: -100 })]
    await load()
    fireEvent.click(within(screen.getByTestId('salon-JAG')).getByText('Szczegóły kosztów stałych (1)'))
    fireEvent.click(screen.getByRole('button', { name: 'Przypisz fakturę — Czynsz JAG' }))
    fireEvent.change(screen.getByLabelText('Faktura za 2026-09 — Czynsz JAG'), { target: { value: 'part1' } })
    fireEvent.change(screen.getByLabelText('Dokładna kwota netto (opcjonalnie)'), { target: { value: '-200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz przypisanie' }))
    expect(screen.getByRole('alert').textContent).toContain('nie przekraczać')
    expect(posted).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Dokładna kwota netto (opcjonalnie)'), { target: { value: '-99,5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz przypisanie' }))
    await waitFor(() => expect(posted[0]).toMatchObject({ action: 'match.save', actualNetAmount: -99.5 }))
  })

  it('edits the existing matched invoice amount, preserving an explicit zero and link identity', async () => {
    const fixed = report.byCostCenter.JAG.fixedCosts[0]
    fixed.matches = [{ id: 'match1', fixedCostId: fixed.id, year: 2026, month: 9, costEventPartId: 'part1', costCenterId: 'JAG', actualNetAmount: 0 }]
    sources = [makeSource({ matchedFixedCostId: fixed.id, tags: [] })]
    await load()
    fireEvent.click(within(screen.getByTestId('salon-JAG')).getByText('Szczegóły kosztów stałych (1)'))
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj kwotę — Czynsz JAG' }))
    expect((screen.getByLabelText('Dokładna kwota netto (opcjonalnie)') as HTMLInputElement).value).toBe('0')
    expect((screen.getByLabelText('Faktura za 2026-09 — Czynsz JAG') as HTMLSelectElement).value).toBe('part1')
    expect((screen.getByLabelText('Faktura za 2026-09 — Czynsz JAG') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText(/Dokument nie ma klasyfikacji kosztu stałego/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Dokładna kwota netto (opcjonalnie)'), { target: { value: '950' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj', exact: true }))
    expect(posted).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj kwotę — Czynsz JAG' }))
    expect((screen.getByLabelText('Dokładna kwota netto (opcjonalnie)') as HTMLInputElement).value).toBe('0')
    fireEvent.change(screen.getByLabelText('Dokładna kwota netto (opcjonalnie)'), { target: { value: '950' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz przypisanie' }))
    await waitFor(() => expect(posted[0]).toEqual({ action: 'match.save', fixedCostId: fixed.id, year: 2026, month: 9, costEventPartId: 'part1', actualNetAmount: 950 }))
  })

  it('warns when a recurring template is based on an unclassified invoice', async () => {
    sources = [makeSource({ tags: [] })]
    await settings()
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj koszt stały' }))
    fireEvent.change(screen.getByLabelText('Utwórz na podstawie faktury'), { target: { value: 'part1:JAG' } })
    expect(screen.getByText(/Dokument nie ma klasyfikacji kosztu stałego/)).toBeTruthy()
    expect(screen.getByText(/Utworzenie szablonu nie zmienia klasyfikacji faktury/)).toBeTruthy()
  })

  it('offers retry after a read failure without presenting stale success', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Brak połączenia'))
    render(<BreakEvenView />)
    await screen.findByText('Brak połączenia')
    expect(screen.queryByTestId('salon-JAG')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
    await screen.findByRole('region', { name: 'Jagiellońska' })
  })
})
