import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getDefaultRunTemplateId, getRuns } from '@/lib/operations/queries'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    checklistRun: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    checklistTemplate: {
      findFirst: vi.fn(),
    },
    contentVisibilityGrant: {
      findMany: vi.fn(),
    },
  },
}))

const mockFindRuns = vi.mocked(prisma.checklistRun.findMany)
const mockFindLastRun = vi.mocked(prisma.checklistRun.findFirst)
const mockFindTemplate = vi.mocked(prisma.checklistTemplate.findFirst)
const mockFindGrants = vi.mocked(prisma.contentVisibilityGrant.findMany)

type ItemStatus = 'todo' | 'in_progress' | 'blocked' | 'done'

interface ItemRow {
  status: ItemStatus
  ownerId: string | null
  title: string
  order: number
}

const admin = { id: 'admin-1', role: 'ADMIN' }
const manager = { id: 'manager-1', role: 'MANAGER' }
const employee = { id: 'employee-1', role: 'EMPLOYEE' }

function item(order: number, title: string, status: ItemStatus, ownerId: string | null): ItemRow {
  return { order, title, status, ownerId }
}

// Mimics what Prisma returns for the `getRuns` query: a run row with its template and the selected item fields.
function runRow(overrides: { id?: string; status?: string; items: ItemRow[] }) {
  return {
    id: overrides.id ?? 'run-1',
    name: 'Zamknięcie miesiąca',
    status: overrides.status ?? 'open',
    templateId: 'template-1',
    periodYear: 2026,
    periodMonth: 9,
    createdAt: new Date('2026-10-01T09:00:00Z'),
    template: { id: 'template-1', name: 'Zamknięcie', module: { id: 'module-1', area: { id: 'area-1' } } },
    items: overrides.items,
  }
}

// The Prisma mock is typed against the full generated model; the rows above only carry the fields `getRuns` reads.
function returnRuns(...rows: ReturnType<typeof runRow>[]) {
  mockFindRuns.mockResolvedValue(rows as unknown as Awaited<ReturnType<typeof prisma.checklistRun.findMany>>)
}

function grantRuns(...runIds: string[]) {
  mockFindGrants.mockResolvedValue(
    runIds.map((resourceId) => ({ resourceId })) as unknown as Awaited<
      ReturnType<typeof prisma.contentVisibilityGrant.findMany>
    >
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mockFindGrants.mockResolvedValue([])
})

