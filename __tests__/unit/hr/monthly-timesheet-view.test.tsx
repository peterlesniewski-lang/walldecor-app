import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagerTimesheet } from '@/components/hr/time-tracking/manager-timesheet'
import { WeeklyTimesheet } from '@/components/hr/time-tracking/weekly-timesheet'

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  search: '',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const divisions = [
  { id: 'JAG', name: 'Jagiellońska' },
  { id: 'PUL', name: 'Puławska' },
]

const managerProps = {
  userRole: 'ADMIN' as const,
  divisions,
  initialView: 'week' as const,
  initialMode: 'team' as const,
  initialWeek: '2026-W30',
  initialMonth: '2026-07',
  initialEmployeeId: null,
  saturdayWorkable: true,
}

const monthlyData = {
  month: '2026-07',
  monthStart: '2026-07-01',
  monthEnd: '2026-07-31',
  days: ['2026-07-01', '2026-07-02'],
  employees: [{
    id: 'employee-1',
    firstName: 'Anna',
    lastName: 'Kowalska',
    divisionId: 'JAG',
    divisionName: 'Jagiellońska',
    avatarUrl: null,
    entries: {},
  }],
  dailyTotals: {},
  holidays: [],
  saturdayWorkable: true,
  standardClockIn: '11:00',
  standardClockOut: '19:00',
}

const secondEmployee = {
  id: 'employee-2',
  firstName: 'Piotr',
  lastName: 'Nowak',
  divisionId: 'JAG',
  divisionName: 'Jagiellońska',
  avatarUrl: null,
  entries: {},
}

const weeklyData = {
  weekStart: '2026-07-20',
  weekEnd: '2026-07-26',
  days: ['2026-07-20'],
  employees: [],
  dailyTotals: {},
}

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

