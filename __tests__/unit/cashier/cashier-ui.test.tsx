import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CashierReportEditor } from '@/components/cashier/cashier-report-editor'
import { CashierView } from '@/components/cashier/cashier-view'
import { parseCashierMoney } from '@/components/cashier/money'
import { visibleNavSections } from '@/components/shared/sidebar'
import type { CashierBootstrap, CashierReport } from '@/lib/cashier/contracts'

const report: CashierReport = {
  id: 'report-1', costCenterId: 'PUL', businessDate: '2026-09-09', status: 'DRAFT', openingCents: 27000,
  targetFloatCents: 30000, cashReceiptsCents: 150000, cardReceiptsCents: 300000, countedCents: 167000,
  expectedCents: 167000, differenceCents: 0, retainedCents: 30000, depositCents: 137000, shortfallCents: 0,
  note: null, version: 2, createdById: 'employee', closedById: null, closedAt: null, closeRequestId: null,
  createdAt: '2026-09-09T17:00:00Z', updatedAt: '2026-09-09T17:00:00Z', deposit: null, canCorrect: false,
  operations: [
    { id: 'refund', reportId: 'report-1', kind: 'SALES_REFUND', method: 'CASH', amountCents: 20000, reference: 'ZW/1', note: null, createdById: 'employee', cancelledAt: null, createdAt: '', updatedAt: '' },
    { id: 'deposit', reportId: 'report-1', kind: 'DEPOSIT_IN', method: 'CASH', amountCents: 10000, reference: 'KAU/1', note: null, createdById: 'employee', cancelledAt: null, createdAt: '', updatedAt: '' },
  ],
}

