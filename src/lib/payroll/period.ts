import { getWarsawBusinessDate } from '@/lib/hr/business-date'

export type PayrollPeriod = { year: number; month: number }

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

export function parsePayrollMonth(value: string | null | undefined): PayrollPeriod | null {
  const match = MONTH_KEY.exec(value ?? '')
  if (!match) return null
  const year = Number(match[1])
  if (year < 2020 || year > 2100) return null
  return { year, month: Number(match[2]) }
}

export function payrollMonthKey({ year, month }: PayrollPeriod): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function periodFirstDay(period: PayrollPeriod): string {
  return `${payrollMonthKey(period)}-01`
}

export function periodLastDay({ year, month }: PayrollPeriod): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${payrollMonthKey({ year, month })}-${String(last).padStart(2, '0')}`
}

/** Settlements are prepared for the current or a past month (Europe/Warsaw). */
export function isFuturePeriod(period: PayrollPeriod, now = new Date()): boolean {
  const today = getWarsawBusinessDate(now)
  return period.year * 12 + period.month > today.year * 12 + today.month
}

export function isEmployedInPeriod(
  employee: { startDate: Date; endDate: Date | null },
  period: PayrollPeriod
): boolean {
  const start = getWarsawBusinessDate(employee.startDate).isoDate
  const end = employee.endDate ? getWarsawBusinessDate(employee.endDate).isoDate : null
  return start <= periodLastDay(period) && (end === null || end >= periodFirstDay(period))
}

/**
 * Query window for TimeEntry.date: canonical rows are UTC midnight of the Warsaw date, legacy rows
 * may be local midnight. Callers must filter the result with `getWarsawBusinessDate` by month key.
 */
export function periodTimeEntryQueryRange({ year, month }: PayrollPeriod) {
  return {
    gte: new Date(Date.UTC(year, month - 1, 1) - 24 * 60 * 60 * 1000),
    lt: new Date(Date.UTC(year, month, 1) + 24 * 60 * 60 * 1000),
  }
}
