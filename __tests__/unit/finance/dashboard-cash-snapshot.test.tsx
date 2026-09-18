import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CashFlowRow, type CashFlowRowProps } from '@/components/shared/cash-flow-row'

const fixture: CashFlowRowProps = {
  initialAccounts: [{ id: 'pln', name: 'Bank PLN', currency: 'PLN', type: 'bank', balance: 100, order: 0 }, { id: 'eur', name: 'Bank EUR', currency: 'EUR', type: 'bank', balance: 50, order: 1 }],
  receivables: [], latestLiability: null, eurRate: null, eurRateDate: null, isAdmin: true,
  thresholds: { cashThresholdVeryGood: 300000, cashThresholdGood: 200000, cashThresholdBad: 100000 },
}
afterEach(() => vi.restoreAllMocks())

describe('dashboard current cash snapshot', () => {
  it('includes each registered account once when an actual EUR rate is available', () => {
    render(<CashFlowRow {...fixture} eurRate={4.2} eurRateDate="2026-09-10" />)
    expect(screen.getByText('310')).toBeTruthy()
    expect(screen.queryByText('Niepełna wycena środków')).toBeNull()
  })
  it('refreshes the snapshot when new server balances arrive', () => {
    const { rerender } = render(<CashFlowRow {...fixture} eurRate={4.2} />)
    expect(screen.getByText('310')).toBeTruthy()
    rerender(<CashFlowRow {...fixture} eurRate={4.2} initialAccounts={[{ ...fixture.initialAccounts[0], balance: 777 }]} />)
    expect(screen.queryByText('310')).toBeNull()
    expect(screen.getAllByText('777')).toHaveLength(2)
  })
  it('does not substitute zero for EUR when a rate is unavailable', () => {
    render(<CashFlowRow {...fixture} />)
    expect(screen.getByText('Brak kursu EUR — suma PLN niedostępna')).toBeTruthy()
    expect(screen.getByText('Niepełna wycena środków')).toBeTruthy()
    expect(screen.queryByText('100 PLN netto')).toBeNull()
  })
  it('shows an empty account register explicitly', () => {
    render(<CashFlowRow {...fixture} initialAccounts={[]} />)
    expect(screen.getByText('Brak aktywnych rachunków')).toBeTruthy()
    expect(screen.queryByText('Wymaga uwagi')).toBeNull()
  })
  it('keeps salon cash account balances read-only and points to the cash ledger', async () => {
    const user = userEvent.setup()
    render(<CashFlowRow {...fixture} initialAccounts={[{ id: 'salon', name: 'Kasa Puławska', currency: 'PLN', type: 'cash', balance: 300, order: 0, managedByCashier: true }]} />)
    await user.click(screen.getByText('Gotówka'))
    expect(screen.getByText('Kasa Puławska')).toBeTruthy()
    expect(screen.queryByTitle('Kliknij, aby edytować saldo')).toBeNull()
    expect(screen.getByRole('link', { name: 'Rozlicz w kasie salonu' }).getAttribute('href')).toBe('/cashier')
  })
  it('shows rejected balance writes instead of silently claiming success', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Saldo zarządzane przez kasę salonu' }), { status: 409 }))
    render(<CashFlowRow {...fixture} />)
    await user.click(screen.getByText('Konta bankowe'))
    await user.click(screen.getByTitle('Kliknij, aby edytować saldo'))
    const input = screen.getByDisplayValue('100')
    await user.clear(input)
    await user.type(input, '150{Enter}')
    expect((await screen.findByRole('alert')).textContent).toContain('Saldo zarządzane przez kasę salonu')
    expect(screen.getByTitle('Kliknij, aby edytować saldo').textContent).toBe('100')
  })

  it('preserves the liability draft while unrelated account balances refresh', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CashFlowRow {...fixture} />)
    await user.click(screen.getByRole('button', { name: 'Aktualizuj zobowiązania' }))
    await user.type(screen.getByPlaceholderText('np. 150000'), '450')
    await user.type(screen.getByPlaceholderText('np. faktury za marzec'), 'Faktury za sierpień')
    rerender(<CashFlowRow {...fixture} initialAccounts={[{ ...fixture.initialAccounts[0], balance: 777 }]} />)

    expect((screen.getByPlaceholderText('np. 150000') as HTMLInputElement).value).toBe('450')
    expect((screen.getByPlaceholderText('np. faktury za marzec') as HTMLInputElement).value).toBe('Faktury za sierpień')
    expect(screen.getAllByText('777')).toHaveLength(2)
  })

  it('preserves a new account draft when the server snapshot changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CashFlowRow {...fixture} />)
    await user.click(screen.getByText('Konta bankowe'))
    await user.click(screen.getByRole('button', { name: 'Dodaj konto' }))
    await user.type(screen.getByPlaceholderText('np. Konto firmowe PKO'), 'Rachunek rezerwowy')
    rerender(<CashFlowRow {...fixture} initialAccounts={[{ ...fixture.initialAccounts[0], balance: 777 }]} />)

    expect((screen.getByPlaceholderText('np. Konto firmowe PKO') as HTMLInputElement).value).toBe('Rachunek rezerwowy')
  })

  it('preserves an inline balance draft when another account changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CashFlowRow {...fixture} />)
    await user.click(screen.getByText('Konta bankowe'))
    await user.click(screen.getByTitle('Kliknij, aby edytować saldo'))
    await user.clear(screen.getByDisplayValue('100'))
    await user.type(screen.getByRole('textbox'), '150')
    rerender(<CashFlowRow {...fixture} initialAccounts={[fixture.initialAccounts[0], { ...fixture.initialAccounts[1], balance: 75 }]} />)

    expect((screen.getByDisplayValue('150') as HTMLInputElement).value).toBe('150')
    expect(screen.getByText('75,00')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('requires reading the changed server balance before saving the preserved inline draft', async () => {
    const user = userEvent.setup()
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { rerender } = render(<CashFlowRow {...fixture} />)
    await user.click(screen.getByText('Konta bankowe'))
    await user.click(screen.getByTitle('Kliknij, aby edytować saldo'))
    await user.clear(screen.getByDisplayValue('100'))
    await user.type(screen.getByRole('textbox'), '150')
    rerender(<CashFlowRow {...fixture} initialAccounts={[{ ...fixture.initialAccounts[0], balance: 777 }, fixture.initialAccounts[1]]} />)

    expect(screen.getByDisplayValue('150')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('777')
    await user.tab()
    expect(fetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Wczytaj aktualne saldo' }))
    expect(screen.getByDisplayValue('777')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('preserves a liability draft but blocks saving over a newly received liability snapshot', async () => {
    const user = userEvent.setup()
    const fetch = vi.spyOn(globalThis, 'fetch')
    const first = { id: 'before', amount: 200, date: '2026-09-09' }
    const { rerender } = render(<CashFlowRow {...fixture} latestLiability={first} />)
    await user.click(screen.getByRole('button', { name: 'Aktualizuj zobowiązania' }))
    await user.type(screen.getByPlaceholderText('np. 150000'), '450')
    rerender(<CashFlowRow {...fixture} latestLiability={{ id: 'after', amount: 350, date: '2026-09-10' }} />)

    expect((screen.getByPlaceholderText('np. 150000') as HTMLInputElement).value).toBe('450')
    expect(screen.getByRole('alert').textContent).toContain('350')
    expect((screen.getByRole('button', { name: 'Zapisz' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Wczytaj aktualne zobowiązania' }))
    expect((screen.getByPlaceholderText('np. 150000') as HTMLInputElement).value).toBe('350')
    expect((screen.getByRole('button', { name: 'Zapisz' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
