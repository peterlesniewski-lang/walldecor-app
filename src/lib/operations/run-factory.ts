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
