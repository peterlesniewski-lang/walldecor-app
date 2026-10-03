// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient, type Prisma } from '@/generated/prisma'
import {
  addRunItem,
  createRunFromTemplate,
  deleteRunItem,
  getProcedureForItem,
  reorderRunItems,
  type RunServiceError,
} from '@/lib/operations/run-service'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-operations-test-'))
const url = `file:${path.join(directory, 'operations.db')}`
const db = new PrismaClient({ datasources: { db: { url } } })

beforeAll(async () => {
  const result = spawnSync(
    process.execPath,
    ['--preserve-symlinks', 'node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' }
  )
  if (result.status !== 0) throw new Error(`Temporary schema setup failed: ${result.stderr || result.stdout}`)
}, 30_000)

beforeEach(async () => {
  await db.$transaction([
    db.checklistRunItem.deleteMany(),
    db.checklistRun.deleteMany(),
    db.checklistTemplateItem.deleteMany(),
    db.checklistTemplate.deleteMany(),
    db.operationModule.deleteMany(),
    db.operationArea.deleteMany(),
    db.article.deleteMany(),
  ])
})

afterAll(async () => {
  await db.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

async function seedTemplate(titles = ['Raport z kasy', 'Saldo rachunków', 'Rejestr VAT']) {
  await db.operationArea.create({ data: { id: 'area', name: 'Finanse', slug: 'finanse' } })
  await db.operationModule.create({
    data: { id: 'module', areaId: 'area', name: 'Koniec miesiąca', slug: 'koniec-miesiaca' },
  })
  await db.checklistTemplate.create({
    data: {
      id: 'template',
      moduleId: 'module',
      name: 'Księgowość - koniec miesiąca',
      items: { create: titles.map((title, index) => ({ title, order: index + 1 })) },
    },
  })
}

const seedArticle = (id: string, type: string) =>
  db.article.create({
    data: { id, title: `Artykuł ${id}`, slug: id, content: `Treść ${id}`, category: 'processes', type },
  })

const startInput = (periodMonth: number | null) => ({
  templateId: 'template',
  periodYear: 2026,
  periodMonth,
  createdById: 'admin',
})

const taskInput = (title: string, recurring = true) => ({
  title,
  description: null,
  procedureId: null,
  recurring,
})

const itemsOf = (runId: string) =>
  db.checklistRunItem.findMany({ where: { runId }, orderBy: { order: 'asc' } })

const seedRun = (periodMonth: number, titles: string[]) =>
  db.checklistRun.create({
    data: {
      templateId: 'template',
      name: `Run ${periodMonth}`,
      periodYear: 2026,
      periodMonth,
      createdById: 'admin',
      items: { create: titles.map((title, index) => ({ title, order: index + 1 })) },
    },
  })

type InteractiveTransaction = (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => Promise<unknown>

// Simulates another request that lands after a caller has read the database but before its write transaction starts.
function interleaveBeforeTransaction(request: () => Promise<unknown>): PrismaClient {
  return new Proxy(db, {
    get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property, target)
      const transaction = target.$transaction.bind(target) as InteractiveTransaction
      return async (callback: Parameters<InteractiveTransaction>[0]) => {
        await request()
        return transaction(callback)
      }
    },
  })
}

const closeRunBeforeWriting = (runId: string) =>
  interleaveBeforeTransaction(() => db.checklistRun.update({ where: { id: runId }, data: { status: 'closed' } }))

describe('createRunFromTemplate', () => {
  it('should copy template items when there is no previous run', async () => {
    await seedTemplate()

    const run = await createRunFromTemplate(db, startInput(8))

    expect(run.items.map((item) => item.title)).toEqual(['Raport z kasy', 'Saldo rachunków', 'Rejestr VAT'])
  })

  it('should name the run after the template and period', async () => {
    await seedTemplate()

    const run = await createRunFromTemplate(db, startInput(8))

    expect(run.name).toBe('Księgowość - koniec miesiąca - sierpień 2026')
  })

  it('should copy only recurring tasks from the previous run', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    await db.checklistRunItem.update({ where: { id: august.items[1].id }, data: { recurring: false } })

    const september = await createRunFromTemplate(db, startInput(9))

    expect(september.items.map((item) => item.title)).toEqual(['Raport z kasy', 'Rejestr VAT'])
  })

  it('should reset status and note on copied tasks', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    await db.checklistRunItem.update({
      where: { id: august.items[0].id },
      data: { status: 'done', note: 'Zrobione', completedAt: new Date() },
    })

    const september = await createRunFromTemplate(db, startInput(9))

    expect(september.items[0]).toMatchObject({ status: 'todo', note: null, completedAt: null })
  })

  it('should renumber copied tasks from 1', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    await db.checklistRunItem.update({ where: { id: august.items[0].id }, data: { recurring: false } })

    const september = await createRunFromTemplate(db, startInput(9))

    expect(september.items.map((item) => item.order)).toEqual([1, 2])
  })

  it('should copy from the latest previous run when several exist', async () => {
    await seedTemplate()
    await createRunFromTemplate(db, startInput(8))
    const september = await createRunFromTemplate(db, startInput(9))
    await addRunItem(db, september.id, taskInput('Faktura od nowego dostawcy'))

    const october = await createRunFromTemplate(db, startInput(10))

    expect(october.items.map((item) => item.title)).toEqual([
      'Raport z kasy',
      'Saldo rachunków',
      'Rejestr VAT',
      'Faktura od nowego dostawcy',
    ])
  })

  it('should copy from the run with the latest period, not the most recently created one', async () => {
    await seedTemplate()
    await seedRun(10, ['Zadanie z października'])
    await seedRun(8, ['Zadanie z sierpnia'])

    const november = await createRunFromTemplate(db, startInput(11))

    expect(november.items.map((item) => item.title)).toEqual(['Zadanie z października'])
  })

  it('should start an empty run when no task of the previous run is recurring', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    await db.checklistRunItem.updateMany({ where: { runId: august.id }, data: { recurring: false } })

    const september = await createRunFromTemplate(db, startInput(9))

    expect(september.items).toEqual([])
  })

  it('should ignore runs of other templates when copying', async () => {
    await seedTemplate()
    await db.checklistTemplate.create({ data: { id: 'other-template', moduleId: 'module', name: 'Inna lista' } })
    await db.checklistRun.create({
      data: {
        templateId: 'other-template',
        name: 'Inna lista - styczeń 2027',
        periodYear: 2027,
        periodMonth: 1,
        createdById: 'admin',
        items: { create: [{ title: 'Zadanie z innej listy', order: 1 }] },
      },
    })

    const run = await createRunFromTemplate(db, startInput(8))

    expect(run.items.map((item) => item.title)).toEqual(['Raport z kasy', 'Saldo rachunków', 'Rejestr VAT'])
  })

  it('should use the provided name instead of the generated one', async () => {
    await seedTemplate()

    const run = await createRunFromTemplate(db, { ...startInput(8), name: 'Zamknięcie sierpnia' })

    expect(run.name).toBe('Zamknięcie sierpnia')
  })

  it('should reject a second run for the same template and period', async () => {
    await seedTemplate()
    const first = await createRunFromTemplate(db, startInput(8))

    await expect(createRunFromTemplate(db, startInput(8))).rejects.toMatchObject({
      code: 'RUN_EXISTS',
      details: { runId: first.id },
    })
  })

  it('should create and name a yearly run without a month', async () => {
    await seedTemplate()

    const run = await createRunFromTemplate(db, startInput(null))

    expect(run).toMatchObject({ name: 'Księgowość - koniec miesiąca - 2026', periodYear: 2026, periodMonth: null })
  })

  it('should reject a second yearly run for the same template and year', async () => {
    await seedTemplate()
    const first = await createRunFromTemplate(db, startInput(null))

    await expect(createRunFromTemplate(db, startInput(null))).rejects.toMatchObject({
      code: 'RUN_EXISTS',
      details: { runId: first.id },
    })
  })

  it('should create exactly one run when the same period is started concurrently', async () => {
    await seedTemplate()

    const results = await Promise.allSettled([
      createRunFromTemplate(db, startInput(8)),
      createRunFromTemplate(db, startInput(8)),
      createRunFromTemplate(db, startInput(8)),
    ])

    const outcomes = results.map((result) =>
      result.status === 'fulfilled' ? 'created' : (result.reason as RunServiceError).code
    )
    expect(outcomes.sort()).toEqual(['RUN_EXISTS', 'RUN_EXISTS', 'created'])
    expect(await db.checklistRun.count()).toBe(1)
  })

  it('should reject a period that another request claims before the write starts', async () => {
    await seedTemplate()
    const racing = interleaveBeforeTransaction(() => seedRun(8, []))

    await expect(createRunFromTemplate(racing, startInput(8))).rejects.toMatchObject({ code: 'RUN_EXISTS' })

    expect(await db.checklistRun.count()).toBe(1)
  })

  it('should reject starting from a template without items when there is no previous run', async () => {
    await seedTemplate([])

    await expect(createRunFromTemplate(db, startInput(8))).rejects.toMatchObject({ code: 'EMPTY_TEMPLATE' })
  })

  it('should reject an unknown template', async () => {
    await expect(createRunFromTemplate(db, startInput(8))).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' })
  })
})

