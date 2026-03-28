export const EMPLOYMENT_TYPES = ['UoP', 'B2B', 'UZ', 'UoD', 'inne'] as const
export type EmploymentType = typeof EMPLOYMENT_TYPES[number]

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type LeaveStatus = typeof LEAVE_STATUSES[number]

export const TIME_ENTRY_STATUSES = ['pending', 'approved', 'rejected'] as const
export type TimeEntryStatus = typeof TIME_ENTRY_STATUSES[number]

export const TIME_ENTRY_SOURCES = ['manual', 'auto', 'clock', 'bulk'] as const
export type TimeEntrySource = typeof TIME_ENTRY_SOURCES[number]

export const BREAK_TYPES = ['break', 'lunch', 'other'] as const
export type BreakType = typeof BREAK_TYPES[number]

export const BILLING_PERIOD_STATUSES = ['open', 'closed', 'locked'] as const
export type BillingPeriodStatus = typeof BILLING_PERIOD_STATUSES[number]

export const OVERTIME_RESOLUTION = ['time_off', 'payment'] as const
export type OvertimeResolution = typeof OVERTIME_RESOLUTION[number]

// Polish public holidays calculator
// Returns array of ISO date strings "YYYY-MM-DD"
export function getPolishHolidays(year: number): string[] {
  // Easter Sunday (Meeus/Jones/Butcher algorithm)
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  const easter = new Date(year, month - 1, day)

  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const add = (d: Date, days: number) => { const r = new Date(d); r.setDate(r.getDate() + days); return r }

  return [
    `${year}-01-01`, // Nowy Rok
    `${year}-01-06`, // Trzech Króli
    fmt(easter),                    // Wielkanoc
    fmt(add(easter, 1)),            // Poniedziałek Wielkanocny
    `${year}-05-01`, // Święto Pracy
    `${year}-05-03`, // Święto Konstytucji
    fmt(add(easter, 60)),           // Boże Ciało
    `${year}-08-15`, // Wniebowzięcie NMP
    `${year}-11-01`, // Wszystkich Świętych
    `${year}-11-11`, // Święto Niepodległości
    `${year}-12-25`, // Boże Narodzenie
    `${year}-12-26`, // Drugi dzień BN
  ]
}