describe('getRuns', () => {
  describe('for an ADMIN or MANAGER viewer', () => {
    const items = [
      item(1, 'Wyślij faktury', 'done', 'employee-1'),
      item(2, 'Uzgodnij kasę', 'todo', 'someone-else'),
      item(3, 'Policz zapasy', 'todo', null),
    ]

    it('should compute progress over all items of the run', async () => {
      returnRuns(runRow({ items }))

      const [run] = await getRuns(admin)

      expect(run.progress).toMatchObject({ total: 3, done: 1, todo: 2, percent: 33 })
    })

    it('should compute progress over all items for a MANAGER too', async () => {
      returnRuns(runRow({ items }))

      const [run] = await getRuns(manager)

      expect(run.progress).toMatchObject({ total: 3, done: 1 })
    })

    it('should pick the first not-done item by order as nextItemTitle regardless of owner', async () => {
      returnRuns(
        runRow({
          items: [
            item(3, 'Policz zapasy', 'todo', null),
            item(2, 'Uzgodnij kasę', 'in_progress', 'someone-else'),
            item(1, 'Wyślij faktury', 'done', 'employee-1'),
          ],
        })
      )

      const [run] = await getRuns(admin)

      expect(run.nextItemTitle).toBe('Uzgodnij kasę')
    })

    it('should not filter the runs query by grants or item ownership', async () => {
      returnRuns(runRow({ items }))

      await getRuns(admin)

      expect(mockFindRuns).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    })

    it('should mark an open run with every item done as readyToClose', async () => {
      returnRuns(
        runRow({
          items: [item(1, 'Wyślij faktury', 'done', 'employee-1'), item(2, 'Uzgodnij kasę', 'done', null)],
        })
      )

      const [run] = await getRuns(admin)

      expect(run.readyToClose).toBe(true)
    })
  })

  describe('for an EMPLOYEE viewer without a run grant', () => {
    const items = [
      item(1, 'Sekretne zadanie szefa', 'todo', 'manager-1'),
      item(2, 'Moje zadanie A', 'done', 'employee-1'),
      item(3, 'Moje zadanie B', 'todo', 'employee-1'),
      item(4, 'Zadanie koleżanki', 'todo', 'employee-2'),
      item(5, 'Zadanie bez właściciela', 'todo', null),
    ]

    it('should compute progress only over items owned by the viewer', async () => {
      returnRuns(runRow({ items }))

      const [run] = await getRuns(employee)

      expect(run.progress).toMatchObject({ total: 2, done: 1, todo: 1, percent: 50 })
    })

    it('should take nextItemTitle from the viewer own items only', async () => {
      returnRuns(runRow({ items }))

      const [run] = await getRuns(employee)

      expect(run.nextItemTitle).toBe('Moje zadanie B')
    })

    it('should never expose the title of a task owned by someone else', async () => {
      returnRuns(runRow({ items }))

      const [run] = await getRuns(employee)

      const serialized = JSON.stringify(run)
      expect(serialized).not.toContain('Sekretne zadanie szefa')
      expect(serialized).not.toContain('Zadanie koleżanki')
      expect(serialized).not.toContain('Zadanie bez właściciela')
    })

    it('should return null nextItemTitle when only other people have open tasks', async () => {
      returnRuns(
        runRow({
          items: [item(1, 'Moje zadanie A', 'done', 'employee-1'), item(2, 'Zadanie koleżanki', 'todo', 'employee-2')],
        })
      )

      const [run] = await getRuns(employee)

      expect(run.nextItemTitle).toBeNull()
    })

    it('should not mark readyToClose when the viewer own items are done but a colleague task is not', async () => {
      returnRuns(
        runRow({
          items: [item(1, 'Moje zadanie A', 'done', 'employee-1'), item(2, 'Zadanie koleżanki', 'todo', 'employee-2')],
        })
      )

      const [run] = await getRuns(employee)

      expect(run.readyToClose).toBe(false)
    })

    it('should look up the viewer grants for runs', async () => {
      returnRuns(runRow({ items }))

      await getRuns(employee)

      expect(mockFindGrants).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'employee-1', resourceType: 'run' } })
      )
    })

    it('should restrict the runs query to granted runs and runs with an item owned by the viewer', async () => {
      grantRuns('run-granted')
      returnRuns(runRow({ items }))

      await getRuns(employee)

      expect(mockFindRuns).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [{ id: { in: ['run-granted'] } }, { items: { some: { ownerId: 'employee-1' } } }],
          },
        })
      )
    })
  })

  describe('for an EMPLOYEE viewer with a run grant', () => {
    it('should compute progress and nextItemTitle over all items of the granted run', async () => {
      grantRuns('run-1')
      returnRuns(
        runRow({
          id: 'run-1',
          items: [
            item(1, 'Wyślij faktury', 'done', 'manager-1'),
            item(2, 'Uzgodnij kasę', 'todo', 'employee-2'),
            item(3, 'Moje zadanie', 'todo', 'employee-1'),
          ],
        })
      )

      const [run] = await getRuns(employee)

      expect(run).toMatchObject({
        progress: { total: 3, done: 1 },
        nextItemTitle: 'Uzgodnij kasę',
      })
    })

    it('should keep filtering a run that is not granted when another run is', async () => {
      grantRuns('run-granted')
      returnRuns(
        runRow({
          id: 'run-not-granted',
          items: [item(1, 'Cudze zadanie', 'todo', 'employee-2'), item(2, 'Moje zadanie', 'todo', 'employee-1')],
        })
      )

      const [run] = await getRuns(employee)

      expect(run).toMatchObject({ progress: { total: 1 }, nextItemTitle: 'Moje zadanie' })
    })
  })

  describe('response shape', () => {
    it('should return items with only status and ownerId', async () => {
      returnRuns(runRow({ items: [item(1, 'Wyślij faktury', 'done', 'employee-1')] }))

      const [run] = await getRuns(admin)

      expect(run.items).toEqual([{ status: 'done', ownerId: 'employee-1' }])
    })

    it('should list every item in items even when the viewer can only see some of them', async () => {
      returnRuns(
        runRow({
          items: [item(1, 'Moje zadanie', 'todo', 'employee-1'), item(2, 'Cudze zadanie', 'todo', 'employee-2')],
        })
      )

      const [run] = await getRuns(employee)

      expect(run.items).toEqual([
        { status: 'todo', ownerId: 'employee-1' },
        { status: 'todo', ownerId: 'employee-2' },
      ])
    })
  })

  describe('nextItemTitle', () => {
    it('should be null when every visible item is done', async () => {
      returnRuns(
        runRow({
          items: [item(1, 'Wyślij faktury', 'done', 'employee-1'), item(2, 'Uzgodnij kasę', 'done', null)],
        })
      )

      const [run] = await getRuns(admin)

      expect(run.nextItemTitle).toBeNull()
    })

    it('should be null when the run has no items', async () => {
      returnRuns(runRow({ items: [] }))

      const [run] = await getRuns(admin)

      expect(run.nextItemTitle).toBeNull()
    })
  })

  describe('readyToClose', () => {
    it('should be false for a closed run whose items are all done', async () => {
      returnRuns(runRow({ status: 'closed', items: [item(1, 'Wyślij faktury', 'done', 'employee-1')] }))

      const [run] = await getRuns(admin)

      expect(run.readyToClose).toBe(false)
    })

    it('should be false for an open run with no items at all', async () => {
      returnRuns(runRow({ items: [] }))

      const [run] = await getRuns(admin)

      expect(run.readyToClose).toBe(false)
    })

    it('should be true for an EMPLOYEE viewer when every task of the open run is done, including tasks of others', async () => {
      returnRuns(
        runRow({
          items: [item(1, 'Moje zadanie', 'done', 'employee-1'), item(2, 'Cudze zadanie', 'done', 'employee-2')],
        })
      )

      const [run] = await getRuns(employee)

      expect(run.readyToClose).toBe(true)
    })

    it('should be false for an open run with one item still not done', async () => {
      returnRuns(
        runRow({
          items: [item(1, 'Wyślij faktury', 'done', 'employee-1'), item(2, 'Uzgodnij kasę', 'blocked', 'employee-1')],
        })
      )

      const [run] = await getRuns(admin)

      expect(run.readyToClose).toBe(false)
    })
  })
})

