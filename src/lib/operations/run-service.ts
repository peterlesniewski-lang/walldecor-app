import type { Prisma, PrismaClient } from '@/generated/prisma'
import {
  buildRunItemsFromPreviousRun,
  createRunItemInputs,
  createRunName,
  isPermutationOf,
} from '@/lib/operations/run-factory'

export type RunServiceErrorCode =
  | 'TEMPLATE_NOT_FOUND'
  | 'EMPTY_TEMPLATE'
  | 'RUN_EXISTS'
  | 'RUN_NOT_FOUND'
  | 'RUN_CLOSED'
  | 'ITEM_NOT_FOUND'
  | 'ORDER_MISMATCH'
  | 'PROCEDURE_NOT_FOUND'

export class RunServiceError extends Error {
  constructor(
    readonly code: RunServiceErrorCode,
    readonly details: { runId?: string } = {}
  ) {
    super(code)
    this.name = 'RunServiceError'
  }
}

// What the guards need: satisfied by a `PrismaClient` as well as by the `tx` of an interactive transaction.
type RunDb = Pick<Prisma.TransactionClient, 'checklistRun' | 'article'>

const procedureWhere = (procedureId: string) => ({ id: procedureId, type: 'procedure' })

// `ChecklistRunItem` has @@unique([runId, order]): shift every order far out of range first, then assign the final values.
const ORDER_SHIFT = 10_000

const RUN_WITH_ITEMS = {
  template: { include: { module: { include: { area: true } } } },
  items: { orderBy: { order: 'asc' } },
} as const

export interface StartRunInput {
  templateId: string
  periodYear: number
  periodMonth: number | null
  name?: string
  createdById: string
}

export interface RunTaskInput {
  title: string
  description?: string | null
  procedureId?: string | null
  recurring: boolean
}

export async function createRunFromTemplate(db: PrismaClient, input: StartRunInput) {
  return db.$transaction(async (tx) => {
    const template = await tx.checklistTemplate.findUnique({
      where: { id: input.templateId },
      include: { items: { orderBy: { order: 'asc' } } },
    })
    if (!template) throw new RunServiceError('TEMPLATE_NOT_FOUND')

    const existing = await tx.checklistRun.findFirst({
      where: { templateId: template.id, periodYear: input.periodYear, periodMonth: input.periodMonth },
      select: { id: true },
    })
    if (existing) throw new RunServiceError('RUN_EXISTS', { runId: existing.id })

    const previous = await tx.checklistRun.findFirst({
      where: { templateId: template.id },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
      include: { items: { orderBy: { order: 'asc' } } },
    })

    if (!previous && template.items.length === 0) throw new RunServiceError('EMPTY_TEMPLATE')
    const itemInputs = previous
      ? buildRunItemsFromPreviousRun(previous.items)
      : createRunItemInputs(template.items)

    return tx.checklistRun.create({
      data: {
        templateId: template.id,
        name: input.name ?? createRunName(template.name, input.periodYear, input.periodMonth),
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        createdById: input.createdById,
        items: { create: itemInputs },
      },
      include: RUN_WITH_ITEMS,
    })
  })
}

export async function assertRunIsOpen(db: RunDb, runId: string) {
  const run = await db.checklistRun.findUnique({ where: { id: runId }, select: { status: true } })
  if (!run) throw new RunServiceError('RUN_NOT_FOUND')
  if (run.status !== 'open') throw new RunServiceError('RUN_CLOSED')
}

export async function assertProcedureExists(db: RunDb, procedureId: string) {
  const procedure = await db.article.findFirst({
    where: procedureWhere(procedureId),
    select: { id: true },
  })
  if (!procedure) throw new RunServiceError('PROCEDURE_NOT_FOUND')
}

export async function getProcedureForItem(db: PrismaClient, procedureId: string | null) {
  if (!procedureId) return null
  return db.article.findFirst({
    where: procedureWhere(procedureId),
    select: { id: true, title: true, content: true },
  })
}

export async function addRunItem(db: PrismaClient, runId: string, input: RunTaskInput) {
  return db.$transaction(async (tx) => {
    await assertRunIsOpen(tx, runId)
    if (input.procedureId) await assertProcedureExists(tx, input.procedureId)

    const last = await tx.checklistRunItem.aggregate({ where: { runId }, _max: { order: true } })
    return tx.checklistRunItem.create({
      data: {
        runId,
        title: input.title,
        description: input.description ?? null,
        procedureId: input.procedureId ?? null,
        recurring: input.recurring,
        order: (last._max.order ?? 0) + 1,
        status: 'todo',
      },
    })
  })
}

export async function deleteRunItem(db: PrismaClient, runId: string, itemId: string) {
  await db.$transaction(async (tx) => {
    await assertRunIsOpen(tx, runId)

    const item = await tx.checklistRunItem.findFirst({ where: { id: itemId, runId }, select: { id: true } })
    if (!item) throw new RunServiceError('ITEM_NOT_FOUND')

    await tx.checklistRunItem.delete({ where: { id: itemId } })

    const remaining = await tx.checklistRunItem.findMany({
      where: { runId },
      orderBy: { order: 'asc' },
      select: { id: true, order: true },
    })
    for (const [index, entry] of remaining.entries()) {
      if (entry.order !== index + 1) {
        await tx.checklistRunItem.update({ where: { id: entry.id }, data: { order: index + 1 } })
      }
    }
  })
}

export async function reorderRunItems(db: PrismaClient, runId: string, itemIds: string[]) {
  await db.$transaction(async (tx) => {
    await assertRunIsOpen(tx, runId)

    const current = await tx.checklistRunItem.findMany({ where: { runId }, select: { id: true } })
    if (!isPermutationOf(current.map((item) => item.id), itemIds)) {
      throw new RunServiceError('ORDER_MISMATCH')
    }

    await tx.checklistRunItem.updateMany({ where: { runId }, data: { order: { increment: ORDER_SHIFT } } })
    for (const [index, id] of itemIds.entries()) {
      await tx.checklistRunItem.update({ where: { id }, data: { order: index + 1 } })
    }
  })
}
