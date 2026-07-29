import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeaveRequestForm } from '@/components/hr/leave/leave-request-form'

vi.mock('@/components/hr/employees/employee-select', () => ({
  EmployeeSelect: () => <div data-testid="employee-select" />,
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
})
