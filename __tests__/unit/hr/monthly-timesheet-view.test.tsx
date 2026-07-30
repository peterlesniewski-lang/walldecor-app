import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const weeklyData = {
  weekStart: '2026-07-20',
  weekEnd: '2026-07-26',
  days: ['2026-07-20'],
  employees: [],
  dailyTotals: {},
}

beforeEach(() => {
  navigation.push.mockReset()
  navigation.search = ''
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    return new Response(JSON.stringify(url.includes('/monthly') ? monthlyData : weeklyData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))
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

  it('loads the monthly shell with URL filters', async () => {
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
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/hr/time-tracking/monthly?month=2026-07&divisionId=JAG&employeeId=employee-1'
      )
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
