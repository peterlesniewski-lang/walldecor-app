// Polish month names for payroll screens: nominative for headings, genitive for "z października".

export const MONTH_NAMES = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
] as const

export const MONTH_NAMES_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
] as const

function monthIndex(monthKey: string): number {
  return Number(monthKey.slice(5, 7)) - 1
}

/** "2026-10" → "października" */
export function monthGenitive(monthKey: string): string {
  return MONTH_NAMES_GENITIVE[monthIndex(monthKey)] ?? monthKey
}

/** "2026-10" → "październik" */
export function monthNominative(monthKey: string): string {
  return MONTH_NAMES[monthIndex(monthKey)] ?? monthKey
}
