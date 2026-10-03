import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { PATCH as patchRun } from '@/app/api/operations/runs/[id]/route'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    checklistRun: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    checklistRunItem: { count: vi.fn(), findMany: vi.fn() },
  },
}))

const mockSession = vi.mocked(getServerSession)
const mockFindRun = vi.mocked(prisma.checklistRun.findUnique)
const mockFindOtherRun = vi.mocked(prisma.checklistRun.findFirst)
const mockUpdateRun = vi.mocked(prisma.checklistRun.update)

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE') {
  return { user: { id: `${role.toLowerCase()}-1`, name: role, email: `${role.toLowerCase()}@test.pl`, role }, expires: '' }
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/operations/runs/run-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const runParams = { params: Promise.resolve({ id: 'run-1' }) }

const openRun = {
  id: 'run-1',
  templateId: 'template-1',
  name: 'Zamknięcie miesiąca - wrzesień 2026',
  periodYear: 2026,
  periodMonth: 9,
  status: 'open',
  createdById: 'admin-1',
  createdAt: new Date('2026-09-01T09:00:00Z'),
  updatedAt: new Date('2026-09-01T09:00:00Z'),
  template: { name: 'Zamknięcie miesiąca' },
}

const closedRun = { ...openRun, status: 'closed' }

// The `data` the PATCH handler passed to prisma.checklistRun.update.
function updateData() {
  const [args] = mockUpdateRun.mock.calls[0]
  return args.data as Record<string, unknown>
}

beforeEach(() => {
  vi.resetAllMocks()
  mockSession.mockResolvedValue(session('MANAGER'))
  mockFindRun.mockResolvedValue(openRun as never)
  mockFindOtherRun.mockResolvedValue(null)
  mockUpdateRun.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...openRun, ...data })) as never)
  // Three tasks that are still open: closing must not care.
  vi.mocked(prisma.checklistRunItem.count).mockResolvedValue(3)
  vi.mocked(prisma.checklistRunItem.findMany).mockResolvedValue([
    { id: 'item-1', status: 'todo' },
    { id: 'item-2', status: 'blocked' },
    { id: 'item-3', status: 'todo' },
  ] as never)
})

