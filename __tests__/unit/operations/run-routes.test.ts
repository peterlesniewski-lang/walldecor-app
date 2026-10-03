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
  type RunServiceErrorCode,
} from '@/lib/operations/run-service'
import { runErrorResponse } from '@/lib/operations/run-http'
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

function deleteRequest() {
  return new NextRequest('http://localhost/api/operations/test', { method: 'DELETE' })
}

// The `data` the PATCH handler passed to prisma.checklistRunItem.update.
function updateData() {
  const [args] = mockUpdateItem.mock.calls[0]
  return args.data as Record<string, unknown>
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

const doneItem = {
  ...storedItem,
  status: 'done',
  completedAt: new Date('2026-09-05T10:00:00Z'),
  completedById: 'employee-2',
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
    expect(createRunFromTemplate).not.toHaveBeenCalled()
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await startRun(jsonRequest('POST', body))

    expect(res.status).toBe(403)
    expect(createRunFromTemplate).not.toHaveBeenCalled()
  })

  it('should return 400 for an invalid month', async () => {
    const res = await startRun(jsonRequest('POST', { ...body, periodMonth: 13 }))

    expect(res.status).toBe(400)
    expect(createRunFromTemplate).not.toHaveBeenCalled()
  })

  it('should return the existing run id when the month is already started', async () => {
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
    expect(addRunItem).not.toHaveBeenCalled()
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await createItem(jsonRequest('POST', body), runParams)

    expect(res.status).toBe(403)
    expect(addRunItem).not.toHaveBeenCalled()
  })

  it('should return 400 for a too short title', async () => {
    const res = await createItem(jsonRequest('POST', { title: 'ab' }), runParams)

    expect(res.status).toBe(400)
    expect(addRunItem).not.toHaveBeenCalled()
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
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('should return 404 for a task that is not in the run', async () => {
    mockFindItem.mockResolvedValue(null)

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(404)
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('should return 400 for an invalid payload', async () => {
    const res = await patchItem(jsonRequest('PATCH', { title: 'ab' }), itemParams)

    expect(res.status).toBe(400)
    expect(mockUpdateItem).not.toHaveBeenCalled()
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
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('should forbid the task owner from clearing the description', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await patchItem(jsonRequest('PATCH', { description: null }), itemParams)

    expect(res.status).toBe(403)
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('should forbid the task owner from unlinking the procedure', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await patchItem(jsonRequest('PATCH', { procedureId: null }), itemParams)

    expect(res.status).toBe(403)
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  it('should forbid an employee who does not own the task', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'someone-else'))

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(403)
    expect(mockUpdateItem).not.toHaveBeenCalled()
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
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })

  describe('a task linked to a procedure that no longer exists', () => {
    const staleItem = { ...storedItem, procedureId: 'proc-deleted' }

    beforeEach(() => {
      mockFindItem.mockResolvedValue(staleItem)
      vi.mocked(assertProcedureExists).mockRejectedValue(new RunServiceError('PROCEDURE_NOT_FOUND'))
    })

    it('should let a manager edit the title when the form sends the stored procedure back', async () => {
      const res = await patchItem(
        jsonRequest('PATCH', { title: 'Nowa nazwa', procedureId: 'proc-deleted' }),
        itemParams
      )

      expect(res.status).toBe(200)
    })

    it('should not check the procedure when its id is unchanged', async () => {
      await patchItem(jsonRequest('PATCH', { title: 'Nowa nazwa', procedureId: 'proc-deleted' }), itemParams)

      expect(assertProcedureExists).not.toHaveBeenCalled()
    })

    it('should check the procedure when the link changes to a different one', async () => {
      await patchItem(jsonRequest('PATCH', { procedureId: 'proc-2' }), itemParams)

      expect(assertProcedureExists).toHaveBeenCalledWith(expect.anything(), 'proc-2')
    })

    it('should return 400 when the link changes to a procedure that does not exist', async () => {
      const res = await patchItem(jsonRequest('PATCH', { procedureId: 'proc-missing' }), itemParams)

      expect(res.status).toBe(400)
      expect(mockUpdateItem).not.toHaveBeenCalled()
    })

    it('should let a manager unlink the stale procedure', async () => {
      const res = await patchItem(jsonRequest('PATCH', { procedureId: null }), itemParams)

      expect(res.status).toBe(200)
      expect(updateData()).toEqual({ procedureId: null })
    })
  })

  it('should not let the task owner reassign the task', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    await patchItem(jsonRequest('PATCH', { ownerId: 'someone-else' }), itemParams)

    expect(updateData()).not.toHaveProperty('ownerId')
  })

  it('should let a manager reassign the task and write nothing else', async () => {
    await patchItem(jsonRequest('PATCH', { ownerId: 'employee-3' }), itemParams)

    expect(updateData()).toEqual({ ownerId: 'employee-3' })
  })

  it('should let a manager unassign the task', async () => {
    await patchItem(jsonRequest('PATCH', { ownerId: null }), itemParams)

    expect(updateData()).toEqual({ ownerId: null })
  })

  it('should return the linked procedure with the updated task', async () => {
    const procedure = { id: 'proc-1', title: 'Jak zrobić raport', content: '1. Otwórz kasę' }
    vi.mocked(getProcedureForItem).mockResolvedValue(procedure as never)

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(await res.json()).toMatchObject({ id: 'item-1', procedure })
  })

  it('should let a manager unlink the procedure without checking that it exists', async () => {
    await patchItem(jsonRequest('PATCH', { procedureId: null }), itemParams)

    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ procedureId: null }) })
    )
    expect(assertProcedureExists).not.toHaveBeenCalled()
  })

  describe('completion bookkeeping', () => {
    it('should stamp the completion time and the current user when a task is marked done', async () => {
      await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

      expect(updateData()).toEqual({ status: 'done', completedAt: expect.any(Date), completedById: 'manager-1' })
    })

    it('should keep who completed the task when it is marked done again', async () => {
      mockFindItem.mockResolvedValue(doneItem)

      await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

      expect(updateData()).toEqual({
        status: 'done',
        completedAt: doneItem.completedAt,
        completedById: 'employee-2',
      })
    })

    it('should clear the completion when a done task goes back to todo', async () => {
      mockFindItem.mockResolvedValue(doneItem)

      await patchItem(jsonRequest('PATCH', { status: 'todo' }), itemParams)

      expect(updateData()).toEqual({ status: 'todo', completedAt: null, completedById: null })
    })

    it('should not touch who completed the task when a manager only edits the note', async () => {
      mockFindItem.mockResolvedValue(doneItem)

      await patchItem(jsonRequest('PATCH', { note: 'Sprawdzone' }), itemParams)

      expect(updateData()).not.toHaveProperty('completedById')
    })

    it('should not touch the completion time when a manager only edits the note', async () => {
      mockFindItem.mockResolvedValue(doneItem)

      await patchItem(jsonRequest('PATCH', { note: 'Sprawdzone' }), itemParams)

      expect(updateData()).not.toHaveProperty('completedAt')
    })

    it('should not touch the completion when a manager switches recurring off', async () => {
      mockFindItem.mockResolvedValue(doneItem)

      await patchItem(jsonRequest('PATCH', { recurring: false }), itemParams)

      expect(updateData()).toEqual({ recurring: false })
    })
  })

  describe('writing only the fields that were sent', () => {
    it('should write only the note when only the note is sent', async () => {
      mockFindItem.mockResolvedValue(doneItem)

      await patchItem(jsonRequest('PATCH', { note: 'Sprawdzone' }), itemParams)

      expect(updateData()).toEqual({ note: 'Sprawdzone' })
    })

    it('should write a null note when the note is cleared', async () => {
      await patchItem(jsonRequest('PATCH', { note: null }), itemParams)

      expect(updateData()).toEqual({ note: null })
    })

    it('should not write the note when only the status is sent', async () => {
      await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

      expect(updateData()).not.toHaveProperty('note')
    })

    it('should not write the owner when only the status is sent', async () => {
      await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

      expect(updateData()).not.toHaveProperty('ownerId')
    })

    it('should not write the status when only the note is sent', async () => {
      await patchItem(jsonRequest('PATCH', { note: 'Sprawdzone' }), itemParams)

      expect(updateData()).not.toHaveProperty('status')
    })

    it('should write both the status and the note when both are sent', async () => {
      await patchItem(jsonRequest('PATCH', { status: 'blocked', note: 'Brak dostępu' }), itemParams)

      expect(updateData()).toEqual({
        status: 'blocked',
        note: 'Brak dostępu',
        completedAt: null,
        completedById: null,
      })
    })

    it('should write only the sent structure fields for a manager', async () => {
      await patchItem(jsonRequest('PATCH', { title: 'Nowa nazwa', recurring: false }), itemParams)

      expect(updateData()).toEqual({ title: 'Nowa nazwa', recurring: false })
    })

    it('should let the task owner write the note', async () => {
      mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

      await patchItem(jsonRequest('PATCH', { note: 'Gotowe do sprawdzenia' }), itemParams)

      expect(updateData()).toEqual({ note: 'Gotowe do sprawdzenia' })
    })
  })

  it('should return 409 when the run is closed', async () => {
    vi.mocked(assertRunIsOpen).mockRejectedValue(new RunServiceError('RUN_CLOSED'))

    const res = await patchItem(jsonRequest('PATCH', { status: 'done' }), itemParams)

    expect(res.status).toBe(409)
    expect(mockUpdateItem).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/operations/runs/[id]/items/[itemId]', () => {
  it('should return 401 without a session', async () => {
    mockSession.mockResolvedValue(null)

    const res = await removeItem(deleteRequest(), itemParams)

    expect(res.status).toBe(401)
    expect(deleteRunItem).not.toHaveBeenCalled()
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE', 'employee-1'))

    const res = await removeItem(deleteRequest(), itemParams)

    expect(res.status).toBe(403)
    expect(deleteRunItem).not.toHaveBeenCalled()
  })

  it('should delete the task for a manager', async () => {
    const res = await removeItem(deleteRequest(), itemParams)

    expect(res.status).toBe(200)
    expect(deleteRunItem).toHaveBeenCalledWith(expect.anything(), 'run-1', 'item-1')
  })

  it('should return 404 for an unknown task', async () => {
    vi.mocked(deleteRunItem).mockRejectedValue(new RunServiceError('ITEM_NOT_FOUND'))

    const res = await removeItem(deleteRequest(), itemParams)

    expect(res.status).toBe(404)
  })
})

