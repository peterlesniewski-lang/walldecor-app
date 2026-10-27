// Row tinting for unpaid invoices due this calendar week (Mon–Sun) or already overdue.
// Level 0 = no highlight; 1 (calm) → 4 (overdue) get progressively warmer, never saturated.

export type DueUrgencyLevel = 0 | 1 | 2 | 3 | 4

export interface DueUrgency {
  level: DueUrgencyLevel
  daysLeft: number | null
  label: string | null
}

const DAY_MS = 86_400_000

function dayNumber(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS)
}

function pluralDays(count: number) {
  return count === 1 ? '1 dzień' : `${count} dni`
}

export function dueUrgency(dueDate: string | null | undefined, today: string, paymentStatus?: string): DueUrgency {
  const none: DueUrgency = { level: 0, daysLeft: null, label: null }
  if (!dueDate || paymentStatus !== 'UNPAID') return none

  const daysLeft = dayNumber(dueDate) - dayNumber(today)
  // 1970-01-01 was a Thursday, so (day + 3) % 7 is 0 for Monday.
  const daysToSunday = 6 - ((dayNumber(today) + 3) % 7)

  if (daysLeft < 0) return { level: 4, daysLeft, label: `po terminie: ${pluralDays(-daysLeft)}` }
  if (daysLeft > daysToSunday) return { level: 0, daysLeft, label: null }
  if (daysLeft === 0) return { level: 3, daysLeft, label: 'dziś' }
  if (daysLeft === 1) return { level: 2, daysLeft, label: 'jutro' }
  if (daysLeft === 2) return { level: 2, daysLeft, label: `za ${pluralDays(daysLeft)}` }
  return { level: 1, daysLeft, label: `za ${pluralDays(daysLeft)}` }
}

// Soft tints on the warm WallDecor palette; the stripe is the stronger cue on the first cell.
export const DUE_URGENCY_STYLES: Record<Exclude<DueUrgencyLevel, 0>, { background: string; stripe: string; text: string }> = {
  1: { background: '#FBF8EC', stripe: '#E6D79B', text: '#7A6A2E' },
  2: { background: '#FDF1D8', stripe: '#E0B058', text: '#8A5A12' },
  3: { background: '#FCE5D3', stripe: '#DE8A4E', text: '#9A4A12' },
  4: { background: '#F8DAD6', stripe: '#C7544A', text: '#A2362D' },
}