const bootstrap: CashierBootstrap = {
  actor: { id: 'employee', name: 'Test PUL', role: 'EMPLOYEE', costCenterId: 'PUL' },
  centers: [{ id: 'PUL', name: 'Puławska', configured: true }], selectedCostCenterId: 'PUL', today: '2026-09-10',
  settings: { costCenterId: 'PUL', cashAccountId: 'account-1', cashAccountName: 'Kasa PUL', balanceCents: 27000, targetFloatCents: 30000, initialCashCents: 27000, startDate: '2026-09-09', version: 1, createdAt: '', updatedAt: '' },
  accounts: [], reports: [report], selectedReport: report, openReport: report, deposits: [], audit: [], waitingDepositsCents: 0,
  reportsTruncated: false, depositsTruncated: false, auditTruncated: false, auditPage: 1, auditHasMore: false,
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Cashier UI controls', () => {
  it('keeps blank separate from zero and refuses money truncation', () => {
    expect(parseCashierMoney('')).toBeNull()
    expect(parseCashierMoney('0')).toBe(0)
    expect(parseCashierMoney('1 670,25')).toBe(167025)
    expect(() => parseCashierMoney('1.234')).toThrow()
    expect(() => parseCashierMoney('-1')).toThrow()
    expect(() => parseCashierMoney('21474836,48')).toThrow()
  })

  it('shows cash navigation to admin and employee, never manager or installer', () => {
    const has = (role: 'ADMIN' | 'EMPLOYEE' | 'MANAGER' | 'INSTALLER') => visibleNavSections(role).flatMap((s) => s.items).some((i) => i.href === '/cashier')
    expect(has('ADMIN')).toBe(true)
    expect(has('EMPLOYEE')).toBe(true)
    expect(has('MANAGER')).toBe(false)
    expect(has('INSTALLER')).toBe(false)
  })

  it('requires physical confirmations, then sends exact version and stable close key', () => {
    const command = vi.fn().mockResolvedValue(false)
    render(<CashierReportEditor report={report} isAdmin={false} busy={false} onCommand={command} />)
    const close = screen.getByRole('button', { name: 'Zamknij dzień' })
    expect((close as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/Potwierdzam: w kasie zostaje/))
    fireEvent.click(screen.getByLabelText(/Potwierdzam: przygotowany depozyt/))
    expect((close as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(close)
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ action: 'closeReport', costCenterId: 'PUL', reportId: 'report-1', version: 2, retainedConfirmed: true, depositConfirmed: true }))
  })

  it('never closes unsaved changes and resets confirmations after a version change', () => {
    const command = vi.fn().mockResolvedValue(true)
    const { rerender } = render(<CashierReportEditor report={report} isAdmin={false} busy={false} onCommand={command} />)
    fireEvent.click(screen.getByLabelText(/Potwierdzam: w kasie zostaje/))
    fireEvent.click(screen.getByLabelText(/Potwierdzam: przygotowany depozyt/))
    fireEvent.change(screen.getByLabelText('Policzona gotówka'), { target: { value: '1660' } })
    expect((screen.getByRole('button', { name: 'Zamknij dzień' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<CashierReportEditor report={{ ...report, version: 3, targetFloatCents: 25000, retainedCents: 25000, depositCents: 142000 }} isAdmin={false} busy={false} onCommand={command} />)
    expect((screen.getByLabelText(/Potwierdzam: w kasie zostaje/) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Zamknij dzień' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('blocks close with an open operation form and cannot carry it to another report', () => {
    const props = { isAdmin: false, busy: false, onCommand: vi.fn().mockResolvedValue(true) }
    const { rerender } = render(<CashierReportEditor report={report} {...props} />)
    fireEvent.click(screen.getByLabelText(/Potwierdzam: w kasie zostaje/))
    fireEvent.click(screen.getByLabelText(/Potwierdzam: przygotowany depozyt/))
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj operację', exact: true }))
    fireEvent.change(screen.getByLabelText('Kwota operacji'), { target: { value: '100' } })
    expect((screen.getByRole('button', { name: 'Zamknij dzień' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Policzona gotówka') as HTMLInputElement).disabled).toBe(true)
    rerender(<CashierReportEditor report={{ ...report, id: 'report-2', businessDate: '2026-09-10' }} {...props} />)
    expect(screen.queryByLabelText('Kwota operacji')).toBeNull()
  })

  it('restores immutable saved numbers after cancelling a correction', () => {
    render(<CashierReportEditor report={{ ...report, status: 'CLOSED', canCorrect: true }} isAdmin busy={false} onCommand={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Korekta rozliczenia' }))
    fireEvent.change(screen.getByLabelText('Policzona gotówka'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zrezygnuj z korekty' }))
    expect((screen.getByLabelText('Policzona gotówka') as HTMLInputElement).value).toBe('1670,00')
    expect((screen.getByLabelText('Policzona gotówka') as HTMLInputElement).disabled).toBe(true)
  })

  it('warns before discarding a draft and preserves it when navigation is cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(bootstrap)))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<CashierView />)
    const field = await screen.findByLabelText('Policzona gotówka')
    fireEvent.change(field, { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Depozyty', exact: true }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Policzona gotówka') as HTMLInputElement).value).toBe('999')
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Depozyty', exact: true }))
    expect(screen.queryByLabelText('Policzona gotówka')).toBeNull()
  })

  it('locks uncertain writes until readback and explicitly discarded inputs reset even at unchanged version', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(bootstrap)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json(bootstrap))
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CashierView />)
    fireEvent.change(await screen.findByLabelText('Policzona gotówka'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz kwoty' }))
    await screen.findByText('Zapis jest zablokowany do czasu odświeżenia stanu.')
    expect((screen.getByRole('button', { name: 'Zapisz kwoty' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Odśwież stan' }))
    await waitFor(() => expect((screen.getByLabelText('Policzona gotówka') as HTMLInputElement).value).toBe('1670,00'))
    await waitFor(() => expect(screen.queryByText('Zapis jest zablokowany do czasu odświeżenia stanu.')).toBeNull())
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('lets the user clear an invalid period without a browser restart', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json(bootstrap)).mockResolvedValueOnce(Response.json({ error: 'Sprawdź daty' }, { status: 400 })).mockResolvedValueOnce(Response.json(bootstrap)))
    render(<CashierView />)
    fireEvent.change(await screen.findByLabelText('Okres od'), { target: { value: '2026-13-40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zastosuj okres' }))
    await screen.findByText('Sprawdź daty')
    expect((screen.getByRole('button', { name: 'Wyczyść okres' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść okres' }))
    await waitFor(() => expect(screen.queryByText('Sprawdź daty')).toBeNull())
    expect((screen.getByLabelText('Okres od') as HTMLInputElement).value).toBe('')
  })
})
