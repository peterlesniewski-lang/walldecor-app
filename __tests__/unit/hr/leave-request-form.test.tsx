import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaveRequestForm } from '@/components/hr/leave/leave-request-form'

vi.mock('@/components/hr/employees/employee-select', () => ({
  EmployeeSelect: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string
    onChange: (value: string | undefined) => void
    placeholder?: string
  }) => {
    if (placeholder?.includes('zastępcę')) {
      return <div data-testid="substitute-select" />
    }

    return (
      <select
        aria-label={placeholder}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">Wybierz pracownika</option>
        <option value="employee-1">Pracownik 1</option>
        <option value="employee-a">Pracownik A</option>
        <option value="employee-b">Pracownik B</option>
      </select>
    )
  },
}))

const leaveTypes = [
  {
    id: 'leave-type-vl',
    name: 'Urlop wypoczynkowy',
    code: 'VL',
    color: '#3B82F6',
    isPaid: true,
    requiresApproval: true,
    tracksBalance: true,
    parentId: null,
  },
  {
    id: 'leave-type-vld',
    name: 'Urlop na żądanie',
    code: 'VLD',
    color: '#8B5CF6',
    isPaid: true,
    requiresApproval: true,
    tracksBalance: true,
    parentId: 'leave-type-vl',
  },
  {
    id: 'leave-type-ub',
    name: 'Urlop bezpłatny',
    code: 'UB',
    color: '#64748B',
    isPaid: false,
    requiresApproval: true,
    tracksBalance: false,
    parentId: null,
  },
  {
    id: 'leave-type-sl',
    name: 'Zwolnienie chorobowe',
    code: 'SL',
    color: '#EF4444',
    isPaid: true,
    requiresApproval: false,
    tracksBalance: false,
    parentId: null,
  },
  {
    id: 'leave-type-custom',
    name: 'Urlop dodatkowy',
    code: 'CUSTOM',
    color: '#10B981',
    isPaid: true,
    requiresApproval: true,
    tracksBalance: true,
    parentId: null,
  },
]

const balances = [
  {
    id: 'balance-vl',
    leaveTypeId: 'leave-type-vl',
    leaveType: leaveTypes[0],
    year: 2026,
    totalDays: 20,
    usedDays: 3,
    pendingDays: 1,
    carriedOver: 0,
  },
  {
    id: 'balance-custom',
    leaveTypeId: 'leave-type-custom',
    leaveType: leaveTypes[4],
    year: 2026,
    totalDays: 10,
    usedDays: 4,
    pendingDays: 0,
    carriedOver: 0,
  },
]

const historicalRequests = [
  {
    days: 1.5,
    isOnDemand: true,
    status: 'approved',
    leaveType: { code: 'VL' },
  },
  {
    days: 1,
    isOnDemand: false,
    status: 'pending',
    leaveType: { code: 'VLD' },
  },
  {
    days: 2,
    isOnDemand: true,
    status: 'cancelled',
    leaveType: { code: 'VL' },
  },
  {
    days: 1,
    isOnDemand: true,
    status: 'rejected',
    leaveType: { code: 'VLD' },
  },
]

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