describe('getDefaultRunTemplateId', () => {
  it('should return the templateId of the latest run when a run exists', async () => {
    mockFindLastRun.mockResolvedValue({ templateId: 'template-from-run' } as Awaited<
      ReturnType<typeof prisma.checklistRun.findFirst>
    >)

    const templateId = await getDefaultRunTemplateId()

    expect(templateId).toBe('template-from-run')
  })

  it('should order runs from the newest period when looking for the latest run', async () => {
    mockFindLastRun.mockResolvedValue({ templateId: 'template-from-run' } as Awaited<
      ReturnType<typeof prisma.checklistRun.findFirst>
    >)

    await getDefaultRunTemplateId()

    expect(mockFindLastRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
      })
    )
  })

  it('should not look for a template when a run exists', async () => {
    mockFindLastRun.mockResolvedValue({ templateId: 'template-from-run' } as Awaited<
      ReturnType<typeof prisma.checklistRun.findFirst>
    >)

    await getDefaultRunTemplateId()

    expect(mockFindTemplate).not.toHaveBeenCalled()
  })

  it('should fall back to the first active template when there are no runs', async () => {
    mockFindLastRun.mockResolvedValue(null)
    mockFindTemplate.mockResolvedValue({ id: 'template-active' } as Awaited<
      ReturnType<typeof prisma.checklistTemplate.findFirst>
    >)

    const templateId = await getDefaultRunTemplateId()

    expect(templateId).toBe('template-active')
  })

  it('should only consider active templates in the fallback', async () => {
    mockFindLastRun.mockResolvedValue(null)
    mockFindTemplate.mockResolvedValue({ id: 'template-active' } as Awaited<
      ReturnType<typeof prisma.checklistTemplate.findFirst>
    >)

    await getDefaultRunTemplateId()

    expect(mockFindTemplate).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }))
  })

  it('should return null when there are neither runs nor active templates', async () => {
    mockFindLastRun.mockResolvedValue(null)
    mockFindTemplate.mockResolvedValue(null)

    const templateId = await getDefaultRunTemplateId()

    expect(templateId).toBeNull()
  })
})