describe('addRunItem', () => {
  it('should append the task at the end of the run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    const item = await addRunItem(db, run.id, taskInput('Faktura od nowego dostawcy', false))

    expect(item).toMatchObject({ order: 4, recurring: false, status: 'todo' })
  })

  it('should store the description and procedure of the new task', async () => {
    await seedTemplate()
    await seedArticle('procedure', 'procedure')
    const run = await createRunFromTemplate(db, startInput(8))

    const item = await addRunItem(db, run.id, {
      ...taskInput('Faktura od dostawcy'),
      description: 'Sprawdź numer NIP',
      procedureId: 'procedure',
    })

    expect(item).toMatchObject({ description: 'Sprawdź numer NIP', procedureId: 'procedure' })
  })

  it('should reject an article that is not a procedure', async () => {
    await seedTemplate()
    await seedArticle('knowledge', 'knowledge')
    const run = await createRunFromTemplate(db, startInput(8))

    await expect(
      addRunItem(db, run.id, { ...taskInput('Faktura od dostawcy'), procedureId: 'knowledge' })
    ).rejects.toMatchObject({ code: 'PROCEDURE_NOT_FOUND' })
  })

  it('should reject an unknown run', async () => {
    await expect(addRunItem(db, 'missing', taskInput('Faktura od dostawcy'))).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    })
  })

  it('should reject adding to an archived run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    await db.checklistRun.update({ where: { id: run.id }, data: { status: 'archived' } })

    await expect(addRunItem(db, run.id, taskInput('Faktura od dostawcy'))).rejects.toMatchObject({
      code: 'RUN_CLOSED',
    })
  })

  it('should number the first task of an empty run 1', async () => {
    await seedTemplate()
    const run = await seedRun(8, [])

    const item = await addRunItem(db, run.id, taskInput('Faktura od dostawcy'))

    expect(item.order).toBe(1)
  })

  it('should not add a task to a run that is closed before the write starts', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await expect(
      addRunItem(closeRunBeforeWriting(run.id), run.id, taskInput('Faktura od dostawcy'))
    ).rejects.toMatchObject({ code: 'RUN_CLOSED' })

    expect(await itemsOf(run.id)).toHaveLength(3)
  })

  it('should reject an unknown procedure', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await expect(
      addRunItem(db, run.id, { ...taskInput('Faktura od dostawcy'), procedureId: 'missing' })
    ).rejects.toMatchObject({ code: 'PROCEDURE_NOT_FOUND' })
  })

  it('should reject adding to a closed run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    await db.checklistRun.update({ where: { id: run.id }, data: { status: 'closed' } })

    await expect(addRunItem(db, run.id, taskInput('Faktura od dostawcy'))).rejects.toMatchObject({
      code: 'RUN_CLOSED',
    })
  })
})

