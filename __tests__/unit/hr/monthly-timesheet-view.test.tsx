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
