import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagerTimesheet } from '@/components/hr/time-tracking/manager-timesheet'
import { MonthlyTeamGrid } from '@/components/hr/time-tracking/monthly-team-grid'
import { WeeklyTimesheet } from '@/components/hr/time-tracking/weekly-timesheet'
import { buildMonthDateKeys } from '@/lib/hr/time-tracking/month'
import type { TimeTrackingEmployeeRow } from '@/lib/hr/time-tracking/types'

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  search: '',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
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

const monthlyGridDays = buildMonthDateKeys('2026-07')
const monthlyGridEmployees: TimeTrackingEmployeeRow[] = [
  {
    id: 'employee-1',
    firstName: 'Jan',
    lastName: 'Kowalski',
    divisionId: 'JAG',
    divisionName: 'Jagiellońska',
    avatarUrl: null,
    entries: {
      '2026-07-01': {
        id: 'entry-approved',
        totalMinutes: 480,
        status: 'approved',
      },
      '2026-07-02': {
        status: 'leave',
        leaveType: 'Urlop wypoczynkowy',
        leaveCode: 'VL',
        leaveColor: '#16A34A',
      },
      '2026-07-03': {
        id: 'entry-with-leave',
        totalMinutes: 420,
        status: 'pending',
        leaveType: 'Urlop bezpłatny',
        leaveCode: 'UB',
        leaveColor: '#64748B',
      },
    },
  },
  {
    id: 'employee-2',
    firstName: 'Ewa',
    lastName: 'Nowak',
    divisionId: 'PUL',
    divisionName: 'Puławska',
    avatarUrl: null,
    entries: {},
  },
]

