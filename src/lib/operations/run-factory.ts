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
  templateItemId: string
  title: string
  description: string | null
  order: number
  procedureId: string | null
  ownerId: string | null
  status: RunItemStatus
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
