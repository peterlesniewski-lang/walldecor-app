import { getPolishHolidays } from './constants'

const pad = (n: number) => String(n).padStart(2, '0')
/** Formats a Date as local "YYYY-MM-DD" (timezone-safe, avoids UTC shift) */
const localDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const utcDateStr = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

/** Oblicza liczbę dni roboczych między datami (włącznie), pomijając weekendy i święta */
export function calculateWorkingDays(
  start: Date,
  end: Date,
  extraHolidays: string[] = []
): number {
  const year = start.getUTCFullYear()
  const holidays = new Set([
    ...getPolishHolidays(year),
    ...getPolishHolidays(year + 1), // w razie przekroczenia roku
    ...extraHolidays,
  ])
  let count = 0
  const cur = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  ))
  const endDay = new Date(Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  ))
  while (cur <= endDay) {
    const dow = cur.getUTCDay()
    const iso = utcDateStr(cur)
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) count++
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return count
}

export interface WorkHoursResult {
  totalMinutes: number  // brutto (clockOut - clockIn)
  breakMinutes: number  // suma przerw
  netMinutes: number    // totalMinutes - breakMinutes
}

/** Oblicza czas pracy na podstawie clock in/out i przerw */
export function calculateWorkingHours(
  clockIn: Date,
  clockOut: Date,
  breaks: Array<{ startTime: Date; endTime: Date | null }>
): WorkHoursResult {
  const totalMinutes = Math.round((clockOut.getTime() - clockIn.getTime()) / 60000)
  const breakMinutes = breaks.reduce((sum, b) => {
    if (!b.endTime) return sum
    return sum + Math.round((b.endTime.getTime() - b.startTime.getTime()) / 60000)
  }, 0)
  return { totalMinutes, breakMinutes, netMinutes: totalMinutes - breakMinutes }
}

export const isWeekend = (date: Date): boolean => {
  const dow = date.getDay()
  return dow === 0 || dow === 6
}

export const isPublicHoliday = (date: Date, extraHolidays: string[] = []): boolean => {
  const iso = localDateStr(date)
  const year = date.getFullYear()
  const holidays = new Set([...getPolishHolidays(year), ...extraHolidays])
  return holidays.has(iso)
}

/** Formatuje minuty jako "8h 30m" lub "45m" */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Oblicza minuty nadgodzin ponad dzienny próg */
export function calculateOvertimeMinutes(netMinutes: number, dailyThresholdHours: number): number {
  const threshold = dailyThresholdHours * 60
  return Math.max(0, netMinutes - threshold)
}

/** Zwraca zakres tygodnia (poniedziałek–niedziela) zawierającego datę */
export function getWeekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(date)
  const dow = d.getDay() === 0 ? 7 : d.getDay() // niedziela = 7
  d.setDate(d.getDate() - dow + 1)
  d.setHours(0, 0, 0, 0)
  const end = new Date(d)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { start: d, end }
}

/** Zwraca zakres miesiąca */
export function getMonthRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0)
  const end = new Date(year, month, 0, 23, 59, 59, 999)
  return { start, end }
}

/**
 * Oblicza proporcjonalną liczbę dni urlopowych dla pracownika zatrudnionego w ciągu roku.
 * - Zatrudniony przed danym rokiem → pełny wymiar
 * - Zatrudniony w danym roku → ceil(annualDays × pozostałeMiesiące / 12)
 * - Zatrudniony po danym roku → 0
 * Zaokrąglenie w górę (kodeks pracy: niepełny miesiąc = pełny miesiąc na korzyść pracownika).
 */
export function calcProportionalLeaveDays(
  startDate: Date,
  year: number,
  annualDays: number = 26
): number {
  const startYear = startDate.getUTCFullYear()
  if (startYear > year) return 0
  if (startYear < year) return annualDays
  // zatrudniony w tym samym roku: od miesiąca startowego do grudnia włącznie
  const monthsLeft = 12 - startDate.getUTCMonth() // getUTCMonth() jest 0-indexed
  return Math.ceil(annualDays * monthsLeft / 12)
}
