import { isValid } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { InstallationVisitValidationError } from './visit-schemas'

export const INSTALLATION_TIMEZONE = 'Europe/Warsaw' as const

export type InstallationVisitTimeField = 'startsAt' | 'endsAt' | 'form'

const localDateTimeFormat = "yyyy-MM-dd'T'HH:mm"
const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const invalidLocalDateTimeMessage = 'Podaj poprawny termin wizyty w czasie Warszawy.'
const oneHourInMilliseconds = 60 * 60 * 1_000

function invalidLocalDateTime(field: InstallationVisitTimeField): never {
  throw new InstallationVisitValidationError({ [field]: invalidLocalDateTimeMessage })
}

function toValidDate(value: Date | string, field: InstallationVisitTimeField = 'form'): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (!isValid(date)) invalidLocalDateTime(field)
  return date
}

function isAmbiguousWarsawLocalDateTime(value: string, date: Date): boolean {
  return [date.getTime() - oneHourInMilliseconds, date.getTime() + oneHourInMilliseconds]
    .some((candidate) => formatInTimeZone(new Date(candidate), INSTALLATION_TIMEZONE, localDateTimeFormat) === value)
}

export function parseWarsawLocalDateTime(value: string): Date
export function parseWarsawLocalDateTime(value: string, field: InstallationVisitTimeField): Date
export function parseWarsawLocalDateTime(value: string, field: InstallationVisitTimeField = 'form'): Date {
  if (!localDateTimePattern.test(value)) invalidLocalDateTime(field)

  const date = fromZonedTime(value, INSTALLATION_TIMEZONE)
  if (
    !isValid(date)
    || formatInTimeZone(date, INSTALLATION_TIMEZONE, localDateTimeFormat) !== value
    || isAmbiguousWarsawLocalDateTime(value, date)
  ) {
    invalidLocalDateTime(field)
  }
  return date
}

export function formatWarsawDateTime(value: Date | string): string {
  return formatInTimeZone(toValidDate(value, 'form'), INSTALLATION_TIMEZONE, 'dd.MM.yyyy, HH:mm')
}

export function formatWarsawDateTimeInput(value: Date | string): string {
  return formatInTimeZone(toValidDate(value, 'form'), INSTALLATION_TIMEZONE, localDateTimeFormat)
}