const monthlyGridHolidays = [
  { date: '2026-07-06', name: 'Dzień wolny JAG', divisionId: 'JAG' },
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

beforeEach(() => {
  navigation.push.mockReset()
  navigation.replace.mockReset()
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

  it('uses the target month dimensions while a new team scope is loading', async () => {
    const july = deferred<Response>()
    const february = deferred<Response>()
    const fetchMock = vi.fn((input: string | URL | Request) => (
      String(input).includes('month=2027-02') ? february.promise : july.promise
    ))
    vi.stubGlobal('fetch', fetchMock)
    navigation.search = 'view=month&mode=team&month=2026-07'
    const view = () => (
      <ManagerTimesheet {...managerProps} initialView="month" />
    )
    const { rerender } = render(view())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())

    await act(async () => {
      july.resolve(jsonResponse({
        ...monthlyData,
        days: buildMonthDateKeys('2026-07'),
      }))
    })
    expect(await screen.findByText('Kowalska A.')).toBeTruthy()
    expect(screen.getAllByRole('columnheader')).toHaveLength(33)

    navigation.search = 'view=month&mode=team&month=2027-02'
    rerender(view())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(screen.getAllByRole('columnheader')).toHaveLength(30)
    expect(screen.queryByText('Kowalska A.')).toBeNull()
    expect(screen.getByRole('status', {
      name: 'Ładowanie ewidencji miesięcznej',
    })).toBeTruthy()

    await act(async () => {
      february.resolve(jsonResponse({
        ...monthlyData,
        month: '2027-02',
        monthStart: '2027-02-01',
        monthEnd: '2027-02-28',
        days: buildMonthDateKeys('2027-02'),
        employees: [secondEmployee],
      }))
    })
    expect(await screen.findByText('Nowak P.')).toBeTruthy()
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

  it('opens the existing modal from team mode and refreshes after save', async () => {
    navigation.search = 'view=month&mode=team&month=2026-07'
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (init?.method === 'POST') return jsonResponse({ id: 'entry-created' })
      return jsonResponse({
        ...monthlyData,
        days: buildMonthDateKeys('2026-07'),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ManagerTimesheet {...managerProps} initialView="month" />)

    expect(await screen.findByTestId('monthly-team-grid')).toBeTruthy()
    await user.click(screen.getByRole('button', {
      name: 'Anna Kowalska, 2026-07-01: brak wpisu',
    }))

    const dialog = screen.getByRole('dialog', { name: 'Dodaj wpis' })
    expect(within(dialog).getByText(/Anna Kowalska/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Wejście'), {
      target: { value: '08:00' },
    })
    fireEvent.change(within(dialog).getByLabelText('Wyjście'), {
      target: { value: '16:00' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => {
      const monthlyRequests = fetchMock.mock.calls.filter(([input]) => (
        String(input).includes('/api/hr/time-tracking/monthly')
      ))
      expect(monthlyRequests).toHaveLength(2)
    })
  })

  it('keeps focus in the modal until the obscuring refresh completes', async () => {
    navigation.search = 'view=month&mode=team&month=2026-07'
    const refresh = deferred<Response>()
    let monthlyRequestCount = 0
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'entry-created' }))
      }
      if (String(input).includes('/api/hr/time-tracking/monthly')) {
        monthlyRequestCount += 1
        if (monthlyRequestCount === 2) return refresh.promise
        return Promise.resolve(jsonResponse({
          ...monthlyData,
          days: buildMonthDateKeys('2026-07'),
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ManagerTimesheet {...managerProps} initialView="month" />)

    const opener = await screen.findByRole('button', {
      name: 'Anna Kowalska, 2026-07-01: brak wpisu',
    })
    const focusSpy = vi.spyOn(opener, 'focus')
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Dodaj wpis' })
    focusSpy.mockClear()
    fireEvent.change(within(dialog).getByLabelText('Wejście'), {
      target: { value: '08:00' },
    })
    fireEvent.change(within(dialog).getByLabelText('Wyjście'), {
      target: { value: '16:00' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(monthlyRequestCount).toBe(2))
    const gridContainer = screen.getByTestId('monthly-team-grid').parentElement
    expect(gridContainer?.getAttribute('aria-busy')).toBe('true')
    expect(gridContainer?.querySelector('[role="status"]')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Dodaj wpis' })).toBe(dialog)
    expect(focusSpy).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(opener)

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Dodaj wpis' })).toBe(dialog)
    expect(focusSpy).not.toHaveBeenCalled()

    await act(async () => {
      refresh.resolve(jsonResponse({
        ...monthlyData,
        days: buildMonthDateKeys('2026-07'),
      }))
      await refresh.promise
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(focusSpy).toHaveBeenCalledOnce())
    expect(document.activeElement).toBe(opener)
  })

  it('keeps a saved change open for a refresh-only recovery retry', async () => {
    navigation.search = 'view=month&mode=team&month=2026-07'
    let monthlyRequestCount = 0
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'entry-created' }))
      }
      if (String(input).includes('/api/hr/time-tracking/monthly')) {
        monthlyRequestCount += 1
        if (monthlyRequestCount === 2) {
          return Promise.resolve(jsonResponse({ error: 'refresh failed' }, 500))
        }
        return Promise.resolve(jsonResponse({
          ...monthlyData,
          days: buildMonthDateKeys('2026-07'),
        }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ManagerTimesheet {...managerProps} initialView="month" />)

    const opener = await screen.findByRole('button', {
      name: 'Anna Kowalska, 2026-07-01: brak wpisu',
    })
    const focusSpy = vi.spyOn(opener, 'focus')
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Dodaj wpis' })
    focusSpy.mockClear()

    fireEvent.change(within(dialog).getByLabelText('Wejście'), {
      target: { value: '08:00' },
    })
    fireEvent.change(within(dialog).getByLabelText('Wyjście'), {
      target: { value: '16:00' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))

    const recoveryAlert = await within(dialog).findByRole('alert')
    expect(within(recoveryAlert).getByText(
      'Zmiana została zapisana, ale nie udało się odświeżyć widoku.'
    ).textContent).toBe(
      'Zmiana została zapisana, ale nie udało się odświeżyć widoku.'
    )
    expect(screen.getByRole('dialog', { name: 'Dodaj wpis' })).toBe(dialog)
    expect(document.activeElement).not.toBe(opener)
    expect(focusSpy).not.toHaveBeenCalled()
    expect(monthlyRequestCount).toBe(2)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', {
      name: 'Ponów odświeżenie',
    }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(focusSpy).toHaveBeenCalledOnce())
    expect(document.activeElement).toBe(opener)
    expect(monthlyRequestCount).toBe(3)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('focuses the parent retry after explicitly closing a failed-refresh modal', async () => {
    navigation.search = 'view=month&mode=team&month=2026-07'
    let monthlyRequestCount = 0
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'entry-created' }))
      }
      if (String(input).includes('/api/hr/time-tracking/monthly')) {
        monthlyRequestCount += 1
        return Promise.resolve(monthlyRequestCount === 2
          ? jsonResponse({ error: 'refresh failed' }, 500)
          : jsonResponse({
              ...monthlyData,
              days: buildMonthDateKeys('2026-07'),
            }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ManagerTimesheet {...managerProps} initialView="month" />)

    const opener = await screen.findByRole('button', {
      name: 'Anna Kowalska, 2026-07-01: brak wpisu',
    })
    const openerFocusSpy = vi.spyOn(opener, 'focus')
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Dodaj wpis' })
    openerFocusSpy.mockClear()

    fireEvent.change(within(dialog).getByLabelText('Wejście'), {
      target: { value: '08:00' },
    })
    fireEvent.change(within(dialog).getByLabelText('Wyjście'), {
      target: { value: '16:00' },
    })
    await user.click(within(dialog).getByRole('button', { name: 'Zapisz' }))
    await within(dialog).findByRole('button', { name: 'Ponów odświeżenie' })

    const parentRetry = screen.getByText('Spróbuj ponownie').closest('button')
    expect(parentRetry).not.toBeNull()
    const retryFocusSpy = vi.spyOn(parentRetry!, 'focus')

    await user.click(within(dialog).getByRole('button', { name: 'Zamknij' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(retryFocusSpy).toHaveBeenCalledOnce())
    expect(document.activeElement).toBe(parentRetry)
    expect(openerFocusSpy).not.toHaveBeenCalled()
    expect(monthlyRequestCount).toBe(2)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
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

  it('selects the first visible employee only when employeeId is absent and writes it to the URL', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&divisionId=JAG'
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
      />
    )

    expect(await screen.findByTestId('monthly-employee-mode')).toBeTruthy()
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith(
        '?view=month&mode=employee&month=2026-07&divisionId=JAG&employeeId=employee-1'
      )
    })
  })

  it('submits only dirty employee rows with browser-generated ISO timestamps', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (String(input) === '/api/hr/time-tracking/batch' && init?.method === 'POST') {
        return jsonResponse({
          saved: [{ date: '2026-07-02', entryId: 'entry-1' }],
          failed: [],
        })
      }
      return jsonResponse(monthlyData)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    const clockIn = await screen.findByLabelText('Wejście 2026-07-02')
    await user.type(clockIn, '09:00')
    await user.type(screen.getByLabelText('Wyjście 2026-07-02'), '17:00')
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany (1)' }))

    const batchCall = fetchMock.mock.calls.find(([input]) => (
      String(input) === '/api/hr/time-tracking/batch'
    ))
    expect(batchCall).toBeTruthy()
    const body = JSON.parse(String(batchCall?.[1]?.body))
    expect(body.employeeId).toBe('employee-1')
    expect(body.rows).toHaveLength(1)
    expect(body.rows[0]).toMatchObject({
      date: '2026-07-02',
      breakMinutes: 0,
      clockIn: '2026-07-02T07:00:00.000Z',
      clockOut: '2026-07-02T15:00:00.000Z',
    })
    expect(new Date(body.rows[0].clockIn).toISOString()).toBe(body.rows[0].clockIn)
    expect(new Date(body.rows[0].clockOut).toISOString()).toBe(body.rows[0].clockOut)
  })

  it('keeps failed rows dirty with inline errors after a partial save', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (String(input) === '/api/hr/time-tracking/batch' && init?.method === 'POST') {
        return jsonResponse({
          saved: [{ date: '2026-07-01', entryId: 'entry-1' }],
          failed: [{ date: '2026-07-02', error: 'Konflikt' }],
        })
      }
      return jsonResponse(monthlyData)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.type(await screen.findByLabelText('Wejście 2026-07-01'), '08:00')
    await user.type(screen.getByLabelText('Wyjście 2026-07-01'), '16:00')
    await user.type(screen.getByLabelText('Wejście 2026-07-02'), '09:00')
    await user.type(screen.getByLabelText('Wyjście 2026-07-02'), '17:00')
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany (2)' }))

    expect(await screen.findByText('Konflikt')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zapisz zmiany (1)' })).toBeTruthy()
  })

  it('keeps inline errors inside a stable column and associates them with both time inputs', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const longError = 'Godzina wyjścia musi być późniejsza niż wejścia dla wybranego dnia roboczego'
    vi.stubGlobal('fetch', vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (String(input) === '/api/hr/time-tracking/batch' && init?.method === 'POST') {
        return jsonResponse({
          saved: [],
          failed: [{ date: '2026-07-02', error: longError }],
        })
      }
      return jsonResponse(monthlyData)
    }))
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.type(await screen.findByLabelText('Wejście 2026-07-02'), '17:00')
    await user.type(screen.getByLabelText('Wyjście 2026-07-02'), '09:00')
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany (1)' }))

    const error = await screen.findByText(longError)
    const clockIn = screen.getByLabelText('Wejście 2026-07-02')
    const clockOut = screen.getByLabelText('Wyjście 2026-07-02')
    expect(error.id).toBe('monthly-employee-error-2026-07-02')
    expect(error.className).toContain('line-clamp-2')
    expect(error.getAttribute('title')).toBe(longError)
    expect(clockIn.getAttribute('aria-invalid')).toBe('true')
    expect(clockOut.getAttribute('aria-invalid')).toBe('true')
    expect(clockIn.getAttribute('aria-describedby')).toBe(error.id)
    expect(clockOut.getAttribute('aria-describedby')).toBe(error.id)
    expect(screen.getByRole('table').className).toContain('min-w-[920px]')
    expect(screen.getByTestId('monthly-employee-row-2026-07-02').className).toContain('h-24')
  })

  it('blocks scope navigation and entry details through POST and the following refresh', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1&divisionId=JAG'
    window.history.replaceState(
      { page: 'current' },
      '',
      '/hr/time-tracking?view=month&mode=employee&month=2026-07&employeeId=employee-1&divisionId=JAG'
    )
    const confirmMock = vi.fn()
    vi.stubGlobal('confirm', confirmMock)
    const batch = deferred<Response>()
    const refresh = deferred<Response>()
    let monthlyRequestCount = 0
    const entry = {
      id: 'entry-1',
      clockIn: '2026-07-02T06:00:00.000Z',
      clockOut: '2026-07-02T14:00:00.000Z',
      totalMinutes: 480,
      breakMinutes: 0,
      status: 'pending',
    }
    const dataWithEntry = {
      ...monthlyData,
      employees: [{
        ...monthlyData.employees[0],
        entries: { '2026-07-02': entry },
      }],
    }
    const fetchMock = vi.fn((
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (String(input) === '/api/hr/time-tracking/batch' && init?.method === 'POST') {
        return batch.promise
      }
      if (String(input).includes('/api/hr/time-tracking/monthly')) {
        monthlyRequestCount += 1
        return monthlyRequestCount === 1
          ? Promise.resolve(jsonResponse(dataWithEntry))
          : refresh.promise
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    fireEvent.change(await screen.findByLabelText('Wejście 2026-07-02'), {
      target: { value: '09:00' },
    })
    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany (1)' }))
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([input]) => (
        String(input) === '/api/hr/time-tracking/batch'
      ))).toHaveLength(1)
    })

    const expectBusyControls = () => {
      expect(screen.getByTestId('monthly-mode-shell').getAttribute('aria-busy')).toBe('true')
      expect(screen.getByRole('button', { name: 'Zespół' }).hasAttribute('disabled')).toBe(true)
      expect(screen.getByRole('button', { name: 'Następny miesiąc' }).hasAttribute('disabled')).toBe(true)
      expect(screen.getByRole('combobox', { name: 'Oddział' }).hasAttribute('disabled')).toBe(true)
      expect(screen.getByRole('combobox', { name: 'Pracownik' }).hasAttribute('disabled')).toBe(true)
      expect(screen.getByRole('button', {
        name: 'Szczegóły wpisu 2026-07-02',
      }).hasAttribute('disabled')).toBe(true)
    }
    expectBusyControls()

    window.history.pushState(
      { page: 'target' },
      '',
      '/hr/time-tracking?view=month&mode=team&month=2026-08'
    )
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: { page: 'target' },
      }))
    })
    expect(window.location.search).toBe(
      '?view=month&mode=employee&month=2026-07&employeeId=employee-1&divisionId=JAG'
    )
    expect(confirmMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Zapisz zmiany (1)' }))
    expect(fetchMock.mock.calls.filter(([input]) => (
      String(input) === '/api/hr/time-tracking/batch'
    ))).toHaveLength(1)

    await act(async () => {
      batch.resolve(jsonResponse({
        saved: [{ date: '2026-07-02', entryId: 'entry-1' }],
        failed: [],
      }))
      await batch.promise
    })
    await waitFor(() => expect(monthlyRequestCount).toBe(2))
    expectBusyControls()

    await act(async () => {
      refresh.resolve(jsonResponse(dataWithEntry))
      await refresh.promise
    })
    await waitFor(() => {
      expect(screen.getByTestId('monthly-mode-shell').getAttribute('aria-busy')).toBe('false')
    })
    expect(screen.getByRole('button', { name: 'Zespół' }).hasAttribute('disabled')).toBe(false)
    expect(navigation.push).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps approved leave, weekends, and holidays read-only in employee mode', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...monthlyData,
      days: ['2026-07-02', '2026-07-05', '2026-07-06'],
      saturdayWorkable: false,
      holidays: [{
        date: '2026-07-06',
        name: 'Dzień wolny JAG',
        divisionId: 'JAG',
      }],
      employees: [{
        ...monthlyData.employees[0],
        entries: {
          '2026-07-02': {
            status: 'leave',
            leaveType: 'Urlop wypoczynkowy',
            leaveCode: 'VL',
          },
        },
      }],
    })))
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    expect(await screen.findByTestId('monthly-employee-mode')).toBeTruthy()
    expect(screen.getByLabelText('Wejście 2026-07-02').hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Wyjście 2026-07-02').hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Wejście 2026-07-05').hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Wyjście 2026-07-05').hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Wejście 2026-07-06').hasAttribute('disabled')).toBe(true)
    expect(screen.getByLabelText('Wyjście 2026-07-06').hasAttribute('disabled')).toBe(true)
  })

  it('guards month, mode, division, and employee changes while rows are dirty', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1&divisionId=JAG'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...monthlyData,
      employees: [...monthlyData.employees, secondEmployee],
    })))
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmMock)
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.type(await screen.findByLabelText('Wejście 2026-07-02'), '09:00')
    await user.click(screen.getByRole('button', { name: 'Następny miesiąc' }))
    await user.click(screen.getByRole('button', { name: 'Zespół' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Oddział' }), 'PUL')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Pracownik' }), 'employee-2')

    expect(confirmMock).toHaveBeenCalledTimes(4)
    expect(confirmMock).toHaveBeenCalledWith('Masz niezapisane zmiany. Odrzucić je?')
    expect(navigation.push).not.toHaveBeenCalled()

    confirmMock.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Następny miesiąc' }))
    expect(navigation.push).toHaveBeenCalledWith(
      '?view=month&mode=employee&month=2026-08&divisionId=JAG&employeeId=employee-1'
    )
  })

  it('registers beforeunload protection only while employee rows are dirty', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const user = userEvent.setup()
    const { unmount } = render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.type(await screen.findByLabelText('Wejście 2026-07-02'), '09:00')
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })

  it('restores the current URL and keeps dirty rows when popstate is cancelled', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    window.history.replaceState(
      { page: 'current' },
      '',
      '/hr/time-tracking?view=month&mode=employee&month=2026-07&employeeId=employee-1'
    )
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal('confirm', confirmMock)
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.type(await screen.findByLabelText('Wejście 2026-07-02'), '09:00')
    window.history.pushState(
      { page: 'target' },
      '',
      '/hr/time-tracking?view=month&mode=employee&month=2026-08&employeeId=employee-1'
    )
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: { page: 'target' },
      }))
    })

    expect(confirmMock).toHaveBeenCalledWith('Masz niezapisane zmiany. Odrzucić je?')
    expect(window.location.search).toBe(
      '?view=month&mode=employee&month=2026-07&employeeId=employee-1'
    )
    expect(navigation.replace).toHaveBeenCalledWith(
      '/hr/time-tracking?view=month&mode=employee&month=2026-07&employeeId=employee-1'
    )
    expect(screen.getByRole('button', { name: 'Zapisz zmiany (1)' })).toBeTruthy()
  })

  it('allows popstate and discards dirty rows after confirmation', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    window.history.replaceState(
      { page: 'current' },
      '',
      '/hr/time-tracking?view=month&mode=employee&month=2026-07&employeeId=employee-1'
    )
    const confirmMock = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmMock)
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.type(await screen.findByLabelText('Wejście 2026-07-02'), '09:00')
    window.history.pushState(
      { page: 'target' },
      '',
      '/hr/time-tracking?view=month&mode=employee&month=2026-08&employeeId=employee-1'
    )
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', {
        state: { page: 'target' },
      }))
    })

    expect(confirmMock).toHaveBeenCalledWith('Masz niezapisane zmiany. Odrzucić je?')
    expect(window.location.search).toBe(
      '?view=month&mode=employee&month=2026-08&employeeId=employee-1'
    )
    expect(await screen.findByRole('button', { name: 'Zapisz zmiany (0)' })).toBeTruthy()
  })

  it('previews working-day fill before applying and renders every count group', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const fullMonthData = {
      ...monthlyData,
      days: buildMonthDateKeys('2026-07'),
    }
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (
        String(input) === '/api/hr/time-tracking/monthly/fill' &&
        init?.method === 'POST'
      ) {
        return jsonResponse({
          preview: true,
          counts: {
            eligible: 20,
            existing: 2,
            weekends: 8,
            holidays: 1,
            approvedLeave: 0,
            invalid: 0,
          },
          rows: [],
          saved: [],
        })
      }
      return jsonResponse(fullMonthData)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.click(await screen.findByRole('button', {
      name: 'Wypełnij dni robocze',
    }))
    expect(screen.getByRole('dialog', {
      name: 'Wypełnij dni robocze',
    })).toBeTruthy()
    expect(screen.getByLabelText('Od').getAttribute('value')).toBe('2026-07-01')
    expect(screen.getByLabelText('Do').getAttribute('value')).toBe('2026-07-31')
    expect(screen.getByLabelText('Godzina wejścia').getAttribute('value')).toBe('11:00')
    expect(screen.getByLabelText('Godzina wyjścia').getAttribute('value')).toBe('19:00')

    await user.click(screen.getByRole('button', { name: 'Sprawdź' }))

    const fillCalls = fetchMock.mock.calls.filter(([input]) => (
      String(input) === '/api/hr/time-tracking/monthly/fill'
    ))
    expect(fillCalls).toHaveLength(1)
    const previewBody = JSON.parse(String(fillCalls[0][1]?.body))
    expect(previewBody).toMatchObject({
      employeeId: 'employee-1',
      overwrite: false,
      preview: true,
    })
    expect(previewBody.rows).toHaveLength(31)
    expect(screen.getByText('Do zapisania')).toBeTruthy()
    expect(screen.getByText('Istniejące')).toBeTruthy()
    expect(screen.getByText('Weekendy')).toBeTruthy()
    expect(screen.getByText('Święta')).toBeTruthy()
    expect(screen.getByText('Urlopy')).toBeTruthy()
    expect(screen.getByText('Nieprawidłowe')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zastosuj' })).toBeTruthy()
  })

  it('applies the exact preview rows and overwrite value, then refreshes and closes', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const fullMonthData = {
      ...monthlyData,
      days: buildMonthDateKeys('2026-07'),
    }
    const fillBodies: Array<Record<string, unknown>> = []
    let monthlyRequestCount = 0
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (
        String(input) === '/api/hr/time-tracking/monthly/fill' &&
        init?.method === 'POST'
      ) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        fillBodies.push(body)
        return jsonResponse({
          preview: body.preview,
          counts: {
            eligible: 23,
            existing: 0,
            weekends: 8,
            holidays: 0,
            approvedLeave: 0,
            invalid: 0,
          },
          rows: [],
          saved: body.preview ? [] : [{ date: '2026-07-01', entryId: 'entry-1' }],
        })
      }
      monthlyRequestCount += 1
      return jsonResponse(fullMonthData)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.click(await screen.findByRole('button', {
      name: 'Wypełnij dni robocze',
    }))
    await user.click(screen.getByLabelText('Nadpisz istniejące wpisy'))
    await user.click(screen.getByRole('button', { name: 'Sprawdź' }))
    await user.click(await screen.findByRole('button', { name: 'Zastosuj' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fillBodies).toHaveLength(2)
    expect(fillBodies[0].preview).toBe(true)
    expect(fillBodies[1].preview).toBe(false)
    expect(fillBodies[0].overwrite).toBe(true)
    expect(fillBodies[1].overwrite).toBe(true)
    expect(fillBodies[1].rows).toEqual(fillBodies[0].rows)
    expect(monthlyRequestCount).toBe(2)
  })

  it('keeps inputs and preview visible when apply fails', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const fullMonthData = {
      ...monthlyData,
      days: buildMonthDateKeys('2026-07'),
    }
    let fillRequestCount = 0
    vi.stubGlobal('fetch', vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (
        String(input) === '/api/hr/time-tracking/monthly/fill' &&
        init?.method === 'POST'
      ) {
        fillRequestCount += 1
        if (fillRequestCount === 2) {
          return jsonResponse({ error: 'Konflikt równoczesnej zmiany' }, 409)
        }
        return jsonResponse({
          preview: true,
          counts: {
            eligible: 23,
            existing: 0,
            weekends: 8,
            holidays: 0,
            approvedLeave: 0,
            invalid: 0,
          },
          rows: [],
          saved: [],
        })
      }
      return jsonResponse(fullMonthData)
    }))
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.click(await screen.findByRole('button', {
      name: 'Wypełnij dni robocze',
    }))
    await user.clear(screen.getByLabelText('Przerwa w minutach'))
    await user.type(screen.getByLabelText('Przerwa w minutach'), '45')
    await user.click(screen.getByRole('button', { name: 'Sprawdź' }))
    await user.click(await screen.findByRole('button', { name: 'Zastosuj' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Konflikt równoczesnej zmiany'
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('Przerwa w minutach').getAttribute('value')).toBe('45')
    expect(screen.getByText('Do zapisania')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Zastosuj' })).toBeTruthy()
  })

  it('retries only refresh after a successful apply without submitting fill twice', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const fullMonthData = {
      ...monthlyData,
      days: buildMonthDateKeys('2026-07'),
    }
    let fillRequestCount = 0
    let monthlyRequestCount = 0
    vi.stubGlobal('fetch', vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (
        String(input) === '/api/hr/time-tracking/monthly/fill' &&
        init?.method === 'POST'
      ) {
        fillRequestCount += 1
        const body = JSON.parse(String(init.body)) as { preview: boolean }
        return jsonResponse({
          preview: body.preview,
          counts: {
            eligible: 23,
            existing: 0,
            weekends: 8,
            holidays: 0,
            approvedLeave: 0,
            invalid: 0,
          },
          rows: [],
          saved: body.preview ? [] : [{ date: '2026-07-01', entryId: 'entry-1' }],
        })
      }
      monthlyRequestCount += 1
      if (monthlyRequestCount === 2) {
        return jsonResponse({ error: 'refresh failed' }, 500)
      }
      return jsonResponse(fullMonthData)
    }))
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    await user.click(await screen.findByRole('button', {
      name: 'Wypełnij dni robocze',
    }))
    await user.click(screen.getByRole('button', { name: 'Sprawdź' }))
    await user.click(await screen.findByRole('button', { name: 'Zastosuj' }))

    expect(await screen.findByText(
      'Wpisy zapisano, ale nie udało się odświeżyć widoku.'
    )).toBeTruthy()
    expect(fillRequestCount).toBe(2)

    await user.click(screen.getByRole('button', { name: 'Ponów odświeżenie' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fillRequestCount).toBe(2)
    expect(monthlyRequestCount).toBe(3)
  })

  it('builds fill timestamps in Europe/Warsaw across the DST boundary', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-03&employeeId=employee-1'
    const marchData = {
      ...monthlyData,
      month: '2026-03',
      monthStart: '2026-03-01',
      monthEnd: '2026-03-31',
      days: buildMonthDateKeys('2026-03'),
    }
    let previewBody: {
      rows: Array<{ date: string; clockIn: string; clockOut: string }>
    } | null = null
    vi.stubGlobal('fetch', vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      if (
        String(input) === '/api/hr/time-tracking/monthly/fill' &&
        init?.method === 'POST'
      ) {
        previewBody = JSON.parse(String(init.body))
        return jsonResponse({
          preview: true,
          counts: {
            eligible: 22,
            existing: 0,
            weekends: 9,
            holidays: 0,
            approvedLeave: 0,
            invalid: 0,
          },
          rows: [],
          saved: [],
        })
      }
      return jsonResponse(marchData)
    }))
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialMonth="2026-03"
        initialEmployeeId="employee-1"
      />
    )

    await user.click(await screen.findByRole('button', {
      name: 'Wypełnij dni robocze',
    }))
    await user.click(screen.getByRole('button', { name: 'Sprawdź' }))

    expect(previewBody).not.toBeNull()
    const rows = previewBody!.rows
    expect(rows.find((item) => item.date === '2026-03-28')).toMatchObject({
      clockIn: '2026-03-28T10:00:00.000Z',
      clockOut: '2026-03-28T18:00:00.000Z',
    })
    expect(rows.find((item) => item.date === '2026-03-29')).toMatchObject({
      clockIn: '2026-03-29T09:00:00.000Z',
      clockOut: '2026-03-29T17:00:00.000Z',
    })
  })

  it('does not allow fill to discard dirty inline rows', async () => {
    navigation.search = 'view=month&mode=employee&month=2026-07&employeeId=employee-1'
    const user = userEvent.setup()
    render(
      <ManagerTimesheet
        {...managerProps}
        initialView="month"
        initialMode="employee"
        initialEmployeeId="employee-1"
      />
    )

    const fillButton = await screen.findByRole('button', {
      name: 'Wypełnij dni robocze',
    })
    expect(fillButton.hasAttribute('disabled')).toBe(false)

    await user.type(screen.getByLabelText('Wejście 2026-07-02'), '09:00')

    expect(fillButton.hasAttribute('disabled')).toBe(true)
    expect(fillButton.getAttribute('title')).toBe(
      'Najpierw zapisz albo odrzuć zmiany w tabeli'
    )
    expect(screen.getByRole('button', { name: 'Zapisz zmiany (1)' })).toBeTruthy()
  })
})

