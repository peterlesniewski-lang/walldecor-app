import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbsenceCalendar } from '@/components/hr/leave/absence-calendar'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/hr/leave/leave-request-dialog', () => ({
  LeaveRequestDialog: ({
    open,
    employeeId,
    employeeName,
    startDate,
    endDate,
    onSuccess,
  }: {
    open: boolean
    employeeId?: string
    employeeName?: string
    startDate?: string
    endDate?: string
    onSuccess: () => void
  }) =>
    open ? (
      <div data-testid="leave-dialog">
        <span data-testid="dialog-employee">{employeeId}</span>
        <span data-testid="dialog-name">{employeeName}</span>
        <span data-testid="dialog-start">{startDate}</span>
        <span data-testid="dialog-end">{endDate}</span>
        <button onClick={onSuccess}>saved</button>
      </div>
    ) : null,
}))

const leaveType = { id: 'lt-vl', name: 'Urlop wypoczynkowy', code: 'VL', color: '#3B82F6' }

const calendarData = {
  month: '2026-09',
  daysInMonth: 30,
  holidays: [],
  employees: [
    {
      id: 'emp-1',
      firstName: 'Jan',
      lastName: 'Kowalski',
      divisionId: null,
      leaves: [
        {
          id: 'leave-1',
          startDate: '2026-09-10',
          endDate: '2026-09-11',
          days: 2,
          status: 'approved' as const,
          isRemoteWork: false,
          isDelegation: false,
          leaveType,
        },
      ],
    },
    {
      id: 'emp-2',
      firstName: 'Anna',
      lastName: 'Nowak',
      divisionId: null,
      leaves: [],
    },
  ],
}

const summary = { present: 2, remote: 0, absent: 0, plannedNext: 0, total: 2 }

function renderCalendar(canCreate = true) {
  return render(
    <AbsenceCalendar
      initialData={calendarData}
      initialMonth="2026-09"
      initialSummary={summary}
      canCreate={canCreate}
    />
  )
}

function cellOf(employeeLabel: string, day: string) {
  const row = screen.getByText(employeeLabel).closest('tr') as HTMLElement
  return row.querySelector(`td[data-day="2026-09-${day}"]`) as HTMLElement
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AbsenceCalendar click-to-add', () => {
  it('should open the dialog for a single day on click', () => {
    renderCalendar()

    fireEvent.mouseDown(cellOf('Kowalski J.', '08'))
    fireEvent.mouseUp(window)

    expect(screen.getByTestId('dialog-employee').textContent).toBe('emp-1')
    expect(screen.getByTestId('dialog-name').textContent).toBe('Jan Kowalski')
    expect(screen.getByTestId('dialog-start').textContent).toBe('2026-09-08')
    expect(screen.getByTestId('dialog-end').textContent).toBe('2026-09-08')
  })

  it('should open the dialog with the dragged range', () => {
    renderCalendar()

    fireEvent.mouseDown(cellOf('Nowak A.', '02'))
    fireEvent.mouseEnter(cellOf('Nowak A.', '03'))
    fireEvent.mouseEnter(cellOf('Nowak A.', '04'))
    fireEvent.mouseUp(window)

    expect(screen.getByTestId('dialog-employee').textContent).toBe('emp-2')
    expect(screen.getByTestId('dialog-start').textContent).toBe('2026-09-02')
    expect(screen.getByTestId('dialog-end').textContent).toBe('2026-09-04')
  })

  it('should order the range when dragging backwards', () => {
    renderCalendar()

    fireEvent.mouseDown(cellOf('Nowak A.', '04'))
    fireEvent.mouseEnter(cellOf('Nowak A.', '02'))
    fireEvent.mouseUp(window)

    expect(screen.getByTestId('dialog-start').textContent).toBe('2026-09-02')
    expect(screen.getByTestId('dialog-end').textContent).toBe('2026-09-04')
  })

  it('should stop the selection before the first occupied day', () => {
    renderCalendar()

    fireEvent.mouseDown(cellOf('Kowalski J.', '08'))
    fireEvent.mouseEnter(cellOf('Kowalski J.', '14'))
    fireEvent.mouseUp(window)

    expect(screen.getByTestId('dialog-start').textContent).toBe('2026-09-08')
    expect(screen.getByTestId('dialog-end').textContent).toBe('2026-09-09')
  })

  it('should ignore a drag that moves to another employee row', () => {
    renderCalendar()

    fireEvent.mouseDown(cellOf('Nowak A.', '02'))
    fireEvent.mouseEnter(cellOf('Kowalski J.', '05'))
    fireEvent.mouseUp(window)

    expect(screen.getByTestId('dialog-employee').textContent).toBe('emp-2')
    expect(screen.getByTestId('dialog-end').textContent).toBe('2026-09-02')
  })

  it('should not start a selection on an occupied day', () => {
    renderCalendar()

    const row = screen.getByText('Kowalski J.').closest('tr') as HTMLElement
    fireEvent.mouseDown(within(row).getAllByLabelText(/Urlop wypoczynkowy/)[0])
    fireEvent.mouseUp(window)

    expect(screen.queryByTestId('leave-dialog')).toBeNull()
  })

  it('should do nothing when canCreate is false', () => {
    renderCalendar(false)

    fireEvent.mouseDown(cellOf('Nowak A.', '02'))
    fireEvent.mouseUp(window)

    expect(screen.queryByTestId('leave-dialog')).toBeNull()
  })

  it('should close the dialog and reload the calendar after saving', () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    renderCalendar()

    fireEvent.mouseDown(cellOf('Nowak A.', '02'))
    fireEvent.mouseUp(window)
    fetchMock.mockClear()
    fireEvent.click(screen.getByText('saved'))

    expect(screen.queryByTestId('leave-dialog')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/hr/leave/calendar?month=2026-09')
  })
})
