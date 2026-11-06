import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RevenueTabs } from '@/components/shared/revenue-tabs'
import type { SubiektRevenueView } from '@/lib/finance/subiekt-revenue'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const view: SubiektRevenueView = {
  configured: true, fetchedAt: '2026-11-02T06:30:00.000Z', lastError: null, lastErrorAt: null, mapProblems: [],
  cells: [
    { year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON', grossAmount: 1234.5, netAmount: 1000, documentCount: 7 },
    { year: 2026, month: 10, costCenterId: 'PUL', channel: 'MONTAZ', grossAmount: 300, netAmount: 243.9, documentCount: 2 },
    { year: 2026, month: 10, costCenterId: 'JAG', channel: 'SALON', grossAmount: -50, netAmount: -40.65, documentCount: 1 },
  ],
  unmapped: [{ year: 2026, month: 9, warehouseSymbol: 'ZEW', kind: 'USLUGA', grossAmount: 77.77, documentCount: 1 }],
}
const entries = [{ year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON', amount: 1000, asOfDate: '2026-10-31' }]
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T12:00:00.000Z'))
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.clearAllMocks()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Subiekt column on the revenue page', () => {
  it('should show the Subiekt amount, document count and the difference against the entered amount', () => {
    render(<RevenueTabs year={2026} costCenterId="PUL" editable isAdmin entries={entries} subiekt={view} />)
    const salon = screen.getByTestId('subiekt-10-SALON')
    expect(salon.textContent).toContain('1234,50')
    expect(salon.textContent).toContain('dok. 7')
    expect(salon.textContent).toContain('różnica +234,50')
    expect(screen.getByTestId('subiekt-10-MONTAZ').textContent).toContain('brak wpisu')
    expect(screen.getByTestId('subiekt-status').textContent).toContain('Ostatni odczyt:')
  })

  it('should not offer Zastosuj for ECOMMERCE without a Subiekt amount and should list unmapped warehouses', () => {
    render(<RevenueTabs year={2026} costCenterId="PUL" editable isAdmin entries={entries} subiekt={view} />)
    expect(screen.getByTestId('subiekt-10-ECOMMERCE').textContent).toContain('Subiekt: —')
    expect(screen.queryByTestId('subiekt-apply-10-ECOMMERCE')).toBeNull()
    expect(screen.getByTestId('subiekt-apply-10-SALON')).toBeTruthy()
    expect(screen.getByTestId('subiekt-apply-month-10')).toBeTruthy()
    expect(screen.getByTestId('subiekt-unmapped').textContent).toContain('nieprzypisany magazyn ZEW')
  })

  it('should show company sums read-only without any apply button', () => {
    render(<RevenueTabs year={2026} costCenterId="GLOBAL" editable={false} isAdmin entries={entries} subiekt={view} />)
    expect(screen.getByTestId('subiekt-10-SALON').textContent).toContain('1184,50')
    expect(document.querySelectorAll('[data-testid^="subiekt-apply-"]')).toHaveLength(0)
  })

  it('should post the cell to the apply endpoint and show the confirmed amount', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, entries: [{ year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON', amount: 1234.5, asOfDate: '2026-10-31' }] }) })
    render(<RevenueTabs year={2026} costCenterId="PUL" editable isAdmin entries={entries} subiekt={view} />)
    fireEvent.click(screen.getByTestId('subiekt-apply-10-SALON'))
    await waitFor(() => expect(screen.getByTestId('revenue-saved').textContent).toContain('1234,50'))
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/subiekt-revenue/apply', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON' }),
    }))
    expect(screen.getByTestId('subiekt-10-SALON').textContent).toContain('zgodne')
    expect(router.refresh).toHaveBeenCalled()
  })

  it('should surface the Polish error when apply fails and keep the entered amount', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ ok: false, error: 'Brak odczytu z Subiekta dla tej komórki.' }) })
    render(<RevenueTabs year={2026} costCenterId="PUL" editable isAdmin entries={entries} subiekt={view} />)
    fireEvent.click(screen.getByTestId('subiekt-apply-month-10'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Brak odczytu z Subiekta'))
    expect(screen.getByRole('button', { name: /Edytuj Sprzedaż towaru — październik 2026/ }).textContent).toContain('1000,00')
  })

  it('should show the outage message with the last read time and only a one-line note when not configured', () => {
    render(<RevenueTabs year={2026} costCenterId="PUL" editable isAdmin entries={entries} subiekt={{ ...view, lastError: 'Mostek Subiekt jest niedostępny.', lastErrorAt: '2026-11-02T07:30:00.000Z' }} />)
    expect(screen.getByTestId('subiekt-status').textContent).toContain('Mostek niedostępny — dane z')
    expect(screen.getByTestId('subiekt-apply-10-SALON')).toBeTruthy()
    cleanup()
    render(<RevenueTabs year={2026} costCenterId="PUL" editable isAdmin entries={entries} subiekt={{ ...view, configured: false, cells: [], unmapped: [] }} />)
    expect(screen.getByTestId('subiekt-not-configured').textContent).toContain('nie jest skonfigurowany')
    expect(screen.queryByTestId('subiekt-10-SALON')).toBeNull()
  })

  it('should list INNE rows as an unsupported kind warning, never as an applicable cell', () => {
    const withInne = { ...view, unmapped: [{ year: 2026, month: 10, warehouseSymbol: 'PUŁ', kind: 'INNE' as const, grossAmount: 12.5, documentCount: 1 }] }
    render(<RevenueTabs year={2026} costCenterId="PUL" editable isAdmin entries={entries} subiekt={withInne} />)
    expect(screen.getByTestId('subiekt-unmapped').textContent).toContain('rodzaj INNE: pozostałe pozycje, nieustalony podział lub zaokrąglenia (magazyn PUŁ')
    expect(screen.getByTestId('subiekt-unmapped').textContent).toContain('12,50')
  })

  it('should describe the edit button with its Subiekt line and refresh the router even when apply fails', async () => {
    fetchMock.mockRejectedValue('offline')
    render(<RevenueTabs year={2026} costCenterId="PUL" editable isAdmin entries={entries} subiekt={view} />)
    const edit = screen.getByRole('button', { name: /Edytuj Sprzedaż towaru — październik 2026/ })
    expect(edit.getAttribute('aria-describedby')).toBe(screen.getByTestId('subiekt-10-SALON').id)
    fireEvent.click(screen.getByTestId('subiekt-apply-10-SALON'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Błąd połączenia'))
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('should hide Odczytaj teraz for a non-admin viewer', () => {
    render(<RevenueTabs year={2026} costCenterId="GLOBAL" editable={false} isAdmin={false} entries={entries} subiekt={view} />)
    expect(screen.queryByTestId('subiekt-refresh')).toBeNull()
    expect(screen.getByTestId('subiekt-status')).toBeTruthy()
  })
})
