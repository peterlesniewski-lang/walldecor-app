export interface TimeTrackingDayEntry {
  id?: string
  clockIn?: string
  clockOut?: string | null
  totalMinutes?: number | null
  breakMinutes?: number | null
  status?: string
  leaveType?: string
  leaveCode?: string
  leaveColor?: string
}

export interface TimeTrackingEmployeeRow {
  id: string
  firstName: string
  lastName: string
  divisionId: string | null
  divisionName: string | null
  avatarUrl: string | null
  entries: Record<string, TimeTrackingDayEntry>
}

export interface TimeTrackingRangeData {
  startDate: string
  endDate: string
  days: string[]
  employees: TimeTrackingEmployeeRow[]
  dailyTotals: Record<string, number>
  holidays: Array<{ date: string; name: string; divisionId: string | null }>
  saturdayWorkable: boolean
  standardClockIn: string
  standardClockOut: string
}
