import type { PrismaClient } from '@/generated/prisma'
import { getPolishHolidays } from '@/lib/hr/constants'
import { notifyPayrollAdmins, payrollSheetLink, pluralPl } from './auto-carryover'
import { monthNominative } from './month-names'
import { periodLastDay, type PayrollPeriod } from './period'
import { getPayrollSheet } from './service'

// Przypomnienie przed wypłatą (D2, D18): pay is due by the last working day of the month. Two working
// days before that day the ADMINs get one notification about everyone on the month sheet without an
// approved settlement — hourly people above all, as they are only ever approved by hand.
// Working day = Monday–Friday without Polish public holidays (`getPolishHolidays`).

export const PAYROLL_PAY_REMINDER_NOTIFICATION_TYPE = 'payroll_reminder'
/** On the reminder day itself the notice goes out from this hour (Europe/Warsaw). */
export const PAYROLL_PAY_REMINDER_HOUR = 7

function weekday(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function shiftDay(isoDate: string, delta: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10)
}

export function isPolishWorkingDay(isoDate: string): boolean {
  const day = weekday(isoDate)
  return day !== 0 && day !== 6 && !getPolishHolidays(Number(isoDate.slice(0, 4))).includes(isoDate)
}

/** The last working day of the month — the latest day pay may arrive (D2). */
export function lastWorkingDayOfMonth(period: PayrollPeriod): string {
  let date = periodLastDay(period)
  while (!isPolishWorkingDay(date)) date = shiftDay(date, -1)
  return date
}

/** The reminder day: the last working day of the month minus two working days (D18). */
export function payReminderDate(period: PayrollPeriod): string {
  let date = lastWorkingDayOfMonth(period)
  for (let left = 2; left > 0;) {
    date = shiftDay(date, -1)
    if (isPolishWorkingDay(date)) left--
  }
  return date
}

/**
 * The month whose reminder is due at `clock` (Warsaw), or null. Due from the reminder day's
 * PAYROLL_PAY_REMINDER_HOUR, or on any later day of the same month if the server was down then — never
 * after the month has ended. `lastMonth` is the latest month a reminder was already claimed for.
 */
export function duePayReminderMonth(clock: { date: string; month: string; hour: number }, lastMonth: string | null): string | null {
  if (lastMonth !== null && lastMonth >= clock.month) return null
  const period = { year: Number(clock.month.slice(0, 4)), month: Number(clock.month.slice(5, 7)) }
  const reminder = payReminderDate(period)
  if (clock.date < reminder) return null
  if (clock.date === reminder && clock.hour < PAYROLL_PAY_REMINDER_HOUR) return null
  return clock.month
}

/** "2026-11-30" → "30.11" */
export function shortDayMonth(isoDate: string): string {
  return `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}`
}

/** "Wynagrodzenia za listopad: 3 osoby bez zatwierdzonego rozliczenia, wypłata do 30.11" */
export function payReminderNotification(input: {
  month: string
  people: Array<{ name: string; hourly: boolean }>
  lastWorkingDay: string
}) {
  const count = input.people.length
  const title = `Wynagrodzenia za ${monthNominative(input.month)}: ${count} ${pluralPl(count, 'osoba', 'osoby', 'osób')} `
    + `bez zatwierdzonego rozliczenia, wypłata do ${shortDayMonth(input.lastWorkingDay)}`
  const names = input.people.map((person) => (person.hourly ? `${person.name} (stawka godzinowa)` : person.name))
  const message = `Do zatwierdzenia: ${names.join('; ')}.`
  return {
    title,
    message: message.length > 480 ? `${message.slice(0, 479)}…` : message,
    link: payrollSheetLink(input.month),
  }
}

export type PayReminderResult = { month: string; unapproved: number; notified: number }

/**
 * Sends the reminder for one month: everyone on the month sheet without an effective (approved)
 * version. Nothing is sent when everybody is approved. The notification insert is the last step, so a
 * failure before it sends nothing and the caller may try again.
 */
export async function sendPayrollPayReminder(db: PrismaClient, period: PayrollPeriod): Promise<PayReminderResult> {
  const sheet = await getPayrollSheet(db, period)
  const unapproved = sheet.rows.filter((row) => row.effectiveVersion === null)
  if (unapproved.length === 0) return { month: sheet.month, unapproved: 0, notified: 0 }
  const notified = await notifyPayrollAdmins(db, {
    type: PAYROLL_PAY_REMINDER_NOTIFICATION_TYPE,
    ...payReminderNotification({
      month: sheet.month,
      people: unapproved.map((row) => ({ name: `${row.employee.lastName} ${row.employee.firstName}`, hourly: row.hours !== null })),
      lastWorkingDay: lastWorkingDayOfMonth(period),
    }),
  })
  return { month: sheet.month, unapproved: unapproved.length, notified }
}
