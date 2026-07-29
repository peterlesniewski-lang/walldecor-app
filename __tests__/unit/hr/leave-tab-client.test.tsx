import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaveTabClient } from '@/components/hr/employees/leave-tab-client'

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

const leaveType = {
  id: 'leave-type-vl',
  name: 'Urlop wypoczynkowy',
  code: 'VL',
  color: '#3B82F6',
}

const balance = {
  id: 'balance-1',
  year: 2026,
  totalDays: 26,
  usedDays: 5,
  pendingDays: 2,
  carriedOver: 3,
  leaveType,
}

const request = {
  id: 'request-1',
  startDate: '2026-07-20T00:00:00.000Z',
  endDate: '2026-07-21T00:00:00.000Z',
  days: 2,
  status: 'approved',
  leaveType,
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('LeaveTabClient balance permissions', () => {
  it('keeps balances and requests visible without add or edit controls', () => {
    render(
      <LeaveTabClient
        employeeId="employee-1"
        balances={[balance]}
        requests={[request]}
        canEditBalance={false}
      />
    )

    expect(screen.getByText('Saldo urlopowe')).toBeTruthy()
    expect(screen.getByText('5 / 26 dni')).toBeTruthy()
    expect(screen.getByText('Ostatnie wnioski')).toBeTruthy()
    expect(screen.getAllByText('Urlop wypoczynkowy').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Dodaj saldo' })).toBeNull()
    expect(screen.queryByTitle('Edytuj saldo')).toBeNull()
  })

  it('requires a trimmed correction reason and sends it in the edit PATCH body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: balance.id }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <LeaveTabClient
        employeeId="employee-1"
        balances={[balance]}
        requests={[]}
        canEditBalance
      />
    )

    await user.click(screen.getByTitle('Edytuj saldo'))
    const year = screen.getByLabelText('Rok') as HTMLInputElement
    expect(year.value).toBe('2026')
    expect(year.disabled).toBe(true)
    const totalDays = screen.getByLabelText('Dni urlopowe (łącznie)')
    const reason = screen.getByLabelText('Powód korekty')
    await user.clear(totalDays)
    await user.type(totalDays, '20')
    await user.type(reason, 'ab')
    await user.click(screen.getByRole('button', { name: 'Zapisz' }))

    expect(screen.getByText('Powód korekty musi mieć od 3 do 1000 znaków')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(reason, 'c')
    await user.click(screen.getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/hr/leave-balances/balance-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalDays: 20, reason: 'abc' }),
    })
    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce())
  })

  it('shows a server edit error and retains the entered values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: 'Korekta nie zmienia salda' }, 422)
    ))
    const user = userEvent.setup()
    render(
      <LeaveTabClient
        employeeId="employee-1"
        balances={[balance]}
        requests={[]}
        canEditBalance
      />
    )

    await user.click(screen.getByTitle('Edytuj saldo'))
    await user.clear(screen.getByLabelText('Dni urlopowe (łącznie)'))
    await user.type(screen.getByLabelText('Dni urlopowe (łącznie)'), '20')
    await user.type(screen.getByLabelText('Powód korekty'), 'Korekta limitu')
    await user.click(screen.getByRole('button', { name: 'Zapisz' }))

    expect((await screen.findByRole('alert')).textContent)
      .toContain('Korekta nie zmienia salda')
    expect((screen.getByLabelText('Dni urlopowe (łącznie)') as HTMLInputElement).value)
      .toBe('20')
    expect((screen.getByLabelText('Powód korekty') as HTMLInputElement).value)
      .toBe('Korekta limitu')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('keeps the add balance POST unchanged and does not add a reason', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/hr/leave-types') return jsonResponse([leaveType])
      if (String(input) === '/api/hr/leave-balances' && init?.method === 'POST') {
        return jsonResponse({ id: 'balance-new' }, 201)
      }
      throw new Error(`Unexpected fetch: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <LeaveTabClient
        employeeId="employee-1"
        balances={[]}
        requests={[]}
        canEditBalance
      />
    )

    await user.click(screen.getByRole('button', { name: 'Dodaj saldo' }))
    await user.selectOptions(await screen.findByLabelText('Typ urlopu'), leaveType.id)
    await user.type(screen.getByLabelText('Dni urlopowe (łącznie)'), '26')
    await user.click(screen.getByRole('button', { name: 'Dodaj' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
    })
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(postCall[1]?.body))).toEqual({
      employeeId: 'employee-1',
      leaveTypeId: 'leave-type-vl',
      year: new Date().getFullYear(),
      totalDays: 26,
    })
  })
})
