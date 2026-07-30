import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from 'next-auth/react'
import LeaveBalancesPage from '@/app/(dashboard)/hr/leave/balances/page'

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
}))

vi.mock('@/components/hr/leave/admin-leave-button', () => ({
  AdminLeaveButton: () => <button>Dodaj urlop</button>,
}))

const mockUseSession = vi.mocked(useSession)

const employee = {
  id: 'employee-1',
  firstName: 'Anna',
  lastName: 'Nowak',
  email: 'anna.nowak@test.pl',
  costCenter: null,
}

const balance = {
  id: 'balance-1',
  employeeId: employee.id,
  leaveTypeId: 'leave-type-vl',
  year: new Date().getFullYear(),
  totalDays: 26,
  usedDays: 5,
  pendingDays: 2,
  carriedOver: 3,
  leaveType: {
    id: 'leave-type-vl',
    name: 'Urlop wypoczynkowy',
    code: 'VL',
    color: '#123456',
  },
  employee,
}

function session(role: 'ADMIN' | 'MANAGER') {
  return {
    user: {
      id: `${role.toLowerCase()}-user`,
      name: role,
      email: `${role.toLowerCase()}@test.pl`,
      role,
      employeeId: role === 'MANAGER' ? 'manager-employee' : null,
    },
    expires: '',
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function installFetchMock(options: {
  carryover?: () => Promise<Response>
  rejectBalanceRefresh?: boolean
} = {}) {
  let balanceRequestCount = 0
  const fetchMock = vi.fn(async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input)

    if (url === '/api/hr/employees?limit=200&status=active') {
      return jsonResponse({ employees: [employee] })
    }
    if (url.startsWith('/api/hr/leave-balances?') && !init?.method) {
      balanceRequestCount++
      if (options.rejectBalanceRefresh && balanceRequestCount > 1) {
        throw new Error('refresh failed')
      }
      return jsonResponse([balance])
    }
    if (
      url === '/api/hr/leave-balances/carryover' &&
      init?.method === 'POST'
    ) {
      if (options.carryover) return options.carryover()
      return jsonResponse({
        processed: 2,
        created: 1,
        updated: 0,
        skipped: 1,
        needsReview: [
          {
            employeeId: 'employee-review',
            employeeName: 'Jan Kowalski',
          },
        ],
      })
    }
    if (
      url === `/api/hr/leave-balances/${balance.id}` &&
      init?.method === 'PATCH'
    ) {
      return jsonResponse({
        ...balance,
        totalDays: 24,
      })
    }

    throw new Error(`Unexpected fetch: ${url}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LeaveBalancesPage', () => {
  it('submits a VL carryover reason and renders counts with needs-review employees', async () => {
    mockUseSession.mockReturnValue({
      data: session('ADMIN'),
      status: 'authenticated',
      update: vi.fn(),
    })
    const fetchMock = installFetchMock()
    const user = userEvent.setup()
    render(<LeaveBalancesPage />)

    await user.click(await screen.findByRole('button', {
      name: 'Przenieś na nowy rok',
    }))

    const dialog = screen.getByRole('dialog', {
      name: 'Przeniesienie dni na nowy rok',
    })
    expect(within(dialog).getByText(/urlopu wypoczynkowego.*VL/i))
      .not.toBeNull()

    await user.type(
      within(dialog).getByLabelText('Powód przeniesienia'),
      'Zamknięcie roku urlopowego'
    )
    await user.type(
      within(dialog).getByLabelText(/Maks. dni do przeniesienia/i),
      '4'
    )
    await user.click(within(dialog).getByRole('button', {
      name: 'Przenieś dni',
    }))

    expect((await within(dialog).findByRole('status')).textContent)
      .toContain('Przeniesienie zakończone')
    expect(within(dialog).getByText('2')).not.toBeNull()
    expect(within(dialog).getAllByText('1')).toHaveLength(2)
    expect(within(dialog).getByText('Jan Kowalski')).not.toBeNull()
    expect(within(dialog).getByText(/ustawić wymiar.*profilu pracownika/i))
      .not.toBeNull()

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/hr/leave-balances/carryover' &&
        (init as RequestInit | undefined)?.method === 'POST'
    )
    expect(postCall).toBeDefined()
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body)))
      .toEqual({
        fromYear: new Date().getFullYear() - 1,
        toYear: new Date().getFullYear(),
        maxCarryoverDays: 4,
        reason: 'Zamknięcie roku urlopowego',
      })
  })

  it('keeps carryover and balance corrections unavailable to managers', async () => {
    mockUseSession.mockReturnValue({
      data: session('MANAGER'),
      status: 'authenticated',
      update: vi.fn(),
    })
    installFetchMock()
    render(<LeaveBalancesPage />)

    await screen.findByText('VL')

    expect(screen.queryByRole('button', {
      name: 'Przenieś na nowy rok',
    })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dodaj urlop' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edytuj saldo' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Akcje' })).toBeNull()
  })

  it('contains focus, closes on Escape, and restores focus to the carryover trigger', async () => {
    mockUseSession.mockReturnValue({
      data: session('ADMIN'),
      status: 'authenticated',
      update: vi.fn(),
    })
    installFetchMock()
    const user = userEvent.setup()
    render(<LeaveBalancesPage />)

    const trigger = await screen.findByRole('button', {
      name: 'Przenieś na nowy rok',
    })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', {
      name: 'Przeniesienie dni na nowy rok',
    })
    const firstField = within(dialog).getByLabelText('Z roku')

    await waitFor(() => {
      expect(document.activeElement).toBe(firstField)
    })

    await user.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', {
        name: 'Przeniesienie dni na nowy rok',
      })).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps a consequential carryover request open until the POST settles', async () => {
    mockUseSession.mockReturnValue({
      data: session('ADMIN'),
      status: 'authenticated',
      update: vi.fn(),
    })
    const post = deferred<Response>()
    const fetchMock = installFetchMock({
      carryover: () => post.promise,
    })
    const user = userEvent.setup()
    render(<LeaveBalancesPage />)

    await user.click(await screen.findByRole('button', {
      name: 'Przenieś na nowy rok',
    }))
    const dialog = screen.getByRole('dialog', {
      name: 'Przeniesienie dni na nowy rok',
    })
    await user.type(
      within(dialog).getByLabelText('Powód przeniesienia'),
      'Zamknięcie roku urlopowego'
    )
    await user.click(within(dialog).getByRole('button', {
      name: 'Przenieś dni',
    }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        ([url, init]) =>
          url === '/api/hr/leave-balances/carryover' &&
          (init as RequestInit | undefined)?.method === 'POST'
      )).toBe(true)
    })

    expect(within(dialog).queryByText('Przeniesienie zakończone')).toBeNull()
    expect((within(dialog).getByLabelText('Z roku') as HTMLInputElement).disabled)
      .toBe(true)
    expect((within(dialog).getByLabelText('Na rok') as HTMLInputElement).disabled)
      .toBe(true)
    expect((
      within(dialog).getByLabelText(/Maks. dni do przeniesienia/i) as HTMLInputElement
    ).disabled).toBe(true)
    expect((
      within(dialog).getByLabelText('Powód przeniesienia') as HTMLTextAreaElement
    ).disabled).toBe(true)

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', {
      name: 'Przeniesienie dni na nowy rok',
    })).toBe(dialog)

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('dialog', {
      name: 'Przeniesienie dni na nowy rok',
    })).toBe(dialog)

    const overlay = dialog.previousElementSibling
    expect(overlay).not.toBeNull()
    fireEvent.pointerDown(overlay as Element)
    fireEvent.click(overlay as Element)
    expect(screen.getByRole('dialog', {
      name: 'Przeniesienie dni na nowy rok',
    })).toBe(dialog)

    post.resolve(jsonResponse({
      processed: 1,
      created: 1,
      updated: 0,
      skipped: 0,
      needsReview: [],
    }))

    expect(await within(dialog).findByText('Przeniesienie zakończone'))
      .not.toBeNull()
  })

  it('keeps the successful result and warns when refreshing balances fails', async () => {
    mockUseSession.mockReturnValue({
      data: session('ADMIN'),
      status: 'authenticated',
      update: vi.fn(),
    })
    installFetchMock({ rejectBalanceRefresh: true })
    const user = userEvent.setup()
    render(<LeaveBalancesPage />)

    await user.click(await screen.findByRole('button', {
      name: 'Przenieś na nowy rok',
    }))
    const dialog = screen.getByRole('dialog', {
      name: 'Przeniesienie dni na nowy rok',
    })
    await user.type(
      within(dialog).getByLabelText('Powód przeniesienia'),
      'Zamknięcie roku urlopowego'
    )
    await user.click(within(dialog).getByRole('button', {
      name: 'Przenieś dni',
    }))

    expect(await within(dialog).findByText('Przeniesienie zakończone'))
      .not.toBeNull()
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Przeniesienie zapisane, nie udało się odświeżyć'
    )
  })

  it('requires and sends an inline correction reason without editing the year', async () => {
    mockUseSession.mockReturnValue({
      data: session('ADMIN'),
      status: 'authenticated',
      update: vi.fn(),
    })
    const fetchMock = installFetchMock()
    const user = userEvent.setup()
    render(<LeaveBalancesPage />)

    await user.click(await screen.findByRole('button', {
      name: 'Edytuj saldo',
    }))

    const reasonInput = screen.getByLabelText(
      'Powód korekty'
    ) as HTMLInputElement
    expect(reasonInput.required).toBe(true)
    expect(reasonInput.minLength).toBe(3)
    expect(reasonInput.maxLength).toBe(1000)

    const totalInput = screen.getByLabelText(
      'Przysługuje'
    ) as HTMLInputElement
    await user.clear(totalInput)
    await user.type(totalInput, '24')
    await user.type(reasonInput, 'Korekta wymiaru po weryfikacji')
    await user.click(screen.getByRole('button', { name: 'Zapisz korektę' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        ([url, init]) =>
          url === `/api/hr/leave-balances/${balance.id}` &&
          (init as RequestInit | undefined)?.method === 'PATCH'
      )).toBe(true)
    })

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === `/api/hr/leave-balances/${balance.id}` &&
        (init as RequestInit | undefined)?.method === 'PATCH'
    )
    const payload = JSON.parse(String((patchCall?.[1] as RequestInit).body))

    expect(payload).toEqual({
      totalDays: 24,
      usedDays: 5,
      carriedOver: 3,
      reason: 'Korekta wymiaru po weryfikacji',
    })
    expect(payload).not.toHaveProperty('year')
  })

  it.each([
    ['blank total', 'Przysługuje', '', 'Przysługuje musi być liczbą nieujemną'],
    ['negative used', 'Wykorzystane', '-1', 'Wykorzystane musi być liczbą nieujemną'],
    ['invalid carried', 'Przeniesione', '1e309', 'Przeniesione musi być liczbą nieujemną'],
    [
      'carried over above total',
      'Przeniesione',
      '27',
      'Przeniesione dni nie mogą przekraczać liczby dni przysługujących',
    ],
  ])('blocks inline correction for %s without PATCH', async (
    _label,
    fieldLabel,
    value,
    expectedError
  ) => {
    mockUseSession.mockReturnValue({
      data: session('ADMIN'),
      status: 'authenticated',
      update: vi.fn(),
    })
    const fetchMock = installFetchMock()
    const user = userEvent.setup()
    render(<LeaveBalancesPage />)

    await user.click(await screen.findByRole('button', {
      name: 'Edytuj saldo',
    }))
    const field = screen.getByLabelText(fieldLabel)
    fireEvent.change(field, { target: { value } })
    await user.type(
      screen.getByLabelText('Powód korekty'),
      'Korekta po weryfikacji'
    )
    await user.click(screen.getByRole('button', { name: 'Zapisz korektę' }))

    expect(screen.getByRole('alert').textContent).toContain(expectedError)
    expect(fetchMock.mock.calls.some(
      ([url, init]) =>
        url === `/api/hr/leave-balances/${balance.id}` &&
        (init as RequestInit | undefined)?.method === 'PATCH'
    )).toBe(false)
  })

  it('rejects an inline correction reason longer than 1000 characters without PATCH', async () => {
    mockUseSession.mockReturnValue({
      data: session('ADMIN'),
      status: 'authenticated',
      update: vi.fn(),
    })
    const fetchMock = installFetchMock()
    const user = userEvent.setup()
    render(<LeaveBalancesPage />)

    await user.click(await screen.findByRole('button', {
      name: 'Edytuj saldo',
    }))
    fireEvent.change(screen.getByLabelText('Powód korekty'), {
      target: { value: 'x'.repeat(1001) },
    })
    await user.click(screen.getByRole('button', { name: 'Zapisz korektę' }))

    expect(screen.getByRole('alert').textContent).toContain(
      'Powód korekty może mieć maksymalnie 1000 znaków'
    )
    expect(fetchMock.mock.calls.some(
      ([url, init]) =>
        url === `/api/hr/leave-balances/${balance.id}` &&
        (init as RequestInit | undefined)?.method === 'PATCH'
    )).toBe(false)
  })
})