describe('MonthlyTeamGrid', () => {
  it('renders a stable 31-day grid with compact team states', () => {
    render(
      <MonthlyTeamGrid
        days={monthlyGridDays}
        employees={monthlyGridEmployees}
        holidays={monthlyGridHolidays}
        saturdayWorkable={false}
        onEditCell={vi.fn()}
      />
    )

    const grid = screen.getByTestId('monthly-team-grid')
    const table = screen.getByRole('table')

    expect(screen.getAllByRole('columnheader')).toHaveLength(33)
    expect(screen.getByText('Kowalski J.')).toBeTruthy()
    expect(screen.getByText('UB')).toBeTruthy()
    expect(screen.getByText('Święto')).toBeTruthy()
    expect(screen.getByTestId('monthly-employee-header').className).toContain('sticky')
    expect(screen.getByTestId('monthly-employee-cell-employee-1').className).toContain('sticky')
    expect(screen.getByTestId('monthly-employee-cell-employee-1').tagName).toBe('TH')
    expect(screen.getByTestId('monthly-employee-cell-employee-1').getAttribute('scope')).toBe('row')
    expect(grid.className).toContain('overflow-x-auto')
    expect(table.style.tableLayout).toBe('fixed')
    expect(table.style.width).toBe('2000px')
    expect(table.style.minWidth).toBe('2000px')

    const columns = Array.from(table.querySelectorAll('col'))
    expect(columns).toHaveLength(33)
    expect(columns[0].style.width).toBe('176px')
    expect(columns.slice(1, -1).every((column) => column.style.width === '56px')).toBe(true)
    expect(columns.at(-1)?.style.width).toBe('88px')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByTitle('Zatwierdzony')).toBeTruthy()
    expect(screen.getByTitle('Oczekujący')).toBeTruthy()
    expect(screen.getByText('15h')).toBeTruthy()
  })

  it('associates every data cell with stable row and column headers', () => {
    render(
      <MonthlyTeamGrid
        days={monthlyGridDays}
        employees={monthlyGridEmployees}
        holidays={monthlyGridHolidays}
        saturdayWorkable={false}
        onEditCell={vi.fn()}
      />
    )

    expect(screen.getByTestId('monthly-employee-header').id).toBe(
      'monthly-employee-column'
    )
    expect(document.getElementById('monthly-day-2026-07-01')?.getAttribute('scope')).toBe('col')
    expect(document.getElementById('monthly-total-column')?.getAttribute('scope')).toBe('col')

    const employeeHeader = screen.getByTestId('monthly-employee-cell-employee-1')
    expect(employeeHeader.id).toBe('monthly-employee-employee-1')
    expect(employeeHeader.getAttribute('scope')).toBe('row')
    expect(
      screen.getByTestId('monthly-cell-employee-1-2026-07-01').getAttribute('headers')
    ).toBe('monthly-employee-employee-1 monthly-day-2026-07-01')
    expect(
      screen.getByTestId('monthly-total-employee-1').getAttribute('headers')
    ).toBe('monthly-employee-employee-1 monthly-total-column')
  })

  it('uses AA text tokens and describes every noninteractive state', () => {
    render(
      <MonthlyTeamGrid
        days={monthlyGridDays}
        employees={monthlyGridEmployees}
        holidays={monthlyGridHolidays}
        saturdayWorkable={false}
        onEditCell={vi.fn()}
      />
    )

    const grid = screen.getByTestId('monthly-team-grid')
    const leaveCell = screen.getByTestId('monthly-cell-employee-1-2026-07-02')
    const holidayCell = screen.getByTestId('monthly-cell-employee-1-2026-07-06')
    const weekendCell = screen.getByTestId('monthly-cell-employee-2-2026-07-05')

    expect(grid.innerHTML).not.toContain('--wd-text-muted')
    expect(grid.innerHTML).toContain('--muted-foreground')
    expect(within(leaveCell).getByText('VL').style.color).toBe(
      'var(--muted-foreground)'
    )
    expect(within(holidayCell).getByText('Święto').className).toContain(
      'text-[var(--muted-foreground)]'
    )
    expect(within(leaveCell).getByText(
      'Jan Kowalski, 2026-07-02: urlop VL - Urlop wypoczynkowy'
    ).className).toContain('sr-only')
    expect(within(holidayCell).getByText(
      'Jan Kowalski, 2026-07-06: święto - Dzień wolny JAG'
    ).className).toContain('sr-only')
    expect(within(weekendCell).getByText(
      'Ewa Nowak, 2026-07-05: dzień wolny - niedziela'
    ).className).toContain('sr-only')
  })

  it('uses division-aware holidays and sends the exact editable-cell payload', async () => {
    const onEditCell = vi.fn()
    const user = userEvent.setup()
    render(
      <MonthlyTeamGrid
        days={monthlyGridDays}
        employees={monthlyGridEmployees}
        holidays={monthlyGridHolidays}
        saturdayWorkable={false}
        onEditCell={onEditCell}
      />
    )

    await user.click(screen.getByRole('button', {
      name: 'Ewa Nowak, 2026-07-06: brak wpisu',
    }))

    expect(onEditCell).toHaveBeenLastCalledWith({
      employeeId: 'employee-2',
      employeeName: 'Ewa Nowak',
      date: '2026-07-06',
      entry: null,
    })

    await user.click(screen.getByTestId('monthly-cell-employee-1-2026-07-02'))
    expect(onEditCell).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', {
      name: 'Jan Kowalski, 2026-07-03: 7h, oczekujący, UB',
    }))
    expect(onEditCell).toHaveBeenLastCalledWith({
      employeeId: 'employee-1',
      employeeName: 'Jan Kowalski',
      date: '2026-07-03',
      entry: monthlyGridEmployees[0].entries['2026-07-03'],
    })
  })

  it('keeps a statutory public holiday non-editable', async () => {
    const onEditCell = vi.fn()
    const user = userEvent.setup()
    render(
      <MonthlyTeamGrid
        days={buildMonthDateKeys('2025-12')}
        employees={[monthlyGridEmployees[0]]}
        holidays={[]}
        saturdayWorkable
        onEditCell={onEditCell}
      />
    )

    const christmasEveCell = screen.getByTestId(
      'monthly-cell-employee-1-2025-12-24'
    )
    expect(within(christmasEveCell).getByText('Święto')).toBeTruthy()
    expect(within(christmasEveCell).queryByRole('button')).toBeNull()

    await user.click(christmasEveCell)
    expect(onEditCell).not.toHaveBeenCalled()
  })

  it('labels Pentecost Sunday as a holiday rather than only a weekend', () => {
    render(
      <MonthlyTeamGrid
        days={buildMonthDateKeys('2025-06')}
        employees={[monthlyGridEmployees[0]]}
        holidays={[]}
        saturdayWorkable={false}
        onEditCell={vi.fn()}
      />
    )

    const pentecostCell = screen.getByTestId(
      'monthly-cell-employee-1-2025-06-08'
    )
    expect(within(pentecostCell).getByText('Święto')).toBeTruthy()
    expect(within(pentecostCell).queryByText('Wolne')).toBeNull()
    expect(within(pentecostCell).queryByRole('button')).toBeNull()
  })

  it('enables Saturday only when saturdayWorkable is true', async () => {
    const onEditCell = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <MonthlyTeamGrid
        days={monthlyGridDays}
        employees={[monthlyGridEmployees[1]]}
        holidays={[]}
        saturdayWorkable={false}
        onEditCell={onEditCell}
      />
    )

    const saturdayTestId = 'monthly-cell-employee-2-2026-07-04'
    const blockedSaturday = screen.getByTestId(saturdayTestId)
    expect(within(blockedSaturday).getByText('Wolne')).toBeTruthy()
    expect(within(blockedSaturday).queryByRole('button')).toBeNull()

    await user.click(blockedSaturday)
    expect(onEditCell).not.toHaveBeenCalled()

    rerender(
      <MonthlyTeamGrid
        days={monthlyGridDays}
        employees={[monthlyGridEmployees[1]]}
        holidays={[]}
        saturdayWorkable
        onEditCell={onEditCell}
      />
    )

    await user.click(within(screen.getByTestId(saturdayTestId)).getByRole('button', {
      name: 'Ewa Nowak, 2026-07-04: brak wpisu',
    }))
    expect(onEditCell).toHaveBeenCalledWith({
      employeeId: 'employee-2',
      employeeName: 'Ewa Nowak',
      date: '2026-07-04',
      entry: null,
    })
  })
})