describe('deleteRunItem', () => {
  it('should renumber the remaining tasks', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await deleteRunItem(db, run.id, run.items[0].id)

    const remaining = await itemsOf(run.id)
    expect(remaining.map((item) => [item.order, item.title])).toEqual([
      [1, 'Saldo rachunków'],
      [2, 'Rejestr VAT'],
    ])
  })

  it('should renumber the tasks after a deleted middle task', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await deleteRunItem(db, run.id, run.items[1].id)

    const remaining = await itemsOf(run.id)
    expect(remaining.map((item) => [item.order, item.title])).toEqual([
      [1, 'Raport z kasy'],
      [2, 'Rejestr VAT'],
    ])
  })

  it('should keep the remaining tasks numbered after deleting the last task', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await deleteRunItem(db, run.id, run.items[2].id)

    const remaining = await itemsOf(run.id)
    expect(remaining.map((item) => [item.order, item.title])).toEqual([
      [1, 'Raport z kasy'],
      [2, 'Saldo rachunków'],
    ])
  })

  it('should reject deleting a task that belongs to another run', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    const september = await createRunFromTemplate(db, startInput(9))

    await expect(deleteRunItem(db, august.id, september.items[0].id)).rejects.toMatchObject({
      code: 'ITEM_NOT_FOUND',
    })
  })

  it('should reject deleting from an unknown run', async () => {
    await expect(deleteRunItem(db, 'missing', 'item')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })

  it('should not delete a task from a run that is closed before the write starts', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await expect(
      deleteRunItem(closeRunBeforeWriting(run.id), run.id, run.items[0].id)
    ).rejects.toMatchObject({ code: 'RUN_CLOSED' })

    expect(await itemsOf(run.id)).toHaveLength(3)
  })

  it('should reject deleting from a closed run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    await db.checklistRun.update({ where: { id: run.id }, data: { status: 'closed' } })

    await expect(deleteRunItem(db, run.id, run.items[0].id)).rejects.toMatchObject({ code: 'RUN_CLOSED' })
  })
})

