// Row tinting for invoices that are not fully paid, based on days left to the due date.
// Level 0 = no highlight; 1 (calm) → 5 (overdue) get progressively warmer, never saturated.

export type DueUrgencyLevel = 0 | 1 | 2 | 3 | 4 | 5

export interface DueUrgency {
  level: DueUrgencyLevel
  daysLeft: number | null
  label: string | null
}

const DAY_MS = 86_400_000
const WINDOW_DAYS = 7

function dayNumber(isoDate: string) {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS)
}

function pluralDays(count: number) {
  return count === 1 ? '1 dzień' : `${count} dni`
}

// Unknown or partial payment status still counts as open: only a fully paid invoice is left alone.
export function dueUrgency(dueDate: string | null | undefined, today: string, paymentStatus?: string): DueUrgency {
  const none: DueUrgency = { level: 0, daysLeft: null, label: null }
  if (!dueDate || paymentStatus === 'PAID') return none

  const daysLeft = dayNumber(dueDate) - dayNumber(today)

  if (daysLeft < 0) return { level: 5, daysLeft, label: `po terminie: ${pluralDays(-daysLeft)}` }
  if (daysLeft === 0) return { level: 4, daysLeft, label: 'dziś' }
  if (daysLeft === 1) return { level: 3, daysLeft, label: 'jutro' }
  if (daysLeft <= 2) return { level: 3, daysLeft, label: `za ${pluralDays(daysLeft)}` }
  if (daysLeft <= 5) return { level: 2, daysLeft, label: `za ${pluralDays(daysLeft)}` }
  if (daysLeft <= WINDOW_DAYS) return { level: 1, daysLeft, label: `za ${pluralDays(daysLeft)}` }
  return { level: 0, daysLeft, label: null }
}

// Soft tints on the warm WallDecor palette; the stripe is the stronger cue on the first cell.
// straw → amber → apricot → coral (today) → dusty rose (overdue).
export const DUE_URGENCY_STYLES: Record<Exclude<DueUrgencyLevel, 0>, { background: string; stripe: string; text: string }> = {
  1: { background: '#FBF8EC', stripe: '#E6D79B', text: '#7A6A2E' },
  2: { background: '#FDF1D8', stripe: '#E0B058', text: '#8A5A12' },
  3: { background: '#FCE5D3', stripe: '#E2965A', text: '#9A4F14' },
  4: { background: '#F9D5C4', stripe: '#D86A45', text: '#A33E17' },
  5: { background: '#F5D4D8', stripe: '#BC4A5A', text: '#9E2F42' },
}
