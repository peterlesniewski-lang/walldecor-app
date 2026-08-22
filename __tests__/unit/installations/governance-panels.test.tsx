import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OwnershipPanel } from '@/components/installations/ownership-panel'
import { VisitFeePanel } from '@/components/installations/visit-fee-panel'
import { VisitFeeSettingsPanel } from '@/components/installations/visit-fee-settings-panel'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const employees = [
  { id: 'owner', firstName: 'Anna', lastName: 'Opiekun' },
  { id: 'backup', firstName: 'Bartek', lastName: 'Zastępca' },
  { id: 'delegate', firstName: 'Celina', lastName: 'Delegatka' },
]

describe('installation governance panels', () => {
  it('lets a manager establish a real, bounded delegation from the ownership panel', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ delegation: { id: 'delegation-1' } }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<OwnershipPanel
      orderId="order-1"
      employees={employees}
      owners={{ primary: employees[0], backup: employees[1] }}
      delegations={[]}
      history={[]}
      canManage
    />)

    await user.selectOptions(screen.getByLabelText('Osoba przejmująca'), 'delegate')
    await user.type(screen.getByLabelText('Początek delegacji'), '2026-08-23T08:00')
    await user.type(screen.getByLabelText('Koniec delegacji'), '2026-08-24T18:00')
    await user.type(screen.getByLabelText('Powód delegacji'), 'Zaplanowane zastępstwo')
    await user.click(screen.getByRole('button', { name: 'Ustanów czasowe zastępstwo' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/installations/order-1/ownership', expect.objectContaining({
      method: 'PATCH', body: expect.stringContaining('CREATE_DELEGATION'),
    }))
  })

  it('lets an owner select a legally approved default fee and keeps a pending override visibly pending', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ order: { id: 'order-1' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<VisitFeePanel
      orderId="order-1"
      canEdit
      canApprove={false}
      fee={{ status: 'NONE', grossAmount: null, clauseVersion: null, legalApprovedAt: null, selectedAt: null, overrideReason: null, approvedAt: null, clientAcceptedAt: null }}
      defaultPolicy={{ version: 4, grossAmount: '249.90', legalApprovedAt: new Date('2026-08-20T00:00:00.000Z') }}
    />)

    expect(screen.getByText(/249,90 zł brutto/i)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Użyj domyślnej kwoty' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/installations/order-1/visit-fee', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ action: 'USE_DEFAULT' }),
    }))
  })

  it('lets an administrator add a new inactive legal-clause version without inventing legal text', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ policies: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ policy: {
        id: 'policy-1', version: 1, grossAmount: '249.90',
        clauseText: 'Wersja przekazana do sprawdzenia prawnego przed aktywacją w formularzu klienta.',
        legalApprovedAt: null, isDefault: true,
      } }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<VisitFeeSettingsPanel />)

    await screen.findByText(/Brak zatwierdzenia prawnego/i)
    await user.type(screen.getByLabelText('Domyślna kwota brutto'), '249,90')
    await user.type(screen.getByLabelText('Treść klauzuli'), 'Wersja przekazana do sprawdzenia prawnego przed aktywacją w formularzu klienta.')
    await user.click(screen.getByRole('button', { name: 'Dodaj nową wersję' }))

    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings/installation-visit-fee', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('249,90'),
    }))
    expect(await screen.findByText(/Brak zatwierdzenia prawnego — nieaktywna/i)).not.toBeNull()
  })
})
