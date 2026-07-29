import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LeaveTypesPage from '@/app/(dashboard)/hr/leave/types/page'

interface TestLeaveType {
  id: string
  name: string
  code: string
  color: string
  isPaid: boolean
  requiresApproval: boolean
  tracksBalance: boolean
  maxDaysPerYear: number | null
  isActive: boolean
  parentId: string | null
  subtypes: TestLeaveType[]
  _count: {
    leaveBalancesNew: number
    leaveRequestsNew: number
  }
}

function leaveType(
  code: string,
  overrides: Partial<TestLeaveType> = {}
): TestLeaveType {
  return {
    id: `leave-type-${code.toLowerCase()}`,
    name: code,
    code,
    color: '#123456',
    isPaid: code !== 'UB',
    requiresApproval: code !== 'SL',
    tracksBalance: !['SL', 'UB'].includes(code),
    maxDaysPerYear: code === 'VLD' ? 4 : null,
    isActive: true,
    parentId: code === 'VLD' ? 'leave-type-vl' : null,
    subtypes: [],
    _count: {
      leaveBalancesNew: 0,
      leaveRequestsNew: 0,
    },
    ...overrides,
  }
}

const vld = leaveType('VLD', { name: 'Urlop na żądanie' })
const leaveTypes = [
  leaveType('VL', {
    name: 'Urlop wypoczynkowy',
    subtypes: [vld],
  }),
  leaveType('UB', { name: 'Urlop bezpłatny' }),
  leaveType('CUSTOM', { name: 'Urlop dodatkowy' }),
]

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function installFetchMock(patchStatus = 200) {
  const protectedError =
    'Typ VLD: chroniona reguła „pomniejsza saldo” wymaga wartości tak.'
  const fetchMock = vi.fn(async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input)

    if (url === '/api/hr/leave-types' && !init?.method) {
      return jsonResponse(leaveTypes)
    }
    if (url.startsWith('/api/hr/leave-types/') && init?.method === 'PATCH') {
      return patchStatus === 200
        ? jsonResponse(leaveType('CUSTOM'))
        : jsonResponse({ error: protectedError }, patchStatus)
    }

    throw new Error(`Unexpected fetch: ${url}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, protectedError }
}

function rowForCode(code: string) {
  const codeCell = screen.getByText(code)
  const row = codeCell.closest('tr')
  if (!row) throw new Error(`Missing row for ${code}`)
  return row
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LeaveTypesPage', () => {
  it('shows compact balance statuses in the leave type table', async () => {
    installFetchMock()
    render(<LeaveTypesPage />)

    expect(await screen.findByRole('columnheader', { name: 'Saldo' }))
      .not.toBeNull()
    expect(within(rowForCode('VL')).getByText('Saldo')).not.toBeNull()
    expect(within(rowForCode('UB')).getByText('Bez salda')).not.toBeNull()
  })

  it('disables only canonical VLD behavior fields with explanatory titles', async () => {
    installFetchMock()
    render(<LeaveTypesPage />)
    const user = userEvent.setup()

    await screen.findByText('VLD')
    await user.click(within(rowForCode('VLD')).getByTitle('Edytuj'))

    const code = screen.getByDisplayValue('VLD') as HTMLInputElement
    const paid = screen.getByRole('checkbox', { name: 'Płatny' }) as HTMLInputElement
    const approval = screen.getByRole('checkbox', {
      name: 'Wymaga akceptacji',
    }) as HTMLInputElement
    const balance = screen.getByRole('checkbox', {
      name: 'Pomniejsza saldo',
    }) as HTMLInputElement
    const maxDays = screen.getByRole('spinbutton') as HTMLInputElement
    const parent = screen.getByRole('combobox') as HTMLSelectElement

    expect(code.disabled).toBe(true)
    expect(code.title).toMatch(/kod.*VLD/i)
    expect(paid.disabled).toBe(false)
    expect(approval.disabled).toBe(true)
    expect(approval.title).toMatch(/VLD.*akcept/i)
    expect(balance.disabled).toBe(true)
    expect(balance.title).toMatch(/VLD.*sald/i)
    expect(maxDays.disabled).toBe(true)
    expect(maxDays.title).toMatch(/VLD.*4/)
    expect(parent.disabled).toBe(true)
    expect(parent.title).toMatch(/VLD.*VL/i)
  })

  it('submits custom balance behavior and surfaces a Polish 422 error', async () => {
    const { fetchMock, protectedError } = installFetchMock(422)
    render(<LeaveTypesPage />)
    const user = userEvent.setup()

    await screen.findByText('CUSTOM')
    await user.click(within(rowForCode('CUSTOM')).getByTitle('Edytuj'))

    const balance = screen.getByRole('checkbox', {
      name: 'Pomniejsza saldo',
    }) as HTMLInputElement
    expect(balance.checked).toBe(true)
    expect(balance.disabled).toBe(false)

    await user.click(balance)
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany' }))

    expect(await screen.findByText(protectedError)).not.toBeNull()
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === '/api/hr/leave-types/leave-type-custom' &&
          (init as RequestInit | undefined)?.method === 'PATCH'
      )
      expect(patchCall).toBeDefined()
      expect(JSON.parse(String((patchCall?.[1] as RequestInit).body)))
        .toMatchObject({ tracksBalance: false })
    })
  })
})
