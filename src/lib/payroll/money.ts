// Payroll money is kept in integer grosze end-to-end; no float arithmetic on amounts.

const PLN_PATTERN = /^(-)?(\d{1,9})(?:[.,](\d{1,2}))?$/
// "5.165,00": with a decimal comma, dots may only group thousands.
const DOT_THOUSANDS_PATTERN = /^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/

/** Parses "1234", "1234,5", "1 234,56", "5.165,00" or "-120.00" into grosze. Returns null for invalid input. */
export function parsePlnToGrosze(value: string): number | null {
  const normalized = value.replace(/[\s ]/g, '').replace(/zł$/i, '')
  const match = PLN_PATTERN.exec(DOT_THOUSANDS_PATTERN.test(normalized) ? normalized.replace(/\./g, '') : normalized)
  if (!match) return null
  const [, sign, whole, fraction = ''] = match
  const grosze = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return sign ? -grosze : grosze
}

export function groszeToPlnString(grosze: number): string {
  const sign = grosze < 0 ? '-' : ''
  const abs = Math.abs(grosze)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

const plnFormatter = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatGrosze(grosze: number | null | undefined): string {
  if (grosze == null) return '—'
  return plnFormatter.format(grosze / 100)
}

export function formatMinutesAsHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0 && m > 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`
}
