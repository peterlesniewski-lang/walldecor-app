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
  leaveType('SL', { name: 'Zwolnienie chorobowe' }),
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
    if (url === '/api/hr/leave-types' && init?.method === 'POST') {
      return jsonResponse(leaveType('VLD'), 201)
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

    const dialog = screen.getByRole('dialog', { name: 'Edytuj typ urlopu' })
    const code = within(dialog).getByLabelText('Kod') as HTMLInputElement
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

    const approvalDescriptionId = approval.getAttribute('aria-describedby')
    expect(approvalDescriptionId).toBeTruthy()
    expect(document.getElementById(approvalDescriptionId!)?.textContent)
      .toMatch(/VLD.*akcept/i)
  })

  it('opens a named dialog with labeled controls and restores focus on Escape', async () => {
    installFetchMock()
    render(<LeaveTypesPage />)
    const user = userEvent.setup()

    const addButton = await screen.findByRole('button', {
      name: 'Dodaj typ urlopu',
    })
    await user.click(addButton)

    const dialog = screen.getByRole('dialog', { name: 'Dodaj typ urlopu' })
    expect(within(dialog).getByLabelText('Nazwa')).not.toBeNull()
    expect(within(dialog).getByLabelText('Kod')).not.toBeNull()
    expect(within(dialog).getByLabelText(/Maks. dni w roku/i)).not.toBeNull()
    expect(within(dialog).getByLabelText(/Typ nadrzędny/i)).not.toBeNull()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Dodaj typ urlopu' }))
        .toBeNull()
    })
    expect(document.activeElement).toBe(addButton)
  })

  it('synchronizes all canonical creation defaults and restores custom defaults', async () => {
    installFetchMock()
    render(<LeaveTypesPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', {
      name: 'Dodaj typ urlopu',
    }))
    const dialog = screen.getByRole('dialog', { name: 'Dodaj typ urlopu' })
    const code = within(dialog).getByLabelText('Kod') as HTMLInputElement
    const paid = within(dialog).getByRole('checkbox', {
      name: 'Płatny',
    }) as HTMLInputElement
    const approval = within(dialog).getByRole('checkbox', {
      name: 'Wymaga akceptacji',
    }) as HTMLInputElement
    const balance = within(dialog).getByRole('checkbox', {
      name: 'Pomniejsza saldo',
    }) as HTMLInputElement
    const maxDays = within(dialog).getByLabelText(
      /Maks. dni w roku/i
    ) as HTMLInputElement
    const parent = within(dialog).getByLabelText(
      /Typ nadrzędny/i
    ) as HTMLSelectElement

    await user.type(code, 'VL')
    await waitFor(() => {
      expect(paid.checked).toBe(true)
      expect(paid.disabled).toBe(true)
      expect(approval.checked).toBe(true)
      expect(approval.disabled).toBe(true)
      expect(balance.checked).toBe(true)
      expect(balance.disabled).toBe(true)
      expect(parent.value).toBe('')
      expect(parent.disabled).toBe(true)
    })
    expect(maxDays.disabled).toBe(false)
    expect(parent.title).toMatch(/VL.*główn|nadrzędn/i)
    const vlParentDescriptionId = parent.getAttribute('aria-describedby')
    expect(vlParentDescriptionId).toBeTruthy()
    expect(document.getElementById(vlParentDescriptionId!)?.textContent)
      .toMatch(/VL.*główn|nadrzędn/i)

    await user.clear(code)
    await user.type(code, 'VLD')
    await waitFor(() => {
      expect(approval.checked).toBe(true)
      expect(approval.disabled).toBe(true)
      expect(balance.checked).toBe(true)
      expect(balance.disabled).toBe(true)
      expect(maxDays.value).toBe('4')
      expect(maxDays.disabled).toBe(true)
      expect(parent.value).toBe('leave-type-vl')
      expect(parent.disabled).toBe(true)
    })
    expect(paid.disabled).toBe(false)

    await user.clear(code)
    await user.type(code, 'UB')
    await waitFor(() => {
      expect(paid.checked).toBe(false)
      expect(paid.disabled).toBe(true)
      expect(approval.checked).toBe(true)
      expect(approval.disabled).toBe(true)
      expect(balance.checked).toBe(false)
      expect(balance.disabled).toBe(true)
      expect(maxDays.value).toBe('')
      expect(maxDays.disabled).toBe(true)
    })

    await user.clear(code)
    await user.type(code, 'SL')
    await waitFor(() => {
      expect(balance.checked).toBe(false)
      expect(balance.disabled).toBe(true)
    })
    expect(paid.disabled).toBe(false)
    expect(approval.disabled).toBe(false)

    await user.clear(code)
    await user.type(code, 'CUSTOM')
    await waitFor(() => {
      expect(paid.checked).toBe(true)
      expect(paid.disabled).toBe(false)
      expect(approval.checked).toBe(true)
      expect(approval.disabled).toBe(false)
      expect(balance.checked).toBe(true)
      expect(balance.disabled).toBe(false)
      expect(maxDays.value).toBe('')
      expect(maxDays.disabled).toBe(false)
      expect(parent.value).toBe('')
      expect(parent.disabled).toBe(false)
    })
  })

  it('submits canonical VLD creation values after selecting its code', async () => {
    const { fetchMock } = installFetchMock()
    render(<LeaveTypesPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', {
      name: 'Dodaj typ urlopu',
    }))
    const dialog = screen.getByRole('dialog', { name: 'Dodaj typ urlopu' })
    await user.type(within(dialog).getByLabelText('Nazwa'), 'Na żądanie')
    await user.type(within(dialog).getByLabelText('Kod'), 'VLD')
    await user.click(within(dialog).getByRole('button', { name: 'Dodaj typ' }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          url === '/api/hr/leave-types' &&
          (init as RequestInit | undefined)?.method === 'POST'
      )
      expect(postCall).toBeDefined()
      expect(JSON.parse(String((postCall?.[1] as RequestInit).body)))
        .toMatchObject({
          code: 'VLD',
          requiresApproval: true,
          tracksBalance: true,
          maxDaysPerYear: 4,
          parentId: 'leave-type-vl',
        })
    })
  })

  it('disables canonical deactivation with an accessible explanation', async () => {
    installFetchMock()
    render(<LeaveTypesPage />)

    await screen.findByText('VL')
    for (const code of ['VL', 'VLD', 'SL', 'UB']) {
      const button = within(rowForCode(code)).getByRole('button', {
        name: `Dezaktywuj ${code}`,
      }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      const descriptionId = button.getAttribute('aria-describedby')
      expect(descriptionId).toBeTruthy()
      expect(document.getElementById(descriptionId!)?.textContent)
        .toMatch(/kanoniczn/i)
    }

    expect((within(rowForCode('CUSTOM')).getByRole('button', {
      name: 'Dezaktywuj CUSTOM',
    }) as HTMLButtonElement).disabled).toBe(false)
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