describe('WeeklyTimesheet navigation', () => {
  it('keeps pure approved leave read-only but allows correction when time and leave coexist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      weekStart: '2026-07-20',
      weekEnd: '2026-07-26',
      days: ['2026-07-20', '2026-07-21'],
      employees: [{
        id: 'employee-1',
        firstName: 'Anna',
        lastName: 'Kowalska',
        divisionId: 'JAG',
        divisionName: 'Jagiellońska',
        avatarUrl: null,
        entries: {
          '2026-07-20': {
            status: 'leave',
            leaveType: 'Urlop wypoczynkowy',
            leaveColor: '#16A34A',
          },
          '2026-07-21': {
            id: 'entry-with-leave',
            clockIn: '2026-07-21T06:00:00.000Z',
            clockOut: '2026-07-21T13:00:00.000Z',
            totalMinutes: 420,
            status: 'approved',
            leaveType: 'Urlop bezpłatny',
            leaveColor: '#64748B',
          },
        },
      }],
      dailyTotals: {
        '2026-07-20': 0,
        '2026-07-21': 420,
      },
    })))
    const user = userEvent.setup()
    render(
      <WeeklyTimesheet
        userRole="ADMIN"
        divisions={divisions}
        initialWeek="2026-W30"
        saturdayWorkable
      />
    )

    const leaveCell = (await screen.findByText('Urlop w…')).closest('td')
    expect(leaveCell).toBeTruthy()
    await user.click(leaveCell!)
    expect(screen.queryByRole('dialog')).toBeNull()

    const correctionCell = screen.getAllByText('7h')
      .map((element) => element.closest('td'))
      .find((cell) => cell?.textContent?.includes('Urlop'))
    expect(correctionCell).toBeTruthy()
    await user.click(correctionCell!)
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

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
