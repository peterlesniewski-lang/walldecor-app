import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  addRunItem,
  assertProcedureExists,
  assertRunIsOpen,
  createRunFromTemplate,
  deleteRunItem,
  getProcedureForItem,
  reorderRunItems,
  RunServiceError,
} from '@/lib/operations/run-service'
import { POST as startRun } from '@/app/api/operations/runs/route'
import { POST as createItem } from '@/app/api/operations/runs/[id]/items/route'
import { PATCH as patchItem, DELETE as removeItem } from '@/app/api/operations/runs/[id]/items/[itemId]/route'
import { PUT as putOrder } from '@/app/api/operations/runs/[id]/items/order/route'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: { checklistRunItem: { findFirst: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/operations/run-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/operations/run-service')>()
  return {
    ...actual,
    createRunFromTemplate: vi.fn(),
    addRunItem: vi.fn(),
    deleteRunItem: vi.fn(),
    reorderRunItems: vi.fn(),
    assertRunIsOpen: vi.fn(),
    assertProcedureExists: vi.fn(),
    getProcedureForItem: vi.fn(),
  }
})

const mockSession = vi.mocked(getServerSession)
const mockFindItem = vi.mocked(prisma.checklistRunItem.findFirst)
const mockUpdateItem = vi.mocked(prisma.checklistRunItem.update)

function session(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE', id = `${role.toLowerCase()}-1`) {
  return { user: { id, name: role, email: `${id}@test.pl`, role }, expires: '' }
}

function jsonRequest(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/operations/test', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const runParams = { params: Promise.resolve({ id: 'run-1' }) }
const itemParams = { params: Promise.resolve({ id: 'run-1', itemId: 'item-1' }) }

const storedItem = {
  id: 'item-1',
  runId: 'run-1',
  templateItemId: null,
  title: 'Raport z kasy',
  description: null,
  order: 1,
  procedureId: null,
  ownerId: 'employee-1',
  status: 'todo',
  note: null,
  recurring: true,
  completedAt: null,
  completedById: null,
  createdAt: new Date('2026-09-01T09:00:00Z'),
  updatedAt: new Date('2026-09-01T09:00:00Z'),
}

beforeEach(() => {
  vi.resetAllMocks()
  mockSession.mockResolvedValue(session('MANAGER'))
  mockFindItem.mockResolvedValue(storedItem)
  mockUpdateItem.mockResolvedValue(storedItem)
  vi.mocked(getProcedureForItem).mockResolvedValue(null)
})

describe('POST /api/operations/runs', () => {
  const body = { templateId: 'template-1', periodYear: 2026, periodMonth: 9 }

  it('should return 401 without a session', async () => {
    mockSession.mockResolvedValue(null)

    const res = await startRun(jsonRequest('POST', body))

    expect(res.status).toBe(401)
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await startRun(jsonRequest('POST', body))

    expect(res.status).toBe(403)
  })

  it('should return 400 for an invalid month', async () => {
    const res = await startRun(jsonRequest('POST', { ...body, periodMonth: 13 }))

    expect(res.status).toBe(400)
  })

  it('should return 409 with the existing run id when the month is already started', async () => {
    vi.mocked(createRunFromTemplate).mockRejectedValue(new RunServiceError('RUN_EXISTS', { runId: 'run-9' }))

    const res = await startRun(jsonRequest('POST', body))

    expect(await res.json()).toMatchObject({ runId: 'run-9' })
  })

  it('should answer 409 for a duplicate month', async () => {
    vi.mocked(createRunFromTemplate).mockRejectedValue(new RunServiceError('RUN_EXISTS', { runId: 'run-9' }))

    const res = await startRun(jsonRequest('POST', body))

    expect(res.status).toBe(409)
  })

  it('should return 201 for a new month', async () => {
    vi.mocked(createRunFromTemplate).mockResolvedValue({ id: 'run-new' } as never)

    const res = await startRun(jsonRequest('POST', body))

    expect(res.status).toBe(201)
  })

  it('should pass the template, the period and the author to the service', async () => {
    vi.mocked(createRunFromTemplate).mockResolvedValue({ id: 'run-new' } as never)

    await startRun(jsonRequest('POST', body))

    expect(createRunFromTemplate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        templateId: 'template-1',
        periodYear: 2026,
        periodMonth: 9,
        createdById: 'manager-1',
      })
    )
  })
})

describe('POST /api/operations/runs/[id]/items', () => {
  const body = { title: 'Faktura od nowego dostawcy', recurring: false }

  it('should return 401 without a session', async () => {
    mockSession.mockResolvedValue(null)

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(401)
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(403)
  })

  it('should return 400 for a too short title', async () => {
    const res = await createItem(jsonRequest('POST', { title: 'ab' }), runParams)

    expect(res.status).toBe(400)
  })

  it('should return 409 when the run is closed', async () => {
    vi.mocked(addRunItem).mockRejectedValue(new RunServiceError('RUN_CLOSED'))

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(409)
  })

  it('should return 201 and pass the recurring flag to the service', async () => {
    vi.mocked(addRunItem).mockResolvedValue({ ...storedItem, id: 'item-new', procedureId: null } as never)

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(201)
    expect(addRunItem).toHaveBeenCalledWith(
      expect.anything(),
      'run-1',
      expect.objectContaining({ title: 'Faktura od nowego dostawcy', recurring: false })
    )
  })

  it('should return the linked procedure with the created task', async () => {
    const procedure = { id: 'proc-1', title: 'Jak zrobić raport', content: '1. Otwórz kasę' }
    vi.mocked(addRunItem).mockResolvedValue({ ...storedItem, id: 'item-new', procedureId: 'proc-1' } as never)
    vi.mocked(getProcedureForItem).mockResolvedValue(procedure as never)

    const res = await createItem(jsonRequest('POST', { ...body, procedureId: 'proc-1' }), runParams)

    expect(await res.json()).toMatchObject({ id: 'item-new', procedure })
  })
})