describe('PATCH /api/operations/runs/[id]', () => {
  describe('access and input', () => {
    it('should return 401 without a session', async () => {
      mockSession.mockResolvedValue(null)

      const res = await patchRun(patchRequest({ status: 'closed' }), runParams)

      expect(res.status).toBe(401)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return 403 for an employee', async () => {
      mockSession.mockResolvedValue(session('EMPLOYEE'))

      const res = await patchRun(patchRequest({ status: 'closed' }), runParams)

      expect(res.status).toBe(403)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return 400 for an invalid month', async () => {
      const res = await patchRun(patchRequest({ periodMonth: 13 }), runParams)

      expect(res.status).toBe(400)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return 400 for an unknown status', async () => {
      const res = await patchRun(patchRequest({ status: 'deleted' }), runParams)

      expect(res.status).toBe(400)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return 404 for an unknown run', async () => {
      mockFindRun.mockResolvedValue(null)

      const res = await patchRun(patchRequest({ status: 'closed' }), runParams)

      expect(res.status).toBe(404)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })
  })

  describe('closing and reopening', () => {
    it.each(['ADMIN', 'MANAGER'] as const)('should let the %s role close a run that still has unfinished tasks', async (role) => {
      mockSession.mockResolvedValue(session(role))

      const res = await patchRun(patchRequest({ status: 'closed' }), runParams)

      expect(res.status).toBe(200)
    })

    it('should write only the status when a run is closed', async () => {
      await patchRun(patchRequest({ status: 'closed' }), runParams)

      expect(updateData()).toEqual({ status: 'closed' })
    })

    it('should reopen a closed run', async () => {
      mockFindRun.mockResolvedValue(closedRun as never)

      const res = await patchRun(patchRequest({ status: 'open' }), runParams)

      expect(res.status).toBe(200)
      expect(updateData()).toEqual({ status: 'open' })
    })

    it('should not look at the tasks when a run is closed', async () => {
      await patchRun(patchRequest({ status: 'closed' }), runParams)

      expect(prisma.checklistRunItem.count).not.toHaveBeenCalled()
      expect(prisma.checklistRunItem.findMany).not.toHaveBeenCalled()
    })

    it('should not look for duplicate months when only the status changes', async () => {
      await patchRun(patchRequest({ status: 'closed' }), runParams)

      expect(mockFindOtherRun).not.toHaveBeenCalled()
    })
  })

  describe('a closed run is read-only', () => {
    beforeEach(() => {
      mockFindRun.mockResolvedValue(closedRun as never)
    })

    it('should return 409 when the period of a closed run is changed', async () => {
      const res = await patchRun(patchRequest({ periodYear: 2026, periodMonth: 10 }), runParams)

      expect(res.status).toBe(409)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return 409 when only the year of a closed run is changed', async () => {
      const res = await patchRun(patchRequest({ periodYear: 2027 }), runParams)

      expect(res.status).toBe(409)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return 409 when the month of a closed run is cleared', async () => {
      const res = await patchRun(patchRequest({ periodMonth: null }), runParams)

      expect(res.status).toBe(409)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return 409 when a closed run is renamed', async () => {
      const res = await patchRun(patchRequest({ name: 'Inna nazwa' }), runParams)

      expect(res.status).toBe(409)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should report why the closed run was refused', async () => {
      const res = await patchRun(patchRequest({ name: 'Inna nazwa' }), runParams)

      expect(await res.json()).toMatchObject({ error: 'Run is closed' })
    })

    it('should return 409 when a run is reopened together with a period change', async () => {
      const res = await patchRun(patchRequest({ status: 'open', periodMonth: 10 }), runParams)

      expect(res.status).toBe(409)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return 409 when an archived run is renamed', async () => {
      mockFindRun.mockResolvedValue({ ...closedRun, status: 'archived' } as never)

      const res = await patchRun(patchRequest({ name: 'Inna nazwa' }), runParams)

      expect(res.status).toBe(409)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })
  })

  describe('editing the period of an open run', () => {
    it('should move the run to a free month and regenerate its name', async () => {
      const res = await patchRun(patchRequest({ periodYear: 2026, periodMonth: 10 }), runParams)

      expect(res.status).toBe(200)
      expect(updateData()).toMatchObject({
        periodYear: 2026,
        periodMonth: 10,
        name: 'Zamknięcie miesiąca - październik 2026',
      })
    })

    it('should look for another run of the same template in the target month', async () => {
      await patchRun(patchRequest({ periodYear: 2026, periodMonth: 10 }), runParams)

      expect(mockFindOtherRun).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { templateId: 'template-1', periodYear: 2026, periodMonth: 10, id: { not: 'run-1' } },
        })
      )
    })

    it('should keep the current month when only the year changes', async () => {
      await patchRun(patchRequest({ periodYear: 2027 }), runParams)

      expect(mockFindOtherRun).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { templateId: 'template-1', periodYear: 2027, periodMonth: 9, id: { not: 'run-1' } },
        })
      )
    })

    it('should return 409 when another run of the template already has that month', async () => {
      mockFindOtherRun.mockResolvedValue({ id: 'run-9' } as never)

      const res = await patchRun(patchRequest({ periodYear: 2026, periodMonth: 10 }), runParams)

      expect(res.status).toBe(409)
      expect(mockUpdateRun).not.toHaveBeenCalled()
    })

    it('should return the id of the run that already has that month', async () => {
      mockFindOtherRun.mockResolvedValue({ id: 'run-9' } as never)

      const res = await patchRun(patchRequest({ periodYear: 2026, periodMonth: 10 }), runParams)

      expect(await res.json()).toMatchObject({ error: 'Run already exists', runId: 'run-9' })
    })

    it('should accept the period the run already has', async () => {
      const res = await patchRun(patchRequest({ periodYear: 2026, periodMonth: 9 }), runParams)

      expect(res.status).toBe(200)
    })

    it('should not look for duplicates when the period stays the same', async () => {
      await patchRun(patchRequest({ periodYear: 2026, periodMonth: 9 }), runParams)

      expect(mockFindOtherRun).not.toHaveBeenCalled()
    })

    it('should let an admin rename an open run without touching the period', async () => {
      mockSession.mockResolvedValue(session('ADMIN'))

      const res = await patchRun(patchRequest({ name: 'Zamknięcie - wersja robocza' }), runParams)

      expect(res.status).toBe(200)
      expect(updateData()).toEqual({ name: 'Zamknięcie - wersja robocza' })
    })

    it('should return the updated run', async () => {
      const res = await patchRun(patchRequest({ periodYear: 2026, periodMonth: 10 }), runParams)

      expect(await res.json()).toMatchObject({ id: 'run-1', periodMonth: 10 })
    })
  })
})