beforeEach(() => {
  navigation.push.mockReset()
  navigation.search = ''
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    return jsonResponse(url.includes('/monthly') ? monthlyData : weeklyData)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ManagerTimesheet navigation', () => {
  it('switches to monthly team mode and preserves division', async () => {
    navigation.search = 'divisionId=JAG'
    const user = userEvent.setup()
    render(<ManagerTimesheet {...managerProps} />)

    await user.click(screen.getByRole('button', { name: 'Miesiąc' }))

    expect(navigation.push).toHaveBeenCalledWith(
      '?view=month&mode=team&month=2026-07&divisionId=JAG'
    )
  })

  it('switches monthly submode without losing month or other view state', async () => {
    navigation.search = 'view=month&mode=team&month=2026-07&divisionId=JAG&week=2026-W30'
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Pracownik' }))

    expect(navigation.push).toHaveBeenCalledWith(
      '?view=month&mode=employee&month=2026-07&divisionId=JAG&week=2026-W30'
    )
  })

  it('loads the full scoped monthly roster without filtering the request by employee', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1&divisionId=JAG'
    const fetchMock = vi.mocked(fetch)
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    expect(screen.getByTestId('monthly-mode-shell')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Oddział' })).toBeTruthy()
    expect(await screen.findByRole('combobox', { name: 'Pracownik' })).toBeTruthy()
    await waitFor(() => {
      expect(String(fetchMock.mock.calls[0][0])).toBe(
        '/api/hr/time-tracking/monthly?month=2026-07&divisionId=JAG'
      )
    })
  })

  it('keeps the full roster usable when switching selected employees', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1&divisionId=JAG'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...monthlyData,
      employees: [...monthlyData.employees, secondEmployee],
    })))
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    const employeeSelect = await screen.findByRole('combobox', { name: 'Pracownik' })
    expect(screen.getByRole('option', { name: 'Anna Kowalska' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Piotr Nowak' })).toBeTruthy()

    await user.selectOptions(employeeSelect, 'employee-2')

    expect(navigation.push).toHaveBeenCalledWith(
      '?view=month&mode=employee&month=2026-07&divisionId=JAG&employeeId=employee-2'
    )
  })

  it('shows an unavailable employee message while keeping the scoped roster selectable', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=outside-scope&divisionId=JAG'
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="outside-scope"
      />
    )

    expect(await screen.findByText('Pracownik nie jest dostępny w bieżącym zakresie')).toBeTruthy()
    const employeeSelect = screen.getByRole('combobox', { name: 'Pracownik' })
    expect(screen.getByRole('option', { name: 'Anna Kowalska' })).toBeTruthy()

    await user.selectOptions(employeeSelect, 'employee-1')

    expect(navigation.push).toHaveBeenCalledWith(
      '?view=month&mode=employee&month=2026-07&divisionId=JAG&employeeId=employee-1'
    )
  })

  it('clears employeeId when the division changes', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1&divisionId=JAG'
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.selectOptions(screen.getByRole('combobox', { name: 'Oddział' }), 'PUL')

    expect(navigation.push).toHaveBeenCalledWith(
      '?view=month&mode=employee&month=2026-07&divisionId=PUL'
    )
  })

  it('ignores an older response that resolves after the current month', async () => {
    const july = deferred<Response>()
    const august = deferred<Response>()
    const fetchMock = vi.fn((input: string | URL | Request) => {
      return String(input).includes('month=2026-08') ? august.promise : july.promise
    })
    vi.stubGlobal('fetch', fetchMock)
    navigation.search = 'view=month&mode=employee&month=2026-07'
    const view = () => (
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
      />
    )
    const { rerender } = render(view())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    navigation.search = 'view=month&mode=employee&month=2026-08'
    rerender(view())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect((fetchMock.mock.calls[0][1] as RequestInit | undefined)?.signal?.aborted).toBe(true)

    await act(async () => {
      august.resolve(jsonResponse({
        ...monthlyData,
        month: '2026-08',
        employees: [secondEmployee],
      }))
    })
    expect(await screen.findByRole('option', { name: 'Piotr Nowak' })).toBeTruthy()

    await act(async () => {
      july.resolve(jsonResponse(monthlyData))
    })
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Anna Kowalska' })).toBeNull()
      expect(screen.getByRole('option', { name: 'Piotr Nowak' })).toBeTruthy()
    })
  })

  it('aborts a pending monthly request on unmount', async () => {
    const pending = deferred<Response>()
    const fetchMock = vi.fn(() => pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    navigation.search = 'view=month&mode=team&month=2026-07'
    const { unmount } = render(
      <ManagerTimesheet {...managerProps} initialView="month" />
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const signal = (fetchMock.mock.calls[0][1] as RequestInit | undefined)?.signal

    unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('retries a failed monthly request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'failure' }, 500))
      .mockResolvedValueOnce(jsonResponse(monthlyData))
    vi.stubGlobal('fetch', fetchMock)
    navigation.search = 'view=month&mode=employee&month=2026-07'
    const user = userEvent.setup()
    render(
      <ManagerTimesheet {...managerProps} initialView="month" initialMode="employee" />
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Nie udało się pobrać ewidencji. Spróbuj ponownie.'
    )
    await user.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))

    expect(await screen.findByRole('option', { name: 'Anna Kowalska' })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('updates client selection on simulated back-forward URL changes without refetching the roster', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const fetchMock = vi.fn(async () => jsonResponse({
      ...monthlyData,
      employees: [...monthlyData.employees, secondEmployee],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const view = () => (
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )
    const { rerender } = render(view())
    const employeeSelect = await screen.findByRole('combobox', { name: 'Pracownik' }) as HTMLSelectElement
    expect(employeeSelect.value).toBe('employee-1')

    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-2'
    rerender(view())

    expect((screen.getByRole('combobox', { name: 'Pracownik' }) as HTMLSelectElement).value)
      .toBe('employee-2')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('WeeklyTimesheet navigation', () => {
  it('retains view=week and monthly state when changing week', async () => {
    navigation.search = 'view=week&week=2026-W30&mode=employee&month=2026-07&employeeId=employee-1&divisionId=JAG'
    const user = userEvent.setup()
    render(
      <WeeklyTimesheet
        userRole="ADMIN"
        divisions={divisions}
        initialWeek="2026-W30"
        saturdayWorkable
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Poprzedni tydzień' }))

    const pushedUrl = navigation.push.mock.calls[0][0] as string
    const pushedParams = new URLSearchParams(pushedUrl.slice(1))
    expect(Object.fromEntries(pushedParams)).toMatchObject({
      view: 'week',
      week: '2026-W29',
      mode: 'employee',
      month: '2026-07',
      employeeId: 'employee-1',
      divisionId: 'JAG',
    })
  })
})