describe('PATCH /api/operations/runs/[id]/items/[itemId]', () => {
  it('should return 401 without a session', async () => {
    mockSession.mockResolvedValue(null)

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(401)
  })

  it('should return 404 for a task that is not in the run', async () => {
    mockFindItem.mockResolvedValue(null)

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(404)
  })

  it('should return 400 for an invalid payload', async () => {
    const res = await patchItem(jsonRequest('PATCH', { title: 'ab' }), itemParams)

    expect(res.status).toBe(400)
  })

  it('should look the task up inside the run from the URL', async () => {
    await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(mockFindItem).toHaveBeenCalledWith({ where: { id: 'item-1', runId: 'run-1' } })
  })

  it('should let the task owner change the status', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(200)
  })

  it('should forbid the task owner from renaming the task', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await patchItem(jsonRequest('PATCH', { title: 'Inna nazwa' }), itemParams)

    expect(res.status).toBe(403)
  })

  it('should forbid an employee who does not own the task', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'someone-else'))

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(403)
  })

  it('should let a manager switch recurring off', async () => {
    const res = await patchItem(jsonRequest('PATCH', { recurring: false }), itemParams)

    expect(res.status).toBe(200)
    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recurring: false }) })
    )
  })

  it('should save the edited title, description and procedure for a manager', async () => {
    await patchItem(
      jsonRequest('PATCH', { title: 'Nowa nazwa', description: 'Nowy opis', procedureId: 'proc-2' }),
      itemParams
    )

    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Nowa nazwa', description: 'Nowy opis', procedureId: 'proc-2' }),
      })
    )
  })

  it('should return 400 when the linked procedure does not exist', async () => {
    vi.mocked(assertProcedureExists).mockRejectedValue(new RunServiceError('PROCEDURE_NOT_FOUND'))

    const res = await patchItem(jsonRequest('PATCH', { procedureId: 'missing' }), itemParams)

    expect(res.status).toBe(400)
  })

  it('should not let the task owner reassign the task', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    await patchItem(jsonRequest('PATCH', { ownerId: 'someone-else' }), itemParams)

    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: 'employee-1' }) })
    )
  })

  it('should return the linked procedure with the updated task', async () => {
    const procedure = { id: 'proc-1', title: 'Jak zrobić raport', content: '1. Otwórz kasę' }
    vi.mocked(getProcedureForItem).mockResolvedValue(procedure as never)

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(await res.json()).toMatchObject({ id: 'item-1', procedure })
  })

  it('should return 409 when the run is closed', async () => {
    vi.mocked(assertRunIsOpen).mockRejectedValue(new RunServiceError('RUN_CLOSED'))

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(409)
  })
})

describe('DELETE /api/operations/runs/[id]/items/[itemId]', () => {
  it('should return 401 without a session', async () => {
    mockSession.mockResolvedValue(null)

    const res = await removeItem(new NextRequest('http://localhost/x', { method: 'DELETE' }), itemParams)

    expect(res.status).toBe(401)
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await removeItem(new NextRequest('http://localhost/x', { method: 'DELETE' }), itemParams)

    expect(res.status).toBe(403)
  })

  it('should delete the task for a manager', async () => {
    const res = await removeItem(new NextRequest('http://localhost/x', { method: 'DELETE' }), itemParams)

    expect(res.status).toBe(200)
    expect(deleteRunItem).toHaveBeenCalledWith(expect.anything(), 'run-1', 'item-1')
  })

  it('should return 404 for an unknown task', async () => {
    vi.mocked(deleteRunItem).mockRejectedValue(new RunServiceError('ITEM_NOT_FOUND'))

    const res = await removeItem(new NextRequest('http://localhost/x', { method: 'DELETE' }), itemParams)

    expect(res.status).toBe(404)
  })
})

describe('PUT /api/operations/runs/[id]/items/order', () => {
  it('should return 401 without a session', async () => {
    mockSession.mockResolvedValue(null)

    const res = await putOrder(jsonRequest('PUT', { itemIds: ['a', 'b'] }), runParams)

    expect(res.status).toBe(401)
  })

  it('should return 400 for an empty list of ids', async () => {
    const res = await putOrder(jsonRequest('PUT', { itemIds: [] }), runParams)

    expect(res.status).toBe(400)
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await putOrder(jsonRequest('PUT', { itemIds: ['a', 'b'] }), runParams)

    expect(res.status).toBe(403)
  })

  it('should return 400 when the ids do not match the run tasks', async () => {
    vi.mocked(reorderRunItems).mockRejectedValue(new RunServiceError('ORDER_MISMATCH'))

    const res = await putOrder(jsonRequest('PUT', { itemIds: ['a'] }), runParams)

    expect(res.status).toBe(400)
  })

  it('should reorder for a manager', async () => {
    const res = await putOrder(jsonRequest('PUT', { itemIds: ['b', 'a'] }), runParams)

    expect(res.status).toBe(200)
    expect(reorderRunItems).toHaveBeenCalledWith(expect.anything(), 'run-1', ['b', 'a'])
  })
})