describe('PUT /api/operations/runs/[id]/items/order', () => {
  it('should return 401 without a session', async () => {
    mockSession.mockResolvedValue(null)

    const res = await putOrder(jsonRequest('PUT', { itemIds: ['a', 'b'] }), runParams)

    expect(res.status).toBe(401)
    expect(reorderRunItems).not.toHaveBeenCalled()
  })

  it('should return 400 for an empty list of ids', async () => {
    const res = await putOrder(jsonRequest('PUT', { itemIds: [] }), runParams)

    expect(res.status).toBe(400)
    expect(reorderRunItems).not.toHaveBeenCalled()
  })

  it('should return 403 for an employee', async () => {
    mockSession.mockResolvedValue(session('EMPLOYEE'))

    const res = await putOrder(jsonRequest('PUT', { itemIds: ['a', 'b'] }), runParams)

    expect(res.status).toBe(403)
    expect(reorderRunItems).not.toHaveBeenCalled()
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

describe('runErrorResponse', () => {
  const EXPECTED: Record<RunServiceErrorCode, { status: number; error: string; details?: { runId: string } }> = {
    TEMPLATE_NOT_FOUND: { status: 404, error: 'Template not found' },
    EMPTY_TEMPLATE: { status: 400, error: 'Template has no items' },
    RUN_EXISTS: { status: 409, error: 'Run already exists', details: { runId: 'run-9' } },
    RUN_NOT_FOUND: { status: 404, error: 'Run not found' },
    RUN_CLOSED: { status: 409, error: 'Run is closed' },
    ITEM_NOT_FOUND: { status: 404, error: 'Item not found' },
    ORDER_MISMATCH: { status: 400, error: 'Item ids do not match the run' },
    PROCEDURE_NOT_FOUND: { status: 400, error: 'Procedure not found' },
  }
  const codes = Object.keys(EXPECTED) as RunServiceErrorCode[]

  it.each(codes)('should map %s to its status and message', async (code) => {
    const { status, error, details } = EXPECTED[code]

    const res = runErrorResponse(new RunServiceError(code, details))

    expect({ status: res.status, body: await res.json() }).toEqual({ status, body: { error, ...details } })
  })
})