describe('reorderRunItems', () => {
  it('should apply the new order despite the unique (run, order) constraint', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    const reversed = [...run.items].reverse().map((item) => item.id)

    await reorderRunItems(db, run.id, reversed)

    const items = await itemsOf(run.id)
    expect(items.map((item) => [item.order, item.title])).toEqual([
      [1, 'Rejestr VAT'],
      [2, 'Saldo rachunków'],
      [3, 'Raport z kasy'],
    ])
  })

  it('should reject an order list that is not a permutation of the run tasks', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))

    await expect(reorderRunItems(db, run.id, [run.items[0].id])).rejects.toMatchObject({
      code: 'ORDER_MISMATCH',
    })
  })

  it('should reject a task id from another run and leave the order unchanged', async () => {
    await seedTemplate()
    const august = await createRunFromTemplate(db, startInput(8))
    const september = await createRunFromTemplate(db, startInput(9))
    const foreign = [august.items[0].id, august.items[1].id, september.items[2].id]

    await expect(reorderRunItems(db, august.id, foreign)).rejects.toMatchObject({ code: 'ORDER_MISMATCH' })

    const items = await itemsOf(august.id)
    expect(items.map((item) => [item.order, item.title])).toEqual([
      [1, 'Raport z kasy'],
      [2, 'Saldo rachunków'],
      [3, 'Rejestr VAT'],
    ])
  })

  it('should reject reordering an unknown run', async () => {
    await expect(reorderRunItems(db, 'missing', ['item'])).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })

  it('should not reorder a run that is closed before the write starts', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    const reversed = [...run.items].reverse().map((item) => item.id)

    await expect(reorderRunItems(closeRunBeforeWriting(run.id), run.id, reversed)).rejects.toMatchObject({
      code: 'RUN_CLOSED',
    })

    const items = await itemsOf(run.id)
    expect(items.map((item) => item.title)).toEqual(['Raport z kasy', 'Saldo rachunków', 'Rejestr VAT'])
  })

  it('should reject reordering a closed run', async () => {
    await seedTemplate()
    const run = await createRunFromTemplate(db, startInput(8))
    await db.checklistRun.update({ where: { id: run.id }, data: { status: 'closed' } })

    await expect(
      reorderRunItems(db, run.id, run.items.map((item) => item.id))
    ).rejects.toMatchObject({ code: 'RUN_CLOSED' })
  })
})

describe('getProcedureForItem', () => {
  it('should return null when the task has no procedure', async () => {
    await expect(getProcedureForItem(db, null)).resolves.toBeNull()
  })

  it('should return the id, title and content of a procedure', async () => {
    await seedArticle('procedure', 'procedure')

    await expect(getProcedureForItem(db, 'procedure')).resolves.toEqual({
      id: 'procedure',
      title: 'Artykuł procedure',
      content: 'Treść procedure',
    })
  })

  it('should return null for an article that is not a procedure', async () => {
    await seedArticle('knowledge', 'knowledge')

    await expect(getProcedureForItem(db, 'knowledge')).resolves.toBeNull()
  })
})