function installFetchMock(requestRows = historicalRequests) {
  const fetchMock = vi.fn(async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input)

    if (url === '/api/hr/leave-types?activeOnly=true') {
      return jsonResponse(leaveTypes)
    }
    if (url.startsWith('/api/hr/leave-balances?')) {
      return jsonResponse(balances)
    }
    if (url.startsWith('/api/hr/leave-requests?')) {
      return jsonResponse(requestRows)
    }
    if (url === '/api/hr/leave-requests' && init?.method === 'POST') {
      return jsonResponse({ id: 'request-created' }, 201)
    }

    throw new Error(`Unexpected fetch: ${url}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderForm(onSuccess = vi.fn()) {
  render(
    <LeaveRequestForm
      employeeId="employee-1"
      onSuccess={onSuccess}
      onCancel={vi.fn()}
    />
  )

  return { onSuccess }
}

function dateInputs() {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="date"]')
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LeaveRequestForm', () => {
  it('renders VLD as a leave type and has no standalone on-demand checkbox', async () => {
    installFetchMock()
    renderForm()

    expect(await screen.findByRole('option', { name: /VLD.*Urlop na żądanie/i }))
      .not.toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Urlop na żądanie/i }))
      .toBeNull()
  })

  it('uses the VL balance for VLD and submits it as on-demand leave', async () => {
    const fetchMock = installFetchMock()
    const { onSuccess } = renderForm()
    const user = userEvent.setup()

    const typeSelect = await screen.findByRole('combobox')
    await user.selectOptions(typeSelect, 'leave-type-vld')

    expect(screen.getByRole('option', {
      name: /VLD.*16 dni pozostałych/i,
    })).not.toBeNull()
    expect(await screen.findByText('16 / 20 dni')).not.toBeNull()

    const [startDate, endDate] = dateInputs()
    await user.type(startDate, '2026-07-30')
    await user.type(endDate, '2026-07-30')
    await user.click(screen.getByRole('button', { name: 'Złóż wniosek' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/hr/leave-requests' &&
        (init as RequestInit | undefined)?.method === 'POST'
    )
    expect(postCall).toBeDefined()
    expect(JSON.parse(String((postCall?.[1] as RequestInit).body))).toMatchObject({
      leaveTypeId: 'leave-type-vld',
      isOnDemand: true,
    })
  })

  it('sums historical on-demand days and excludes cancelled and rejected rows', async () => {
    installFetchMock()
    renderForm()
    const user = userEvent.setup()

    const typeSelect = await screen.findByRole('combobox')
    await user.selectOptions(typeSelect, 'leave-type-vld')

    expect(await screen.findByText('Pozostało: 1,5 z 4 dni')).not.toBeNull()
  })

  it.each([
    ['leave-type-ub', 'UB'],
    ['leave-type-sl', 'SL'],
  ])('shows no-balance behavior for %s without an insufficient warning', async (id) => {
    installFetchMock()
    renderForm()
    const user = userEvent.setup()

    const typeSelect = await screen.findByRole('combobox')
    await user.selectOptions(typeSelect, id)
    const [startDate, endDate] = dateInputs()
    await user.type(startDate, '2026-07-30')
    await user.type(endDate, '2026-07-30')

    expect(screen.getByText('Ten typ nie pomniejsza salda urlopowego.'))
      .not.toBeNull()
    expect(screen.queryByText(/Niewystarczające saldo urlopowe/i))
      .toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Złóż wniosek' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  })

  it('keeps an ordinary tracked leave type on its own balance pool', async () => {
    installFetchMock()
    renderForm()
    const user = userEvent.setup()

    const typeSelect = await screen.findByRole('combobox')
    await user.selectOptions(typeSelect, 'leave-type-custom')

    expect(screen.getByRole('option', {
      name: /CUSTOM.*6 dni pozostałych/i,
    })).not.toBeNull()
    expect(screen.getByText('6 / 10 dni')).not.toBeNull()
  })

  it('loads balances and on-demand history for the UTC year selected by start date', async () => {
    const fetchMock = installFetchMock()
    renderForm()
    const user = userEvent.setup()

    await screen.findByRole('option', { name: /VLD.*Urlop na żądanie/i })
    const [startDate] = dateInputs()
    await user.type(startDate, '2028-03-06')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/hr/leave-balances?employeeId=employee-1&year=2028',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })

    const typeSelect = screen.getByRole('option', {
      name: /VLD.*Urlop na żądanie/i,
    }).closest('select')!
    await user.selectOptions(typeSelect, 'leave-type-vld')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/hr/leave-requests?employeeId=employee-1&year=2028',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })
  })

  it('does not submit a request spanning two UTC years', async () => {
    const fetchMock = installFetchMock()
    renderForm()
    const user = userEvent.setup()

    const typeSelect = await screen.findByRole('combobox')
    await user.selectOptions(typeSelect, 'leave-type-ub')
    const [startDate] = dateInputs()
    await user.type(startDate, '2027-12-30')
    const endDate = await waitFor(() => {
      const input = dateInputs()[1]
      expect(input).toBeDefined()
      return input
    })
    await user.type(endDate, '2028-01-03')

    fireEvent.submit(screen.getByRole('button', {
      name: 'Złóż wniosek',
    }).closest('form')!)

    expect(await screen.findByText(/ten sam rok/i)).not.toBeNull()
    expect(fetchMock.mock.calls.find(
      ([url, init]) =>
        url === '/api/hr/leave-requests' &&
        (init as RequestInit | undefined)?.method === 'POST'
    )).toBeUndefined()
  })

  it('ignores a late balance response for employee A after employee B is selected', async () => {
    const employeeAResponse = deferred<Response>()
    const balancesA = [{
      ...balances[0],
      id: 'balance-a',
      totalDays: 5,
      usedDays: 4,
      pendingDays: 0,
    }]
    const balancesB = [{
      ...balances[0],
      id: 'balance-b',
      totalDays: 30,
      usedDays: 2,
      pendingDays: 0,
    }]
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      void init
      const url = String(input)
      if (url === '/api/hr/leave-types?activeOnly=true') {
        return Promise.resolve(jsonResponse(leaveTypes))
      }
      if (url.includes('employeeId=employee-a')) {
        return employeeAResponse.promise
      }
      if (url.includes('employeeId=employee-b')) {
        return Promise.resolve(jsonResponse(balancesB))
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <LeaveRequestForm
        isAdmin
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const employeeSelect = screen.getByRole('combobox', {
      name: /Wybierz pracownika/i,
    })
    await user.selectOptions(employeeSelect, 'employee-a')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) =>
        String(url).includes('employeeId=employee-a')
      )).toBe(true)
    })
    const employeeACall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('employeeId=employee-a')
    )

    await user.selectOptions(employeeSelect, 'employee-b')
    expect(await screen.findByRole('option', {
      name: /^VL\b.*28 dni pozostałych/i,
    })).not.toBeNull()
    expect((employeeACall?.[1] as RequestInit | undefined)?.signal?.aborted)
      .toBe(true)

    await act(async () => {
      employeeAResponse.resolve(jsonResponse(balancesA))
      await Promise.resolve()
    })
    expect(screen.getByRole('option', {
      name: /^VL\b.*28 dni pozostałych/i,
    })).not.toBeNull()
    expect(screen.queryByRole('option', {
      name: /^VL\b.*1 dni pozostałych/i,
    })).toBeNull()
  })

  it('ignores late on-demand history from the previous employee', async () => {
    const employeeAHistory = deferred<Response>()
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      void init
      const url = String(input)
      if (url === '/api/hr/leave-types?activeOnly=true') {
        return Promise.resolve(jsonResponse(leaveTypes))
      }
      if (url.startsWith('/api/hr/leave-balances?')) {
        return Promise.resolve(jsonResponse(balances))
      }
      if (url.includes('/api/hr/leave-requests?') && url.includes('employee-a')) {
        return employeeAHistory.promise
      }
      if (url.includes('/api/hr/leave-requests?') && url.includes('employee-b')) {
        return Promise.resolve(jsonResponse([{
          days: 1,
          isOnDemand: true,
          status: 'approved',
          leaveType: { code: 'VL' },
        }]))
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <LeaveRequestForm
        isAdmin
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const employeeSelect = screen.getByRole('combobox', {
      name: /Wybierz pracownika/i,
    })
    await user.selectOptions(employeeSelect, 'employee-a')
    let typeSelect = (await screen.findByRole('option', {
      name: /VLD.*Urlop na żądanie/i,
    })).closest('select')!
    await user.selectOptions(typeSelect, 'leave-type-vld')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/leave-requests?') &&
        String(url).includes('employee-a')
      )).toBe(true)
    })

    await user.selectOptions(employeeSelect, 'employee-b')
    typeSelect = (await screen.findByRole('option', {
      name: /VLD.*Urlop na żądanie/i,
    })).closest('select')!
    await user.selectOptions(typeSelect, 'leave-type-vld')
    expect(await screen.findByText('Pozostało: 3 z 4 dni')).not.toBeNull()

    await act(async () => {
      employeeAHistory.resolve(jsonResponse([{
        days: 3,
        isOnDemand: true,
        status: 'approved',
        leaveType: { code: 'VL' },
      }]))
      await Promise.resolve()
    })
    expect(screen.getByText('Pozostało: 3 z 4 dni')).not.toBeNull()
    expect(screen.queryByText('Pozostało: 1 z 4 dni')).toBeNull()
  })
})
