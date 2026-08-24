import { isValid } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { InstallationVisitValidationError } from './visit-schemas'

export const INSTALLATION_TIMEZONE = 'Europe/Warsaw' as const

const localDateTimeFormat = "yyyy-MM-dd'T'HH:mm"
const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const invalidLocalDateTimeMessage = 'Podaj poprawny termin wizyty w czasie Warszawy.'

function invalidLocalDateTime(): never {
  throw new InstallationVisitValidationError({ startsAt: invalidLocalDateTimeMessage })
}

function toValidDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (!isValid(date)) invalidLocalDateTime()
  return date
}

export function parseWarsawLocalDateTime(value: string): Date {
  if (!localDateTimePattern.test(value)) invalidLocalDateTime()

  const date = fromZonedTime(value, INSTALLATION_TIMEZONE)
  if (!isValid(date) || formatInTimeZone(date, INSTALLATION_TIMEZONE, localDateTimeFormat) !== value) {
    invalidLocalDateTime()
  }
  return date
}

export function formatWarsawDateTime(value: Date | string): string {
  return formatInTimeZone(toValidDate(value), INSTALLATION_TIMEZONE, 'dd.MM.yyyy, HH:mm')
}

export function formatWarsawDateTimeInput(value: Date | string): string {
  return formatInTimeZone(toValidDate(value), INSTALLATION_TIMEZONE, localDateTimeFormat)
}
