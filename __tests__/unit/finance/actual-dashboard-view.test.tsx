import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DashboardView } from '@/components/shared/dashboard-view'
import { buildActualDashboard, type DashboardRevenue } from '@/lib/finance/actual-dashboard'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

function fixture(rows: DashboardRevenue[] = []) {
  return {
    model: buildActualDashboard({ period: { year: 2026, month: 8 }, today: '2026-09-10', revenue: rows, previousRevenue: [], actualEntries: [], costEvents: [], previousActualEntries: [], previousCostEvents: [], waitingInvoices: [{ currency: 'EUR', grossAmount: 50 }] }),
    userName: 'Piotr', cashAccounts: [], receivables: [], latestLiability: null,
    thresholds: { cashThresholdVeryGood: 300000, cashThresholdGood: 200000, cashThresholdBad: 100000 },
    eurRate: null, eurRateDate: null, isAdmin: true, budgetAlerts: [], paymentAlerts: [],
  }
}

describe('actual dashboard view', () => {
  it('shows missing channel data and no invented profit or plan', () => {
    render(<DashboardView {...fixture()} />)
    const result = within(screen.getByRole('region', { name: 'Wynik wybranego miesiąca' }))
    expect(result.getByText('Brak danych przychodowych')).toBeTruthy()
    expect(screen.queryByText(/Zysk netto|Plan przych|Realizacja planu/)).toBeNull()
    expect(screen.getByText('Jagiellońska · Sprzedaż towaru')).toBeTruthy()
    expect(screen.getAllByText('Brak wpisu')).toHaveLength(5)
    expect(screen.getByText('50,00 EUR · bez przeliczenia')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Bieżące środki firmy' })).toBeTruthy()
    expect(screen.getByText(/nie jest wynikiem wybranego miesiąca/)).toBeTruthy()
  })

  it('renders a recorded negative amount and marks unknown freshness at channel level', () => {
    render(<DashboardView {...fixture([{ year: 2026, month: 8, costCenterId: 'PUL', channel: 'ECOMMERCE', amount: -123.45, asOfDate: null }])} />)
    const channel = screen.getByText('Puławska · Ecommerce').closest('li')!
    expect(within(channel).getByText('Data aktualności nieznana')).toBeTruthy()
    expect(within(channel).getByText('-123,45 zł')).toBeTruthy()
    expect(screen.getByText('GLOBAL · koszty wspólne')).toBeTruthy()
  })

  it('does not advertise a full month or a green result before company costs are confirmed', () => {
    const props = fixture()
    props.model = buildActualDashboard({ period: { year: 2026, month: 8 }, today: '2026-09-10',
      revenue: [['JAG', 'SALON'], ['JAG', 'MONTAZ'], ['PUL', 'SALON'], ['PUL', 'MONTAZ'], ['PUL', 'ECOMMERCE']].map(([costCenterId, channel]) => ({ year: 2026, month: 8, costCenterId, channel, amount: 100, asOfDate: '2026-08-31' })),
      previousRevenue: [], actualEntries: [], costEvents: [{ status: 'APPROVED', eventDate: new Date('2026-08-15T00:00:00Z'), parts: [{ grossAmount: 1, tags: [], allocations: [{ costCenterId: 'PUL', percent: 100 }] }] }], previousActualEntries: [], previousCostEvents: [],
      closedPeriods: [{ year: 2026, month: 8 }], waitingInvoices: [{ currency: 'PLN', grossAmount: 100000 }],
    })
    render(<DashboardView {...props} />)
    const result = within(screen.getByRole('region', { name: 'Wynik wybranego miesiąca' }))
    expect(result.queryByText('Dane za pełny miesiąc')).toBeNull()
    expect(result.getByText(/Koszty niepotwierdzone: dokumenty oczekujące na decyzję — 1/)).toBeTruthy()
    expect(result.getByText('499,00 zł').className).not.toContain('positive')
  })

  it('labels explicit zero-cost confirmation without a contradictory missing-cost warning', () => {
    const props = fixture()
    props.model = buildActualDashboard({ period: { year: 2026, month: 8 }, today: '2026-09-10', revenue: [], previousRevenue: [], actualEntries: [], costEvents: [], previousActualEntries: [], previousCostEvents: [], waitingInvoices: [], closedPeriods: [{ year: 2026, month: 8 }] })
    render(<DashboardView {...props} />)
    expect(screen.getByText(/Koszty potwierdzone: okres zamknięty/)).toBeTruthy()
    expect(screen.queryByText(/Brak zapisanych kosztów dla tego miesiąca/)).toBeNull()
  })

  it('applies the selected year and month to the shared route', async () => {
    const user = userEvent.setup()
    render(<DashboardView {...fixture()} />)
    await user.selectOptions(screen.getByLabelText('Miesiąc'), '7')
    await user.clear(screen.getByLabelText('Rok'))
    await user.type(screen.getByLabelText('Rok'), '2025')
    await user.click(screen.getByRole('button', { name: 'Pokaż okres' }))
    expect(push).toHaveBeenCalledWith('/dashboard?year=2025&month=7')
  })
})
