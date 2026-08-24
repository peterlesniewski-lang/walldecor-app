const MONTH_PARAM_PATTERN = /^(\d{4})-(\d{2})$/
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const padTwoDigits = (value: number): string => String(value).padStart(2, '0')

function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${padTwoDigits(month)}`
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

function requireMonthParam(value: string): { year: number; month: number } {
  const parsed = parseMonthParam(value)
  if (!parsed) throw new RangeError(`Invalid month parameter: ${value}`)
  return parsed
}

function requireValidDate(date: Date): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new RangeError('Expected a valid Date')
  }
}

export function parseMonthParam(value: string): { year: number; month: number } | null {
  const match = MONTH_PARAM_PATTERN.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 1 || month < 1 || month > 12) return null

  return { year, month }
}

export function currentMonthParam(now = new Date()): string {
  requireValidDate(now)
  return formatMonth(now.getFullYear(), now.getMonth() + 1)
}

export function getAdjacentMonth(value: string, delta: number): string {
  const { year, month } = requireMonthParam(value)
  if (!Number.isSafeInteger(delta)) {
    throw new RangeError('Month delta must be a safe integer')
  }

  const monthIndex = year * 12 + month - 1 + delta
  const adjacentYear = Math.floor(monthIndex / 12)
  const adjacentMonth = monthIndex - adjacentYear * 12 + 1
  if (adjacentYear < 1 || adjacentYear > 9999) {
    throw new RangeError('Adjacent month is outside the supported year range')
  }

  return formatMonth(adjacentYear, adjacentMonth)
}

export function buildMonthDateKeys(value: string): string[] {
  const { year, month } = requireMonthParam(value)
  const monthParam = formatMonth(year, month)

  return Array.from(
    { length: daysInMonth(year, month) },
    (_, index) => `${monthParam}-${padTwoDigits(index + 1)}`
  )
}

export function dateKeyToLocalNoon(value: string): Date {
  const match = DATE_KEY_PATTERN.exec(value)
  if (!match) throw new RangeError(`Invalid date key: ${value}`)

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid date key: ${value}`)
  }

  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(12, 0, 0, 0)
  return date
}

export function formatDateKey(date: Date): string {
  requireValidDate(date)
  return `${formatMonth(date.getFullYear(), date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`
}
