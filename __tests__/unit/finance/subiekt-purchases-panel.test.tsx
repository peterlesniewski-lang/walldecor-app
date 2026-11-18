import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SubiektPurchasesPanel } from '@/components/shared/subiekt-purchases-panel'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const settlement = {
  invoiceId: 'i1', subiektNumber: 'FZ 3/MAG/10/2026', originalNumber: 'FV 10/10/2026', supplierName: 'Hurt PL',
  issuedAt: '2026-10-10', remaining: 123, grossPln: 123, appGrossPln: 123, paidAt: '2026-10-20', amountDiffers: false,
}
const reconciliation = (overrides: Record<string, unknown> = {}) => ({
  ok: true, from: '2025-11-01', to: '2026-11-30', checkedAt: '2026-11-18T09:00:00.000Z',
  settleInSubiekt: [settlement], paidOnlyInSubiekt: [], paidInAppMissingInSubiekt: [], ambiguous: [], ...overrides,
})
const mockFetch = (body: unknown, status = 200) => {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}
const renderPanel = () => render(<SubiektPurchasesPanel lastImportAt={null} lastImportMessage={null} />)

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('SubiektPurchasesPanel', () => {
  it('should render the settle-in-Subiekt list after checking', async () => {
    mockFetch(reconciliation())
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
    expect(await screen.findByText('FZ 3/MAG/10/2026')).toBeTruthy()
  })

  it('should show the API error message when the bridge is down', async () => {
    mockFetch({ ok: false, error: 'Mostek Subiekt jest niedostępny.' }, 503)
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Mostek Subiekt jest niedostępny.')
  })

  it('should post the import and show its summary', async () => {
    const fetchMock = mockFetch({ ok: true, created: 2, alreadyInApp: 1, ambiguous: 0, skippedDomestic: 5, message: 'Faktury UE z Subiekta: dodano 2, już w aplikacji 1, niejednoznaczne 0, krajowe pominięte 5.' })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Pobierz faktury UE z Subiekta' }))
    expect(await screen.findByText(/dodano 2/)).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/subiekt-purchases/import', expect.objectContaining({ method: 'POST' }))
    expect(router.refresh).toHaveBeenCalled()
  })

  it('should clear the previous reconciliation result after a successful import', async () => {
    mockFetch(reconciliation())
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
    await screen.findByTestId('subiekt-reconciliation')
    mockFetch({ ok: true, created: 1, alreadyInApp: 0, ambiguous: 0, skippedDomestic: 0, message: 'Faktury UE z Subiekta: dodano 1, już w aplikacji 0, niejednoznaczne 0, krajowe pominięte 0.' })
    await userEvent.click(screen.getByRole('button', { name: 'Pobierz faktury UE z Subiekta' }))
    await screen.findByText(/dodano 1/)
    expect(screen.queryByTestId('subiekt-reconciliation')).toBeNull()
  })

  it('should show the amount-differs badge when amountDiffers is true', async () => {
    mockFetch(reconciliation({ settleInSubiekt: [{ ...settlement, amountDiffers: true }] }))
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
    expect(await screen.findByText('kwota różni się')).toBeTruthy()
  })

  it('should not show the amount-differs badge when amounts match', async () => {
    mockFetch(reconciliation())
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
    await screen.findByText('FZ 3/MAG/10/2026')
    expect(screen.queryByText('kwota różni się')).toBeNull()
  })

  it('should show the empty-state text in sections without entries', async () => {
    mockFetch(reconciliation({ settleInSubiekt: [] }))
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
    expect(await screen.findAllByText('Brak — wszystko zgodne.')).toHaveLength(3)
  })

  it('should copy the Subiekt number to the clipboard', async () => {
    mockFetch(reconciliation())
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Sprawdź rozliczenia' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Kopiuj numer FZ 3/MAG/10/2026' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('FZ 3/MAG/10/2026'))
    expect(await screen.findByText('Skopiowano')).toBeTruthy()
  })

  it('should show the last import status line', () => {
    render(<SubiektPurchasesPanel lastImportAt="2026-11-17T08:00:00.000Z" lastImportMessage="Faktury UE z Subiekta: dodano 1." />)
    expect(screen.getByText(/Faktury UE z Subiekta: dodano 1\./)).toBeTruthy()
  })
})
