const WARSAW_TIME_ZONE = 'Europe/Warsaw'

const warsawDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: WARSAW_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export interface BusinessDate {
  year: number
  month: number
  day: number
  isoDate: string
}

export function getWarsawBusinessDate(now: Date = new Date()): BusinessDate {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Business date requires a valid Date')
  }

  const parts = warsawDateFormatter.formatToParts(now)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
      .map((part) => [part.type, Number(part.value)])
  ) as Record<'year' | 'month' | 'day', number>

  const isoDate = [values.year, values.month, values.day]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, '0'))
    .join('-')

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    isoDate,
  }
}

function utcEndOfIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999))
}

export function entitlementAsOfDate(year: number, now: Date = new Date()): Date {
  const businessDate = getWarsawBusinessDate(now)
  return year === businessDate.year
    ? utcEndOfIsoDate(businessDate.isoDate)
    : new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
}

export function maxEffectiveDateForYear(year: number, now: Date = new Date()): string {
  const businessDate = getWarsawBusinessDate(now)
  return year === businessDate.year ? businessDate.isoDate : `${year}-12-31`
}
