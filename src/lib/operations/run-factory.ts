export const RUN_ITEM_STATUSES = ['todo', 'in_progress', 'blocked', 'done'] as const

export type RunItemStatus = (typeof RUN_ITEM_STATUSES)[number]

export interface TemplateItemForRun {
  id: string
  title: string
  description: string | null
  order: number
  procedureId: string | null
  defaultOwnerId: string | null
}

export interface RunItemCreateInput {
  templateItemId: string | null
  title: string
  description: string | null
  order: number
  procedureId: string | null
  ownerId: string | null
  status: RunItemStatus
  recurring?: boolean
}

export interface RunItemStatusLike {
  status: string
}

export interface RunProgress {
  total: number
  done: number
  blocked: number
  inProgress: number
  todo: number
  percent: number
}

export const MONTHS = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień',
] as const

export interface ClosingPeriod {
  periodYear: number
  periodMonth: number
}

export function getPreviousMonthPeriod(date = new Date()): ClosingPeriod {
  const month = date.getMonth() + 1
  if (month === 1) {
    return { periodYear: date.getFullYear() - 1, periodMonth: 12 }
  }
  return { periodYear: date.getFullYear(), periodMonth: month - 1 }
}

export function formatClosingPeriod(periodYear: number, periodMonth: number | null) {
  if (!periodMonth) return `${periodYear}`
  return `${MONTHS[periodMonth - 1]} ${periodYear}`
}

export function createRunName(templateName: string, periodYear: number, periodMonth: number | null) {
  return `${templateName} - ${formatClosingPeriod(periodYear, periodMonth)}`
}

export function assertTemplateHasItems(items: TemplateItemForRun[]) {
  if (items.length === 0) {
    throw new Error('EMPTY_TEMPLATE')
  }
}

export function createRunItemInputs(items: TemplateItemForRun[]): RunItemCreateInput[] {
  assertTemplateHasItems(items)

  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item) => ({
      templateItemId: item.id,
      title: item.title,
      description: item.description,
      order: item.order,
      procedureId: item.procedureId,
      ownerId: item.defaultOwnerId,
      status: 'todo',
    }))
}

export function calculateRunProgress(items: RunItemStatusLike[]): RunProgress {
  const total = items.length
  const done = items.filter((item) => item.status === 'done').length
  const blocked = items.filter((item) => item.status === 'blocked').length
  const inProgress = items.filter((item) => item.status === 'in_progress').length
  const todo = items.filter((item) => item.status === 'todo').length

  return {
    total,
    done,
    blocked,
    inProgress,
    todo,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}

export interface PreviousRunItem {
  templateItemId: string | null
  title: string
  description: string | null
  order: number
  procedureId: string | null
  ownerId: string | null
  recurring: boolean
}

export function buildRunItemsFromPreviousRun(items: PreviousRunItem[]): RunItemCreateInput[] {
  return items
    .filter((item) => item.recurring)
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({
      templateItemId: item.templateItemId,
      title: item.title,
      description: item.description,
      order: index + 1,
      procedureId: item.procedureId,
      ownerId: item.ownerId,
      status: 'todo' as const,
      recurring: true,
    }))
}

export function isReadyToClose(items: RunItemStatusLike[]) {
  return items.length > 0 && items.every((item) => item.status === 'done')
}

export function getRunDisplayStatus(status: string, items: RunItemStatusLike[]) {
  if (status === 'open' && isReadyToClose(items)) return 'ready'
  return status
}

export function getNextOpenItem<T extends { order: number; status: string }>(items: T[]): T | null {
  const open = items.filter((item) => item.status !== 'done').sort((a, b) => a.order - b.order)
  return open[0] ?? null
}

export function findRunForPeriod<T extends { templateId: string; periodYear: number; periodMonth: number | null }>(
  runs: T[],
  templateId: string,
  period: ClosingPeriod
): T | undefined {
  return runs.find(
    (run) =>
      run.templateId === templateId &&
      run.periodYear === period.periodYear &&
      run.periodMonth === period.periodMonth
  )
}

export function isPermutationOf(current: string[], next: string[]) {
  if (current.length !== next.length) return false
  const expected = new Set(current)
  return new Set(next).size === next.length && next.every((id) => expected.has(id))
}
