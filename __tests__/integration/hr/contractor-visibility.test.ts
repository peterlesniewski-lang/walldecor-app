// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { PrismaClient } from '@/generated/prisma'

// External contractors (B2B cards, owner decisions D12-D14, D21) are visible only on their own tab and
// in installations / user management. This matrix runs every HR route that lists people against three
// kinds of card: staff, contractor and a card with an EMPTY employment type (which is staff).
// Fresh database built from the real migration chain; every person is synthetic.

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const pdfTables: Array<{ body: string[][] }> = []
vi.mock('jspdf-autotable', () => ({
  default: (_doc: unknown, options: { body: string[][] }) => { pdfTables.push(options) },
}))
const mockSession = vi.mocked(getServerSession)

const workspace = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-contractors-'))
const databaseUrl = `file:${path.join(directory, 'contractors.db')}`

const STAFF = { id: 'emp-staff', lastName: 'Zespolowy' }
const CONTRACTOR = { id: 'emp-contractor', lastName: 'Zewnetrzny' }
const BLANK = { id: 'emp-blank', lastName: 'Bezumowny' }
const MANAGER = { id: 'emp-manager', lastName: 'Kierowniczy' }
const OTHER_STAFF = { id: 'emp-other-staff', lastName: 'Obcodzialowy' }
const OTHER_CONTRACTOR = { id: 'emp-other-contractor', lastName: 'Obcowykonawczy' }
const ALL_PEOPLE = [STAFF, CONTRACTOR, BLANK, MANAGER, OTHER_STAFF, OTHER_CONTRACTOR]
const DAY = '2026-11-10'
const MONTH = '2026-11'

type Handler = (req: NextRequest, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>
type Module = Record<string, Handler>

let prisma: PrismaClient
const routes: Record<string, Module> = {}

async function load(name: string, importer: () => Promise<unknown>) {
  routes[name] = (await importer()) as Module
}

async function boot() {
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  vi.resetModules()
  vi.doMock('@/lib/prisma', () => ({ prisma }))
  await Promise.all([
    load('employees', () => import('@/app/api/hr/employees/route')),
    load('employee', () => import('@/app/api/hr/employees/[id]/route')),
    load('entitlement', () => import('@/app/api/hr/employees/[id]/leave-entitlement/route')),
    load('schedules', () => import('@/app/api/hr/schedules/route')),
    load('scheduleTemplate', () => import('@/app/api/hr/schedules/template/route')),
    load('scheduleCopy', () => import('@/app/api/hr/schedules/copy/route')),
    load('weekly', () => import('@/app/api/hr/time-tracking/weekly/route')),
    load('monthly', () => import('@/app/api/hr/time-tracking/monthly/route')),
    load('bulk', () => import('@/app/api/hr/time-tracking/bulk/route')),
    load('overtimeRequests', () => import('@/app/api/hr/overtime-requests/route')),
    load('leaveSummary', () => import('@/app/api/hr/leave/summary/route')),
    load('leaveCalendar', () => import('@/app/api/hr/leave/calendar/route')),
    load('leaveRequests', () => import('@/app/api/hr/leave-requests/route')),
    load('leaveRequestsExport', () => import('@/app/api/hr/leave-requests/export/route')),
    load('leaveRequestsPending', () => import('@/app/api/hr/leave-requests/pending/route')),
    load('leaveBalances', () => import('@/app/api/hr/leave-balances/route')),
    load('reportAttendance', () => import('@/app/api/hr/reports/attendance/route')),
    load('reportOvertime', () => import('@/app/api/hr/reports/overtime/route')),
    load('reportPlanVsActual', () => import('@/app/api/hr/reports/plan-vs-actual/route')),
    load('reportProjects', () => import('@/app/api/hr/reports/projects/route')),
    load('reportExport', () => import('@/app/api/hr/reports/export/route')),
    load('reportPdf', () => import('@/app/api/hr/reports/monthly-pdf/route')),
    load('divisions', () => import('@/app/api/hr/divisions/route')),
    load('departments', () => import('@/app/api/hr/departments/route')),
    load('positions', () => import('@/app/api/hr/positions/route')),
    load('divisionItem', () => import('@/app/api/hr/divisions/[id]/route')),
    load('users', () => import('@/app/api/users/route')),
  ])
}

type Who = 'ADMIN' | 'MANAGER'
function as(who: Who | null) {
  mockSession.mockResolvedValue(
    who === 'ADMIN'
      ? ({ user: { id: 'admin-1', role: 'ADMIN', employeeId: null } } as Session)
      : who === 'MANAGER'
        ? ({ user: { id: 'manager-user', role: 'MANAGER', employeeId: MANAGER.id } } as Session)
        : null
  )
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function call(name: string, url: string, method = 'GET', body?: unknown, params?: { id: string }) {
  const handler = routes[name]?.[method]
  if (!handler) throw new Error(`No ${method} handler for ${name}`)
  return handler(req(url, method, body), params ? { params: Promise.resolve(params) } : undefined)
}

const idsOf = (rows: Array<{ id: string }>) => rows.map((row) => row.id)

/** Every list below returns the ids of the people it shows. */
type Place = { name: string; roles: Who[]; read: (who: Who) => Promise<string[]> }

async function json<T>(name: string, url: string): Promise<T> {
  const res = await call(name, url)
  expect(res.status, `${name} ${url}`).toBe(200)
  return res.json() as Promise<T>
}

const PLACES: Place[] = [
  {
    name: 'GET /api/hr/employees?kind=staff',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<{ employees: Array<{ id: string }> }>('employees', '/api/hr/employees?kind=staff&limit=100')).employees),
  },
  {
    name: 'GET /api/hr/schedules',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<{ employees: Array<{ id: string }> }>('schedules', `/api/hr/schedules?month=${MONTH}`)).employees),
  },
  {
    name: 'GET /api/hr/time-tracking/weekly',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<{ employees: Array<{ id: string }> }>('weekly', '/api/hr/time-tracking/weekly?week=2026-W46')).employees),
  },
  {
    name: 'GET /api/hr/time-tracking/monthly',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<{ employees: Array<{ id: string }> }>('monthly', `/api/hr/time-tracking/monthly?month=${MONTH}`)).employees),
  },
  {
    name: 'GET /api/hr/overtime-requests',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => (await json<Array<{ employeeId: string }>>('overtimeRequests', '/api/hr/overtime-requests')).map((row) => row.employeeId),
  },
  {
    name: 'GET /api/hr/leave/calendar',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<{ employees: Array<{ id: string }> }>('leaveCalendar', `/api/hr/leave/calendar?month=${MONTH}`)).employees),
  },
  {
    name: 'GET /api/hr/leave-requests',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => (await json<Array<{ employeeId: string }>>('leaveRequests', '/api/hr/leave-requests')).map((row) => row.employeeId),
  },
  {
    name: 'GET /api/hr/leave-requests/pending',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<Array<{ employee: { id: string } }>>('leaveRequestsPending', '/api/hr/leave-requests/pending')).map((row) => row.employee)),
  },
  {
    name: 'GET /api/hr/leave-balances',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => (await json<Array<{ employeeId: string }>>('leaveBalances', '/api/hr/leave-balances?year=2026')).map((row) => row.employeeId),
  },
  {
    name: 'GET /api/hr/reports/attendance',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<{ employees: Array<{ id: string }> }>('reportAttendance', `/api/hr/reports/attendance?month=${MONTH}`)).employees),
  },
  {
    name: 'GET /api/hr/reports/overtime',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<Array<{ employee: { id: string } }>>('reportOvertime', `/api/hr/reports/overtime?month=${MONTH}`)).map((row) => row.employee)),
  },
  {
    name: 'GET /api/hr/reports/plan-vs-actual',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<Array<{ employee: { id: string } }>>('reportPlanVsActual', `/api/hr/reports/plan-vs-actual?month=${MONTH}`)).map((row) => row.employee)),
  },
  {
    name: 'GET /api/hr/reports/projects',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => idsOf((await json<Array<{ employees: Array<{ id: string }> }>>('reportProjects', `/api/hr/reports/projects?month=${MONTH}`)).flatMap((row) => row.employees)),
  },
]

/** CSV exports: the people show up by last name. */
const CSV_PLACES: Array<{ name: string; roles: Who[]; read: (who: Who) => Promise<string> }> = [
  { name: 'GET /api/hr/leave-requests/export', roles: ['ADMIN', 'MANAGER'], read: async () => (await call('leaveRequestsExport', `/api/hr/leave-requests/export?month=${MONTH}`)).text() },
  { name: 'GET /api/hr/reports/export?type=attendance', roles: ['ADMIN', 'MANAGER'], read: async () => (await call('reportExport', `/api/hr/reports/export?type=attendance&month=${MONTH}`)).text() },
  { name: 'GET /api/hr/reports/export?type=overtime', roles: ['ADMIN', 'MANAGER'], read: async () => (await call('reportExport', `/api/hr/reports/export?type=overtime&month=${MONTH}`)).text() },
  { name: 'GET /api/hr/reports/export?type=projects', roles: ['ADMIN', 'MANAGER'], read: async () => (await call('reportExport', `/api/hr/reports/export?type=projects&month=${MONTH}`)).text() },
  { name: 'GET /api/hr/reports/export?type=plan-vs-actual', roles: ['ADMIN', 'MANAGER'], read: async () => (await call('reportExport', `/api/hr/reports/export?type=plan-vs-actual&month=${MONTH}`)).text() },
  {
    name: 'GET /api/hr/reports/monthly-pdf (all)',
    roles: ['ADMIN', 'MANAGER'],
    read: async () => {
      pdfTables.length = 0
      const res = await call('reportPdf', `/api/hr/reports/monthly-pdf?month=${MONTH}`)
      expect(res.status).toBe(200)
      return pdfTables.flatMap((table) => table.body.map((row) => row[0])).join('\n')
    },
  },
]

beforeAll(async () => {
  const result = spawnSync(process.execPath, [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 120_000,
  })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  await boot()

  await prisma.costCenter.createMany({ data: [{ id: 'JAG', name: 'Salon testowy JAG' }] })
  await prisma.division.createMany({
    data: [{ id: 'div-1', name: 'Oddzial testowy A', costCenterId: 'JAG' }, { id: 'div-2', name: 'Oddzial testowy B', costCenterId: 'JAG' }],
  })
  await prisma.department.create({ data: { id: 'dep-1', name: 'Dzial testowy', divisionId: 'div-1' } })
  await prisma.position.create({ data: { id: 'pos-1', name: 'Stanowisko testowe' } })

  const person = (p: { id: string; lastName: string }, extra: Record<string, unknown> = {}) => ({
    id: p.id,
    firstName: 'Testowy',
    lastName: p.lastName,
    email: `${p.id}@example.test`,
    position: 'Doradca (test)',
    costCenterId: 'JAG',
    startDate: new Date('2025-01-01T00:00:00Z'),
    employmentType: 'UoP' as string | null,
    divisionId: 'div-1',
    departmentId: 'dep-1',
    positionId: 'pos-1',
    ...extra,
  })
  await prisma.employee.createMany({
    data: [
      person(STAFF),
      person(CONTRACTOR, { employmentType: 'B2B' }),
      person(BLANK, { employmentType: null }),
      person(MANAGER),
      person(OTHER_STAFF, { divisionId: 'div-2', departmentId: null }),
      person(OTHER_CONTRACTOR, { employmentType: 'B2B', divisionId: 'div-2', departmentId: null }),
    ],
  })
  await prisma.user.createMany({
    data: [
      { id: 'admin-1', name: 'Admin Testowy', email: 'admin@example.test', role: 'ADMIN', passwordHash: 'test-only' },
      { id: 'manager-user', name: 'Kierownik Testowy', email: 'manager@example.test', role: 'MANAGER', passwordHash: 'test-only', employeeId: MANAGER.id },
    ],
  })

  const vl = await prisma.leaveType.create({ data: { id: 'lt-vl', name: 'Urlop wypoczynkowy', code: 'VL' } })
  await prisma.project.create({ data: { id: 'proj-1', name: 'Projekt testowy', code: 'PRJ-1' } })

  const noon = (day: string) => new Date(`${day}T12:00:00Z`)
  for (const p of ALL_PEOPLE) {
    await prisma.timeEntry.create({
      data: {
        employeeId: p.id,
        date: noon(DAY),
        clockIn: new Date(`${DAY}T09:00:00Z`),
        clockOut: new Date(`${DAY}T17:00:00Z`),
        totalMinutes: 480,
        breakMinutes: 30,
        projectId: 'proj-1',
        status: 'approved',
      },
    })
    await prisma.workSchedule.create({ data: { employeeId: p.id, date: noon(DAY), startTime: '09:00', endTime: '17:00' } })
    await prisma.overtimeRequest.create({ data: { employeeId: p.id, date: noon(DAY), minutes: 60, reason: 'Test', status: 'pending' } })
    await prisma.leaveRequestNew.create({
      data: { employeeId: p.id, leaveTypeId: vl.id, startDate: noon(DAY), endDate: noon(DAY), days: 1, status: 'approved' },
    })
    await prisma.leaveRequestNew.create({
      data: { employeeId: p.id, leaveTypeId: vl.id, startDate: noon('2026-11-20'), endDate: noon('2026-11-20'), days: 1, status: 'pending' },
    })
    await prisma.leaveBalanceNew.create({ data: { employeeId: p.id, leaveTypeId: vl.id, year: 2026, totalDays: 26 } })
    await prisma.leaveBalanceNew.create({ data: { employeeId: p.id, leaveTypeId: vl.id, year: 2025, totalDays: 26 } })
    await prisma.leaveEntitlementConfig.create({
      data: { employeeId: p.id, mode: 'DAYS_26', employmentFraction: 1, effectiveFrom: new Date('2025-01-01T00:00:00Z'), createdById: 'admin-1' },
    })
  }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
})

describe('visibility matrix: place x kind of card', () => {
  for (const place of PLACES) {
    for (const who of place.roles) {
      describe(`${place.name} as ${who}`, () => {
        it('should show a staff card', async () => {
          as(who)
          expect(await place.read(who)).toContain(STAFF.id)
        })

        it('should show a card with an empty employment type', async () => {
          as(who)
          expect(await place.read(who)).toContain(BLANK.id)
        })

        it('should not show an external contractor', async () => {
          as(who)
          const ids = await place.read(who)
          expect(ids).not.toContain(CONTRACTOR.id)
          expect(ids).not.toContain(OTHER_CONTRACTOR.id)
        })
      })
    }
  }

  for (const place of CSV_PLACES) {
    for (const who of place.roles) {
      describe(`${place.name} as ${who}`, () => {
        it('should list a staff card and a card with an empty employment type', async () => {
          as(who)
          const text = await place.read(who)
          expect(text).toContain(STAFF.lastName)
          expect(text).toContain(BLANK.lastName)
        })

        it('should not list an external contractor', async () => {
          as(who)
          const text = await place.read(who)
          expect(text).not.toContain(CONTRACTOR.lastName)
          expect(text).not.toContain(OTHER_CONTRACTOR.lastName)
        })
      })
    }
  }

  it('should keep an old contractor row in the database while no list shows it', async () => {
    expect(await prisma.timeEntry.count({ where: { employeeId: CONTRACTOR.id } })).toBe(1)
    expect(await prisma.leaveRequestNew.count({ where: { employeeId: CONTRACTOR.id } })).toBe(2)
    expect(await prisma.leaveBalanceNew.count({ where: { employeeId: CONTRACTOR.id } })).toBe(2)
  })
})

describe('leave summary counts', () => {
  it('should count only staff as present or absent', async () => {
    as('ADMIN')
    const summary = await json<{ total: number; absent: number; plannedNext: number }>('leaveSummary', `/api/hr/leave/summary?date=${DAY}`)
    // staff, blank, manager, other staff = 4 active staff cards; the two contractors are not counted.
    expect(summary.total).toBe(4)
    expect(summary.absent).toBe(4)
  })
})

describe('single-employee views addressed by id', () => {
  it('should return no schedule rows for a contractor id', async () => {
    as('ADMIN')
    const body = await json<{ employees: Array<{ id: string }> }>('schedules', `/api/hr/schedules?month=${MONTH}&employeeId=${CONTRACTOR.id}`)
    expect(body.employees).toEqual([])
  })

  it('should return no time-tracking rows for a contractor id', async () => {
    as('ADMIN')
    const body = await json<{ employees: Array<{ id: string }> }>('monthly', `/api/hr/time-tracking/monthly?month=${MONTH}&employeeId=${CONTRACTOR.id}`)
    expect(body.employees).toEqual([])
  })

  it('should answer 404 for a monthly PDF of a contractor id', async () => {
    as('ADMIN')
    const res = await call('reportPdf', `/api/hr/reports/monthly-pdf?month=${MONTH}&employeeId=${CONTRACTOR.id}`)
    expect(res.status).toBe(404)
  })

  it('should return no balances for a contractor id', async () => {
    as('ADMIN')
    const rows = await json<unknown[]>('leaveBalances', `/api/hr/leave-balances?year=2026&employeeId=${CONTRACTOR.id}`)
    expect(rows).toEqual([])
  })
})

describe('schedule writes refuse contractors', () => {
  const template = {
    startDate: '2026-12-01',
    endDate: '2026-12-02',
    skipHolidays: false,
    template: { tue: { startTime: '09:00', endTime: '17:00', breakMinutes: 30 }, wed: { startTime: '09:00', endTime: '17:00', breakMinutes: 30 } },
  }

  it('should apply a template to staff', async () => {
    as('ADMIN')
    const res = await call('scheduleTemplate', '/api/hr/schedules/template', 'POST', { ...template, employeeIds: [STAFF.id, BLANK.id] })
    expect(res.status).toBe(200)
  })

  it('should refuse a template that includes a contractor (ADMIN)', async () => {
    as('ADMIN')
    const res = await call('scheduleTemplate', '/api/hr/schedules/template', 'POST', { ...template, employeeIds: [STAFF.id, CONTRACTOR.id] })
    expect(res.status).toBe(400)
  })

  it('should refuse a template that includes a contractor (MANAGER)', async () => {
    as('MANAGER')
    const res = await call('scheduleTemplate', '/api/hr/schedules/template', 'POST', { ...template, employeeIds: [STAFF.id, CONTRACTOR.id] })
    expect(res.status).toBe(403)
  })

  it('should not create schedule rows for a refused template', async () => {
    expect(await prisma.workSchedule.count({ where: { employeeId: CONTRACTOR.id } })).toBe(1)
  })

  it('should copy a schedule between staff cards', async () => {
    as('ADMIN')
    const res = await call('scheduleCopy', '/api/hr/schedules/copy', 'POST', {
      fromEmployeeId: STAFF.id, toEmployeeIds: [BLANK.id], fromMonth: MONTH, toMonth: '2026-12',
    })
    expect(res.status).toBe(200)
  })

  it('should refuse copying to a contractor', async () => {
    as('ADMIN')
    const res = await call('scheduleCopy', '/api/hr/schedules/copy', 'POST', {
      fromEmployeeId: STAFF.id, toEmployeeIds: [CONTRACTOR.id], fromMonth: MONTH, toMonth: '2026-12',
    })
    expect(res.status).toBe(400)
  })

  it('should refuse copying from a contractor', async () => {
    as('ADMIN')
    const res = await call('scheduleCopy', '/api/hr/schedules/copy', 'POST', {
      fromEmployeeId: CONTRACTOR.id, toEmployeeIds: [STAFF.id], fromMonth: MONTH, toMonth: '2026-12',
    })
    expect(res.status).toBe(400)
  })

  it('should refuse bulk time entries for a contractor', async () => {
    as('ADMIN')
    const res = await call('bulk', '/api/hr/time-tracking/bulk', 'POST', {
      employeeIds: [CONTRACTOR.id],
      startDate: '2026-12-03',
      endDate: '2026-12-03',
      clockInUtc: '2026-12-03T08:00:00.000Z',
      clockOutUtc: '2026-12-03T16:00:00.000Z',
      skipWeekends: false,
    })
    expect(res.status).toBe(404)
    expect(await prisma.timeEntry.count({ where: { employeeId: CONTRACTOR.id } })).toBe(1)
  })

  it('should accept bulk time entries for a card with an empty employment type', async () => {
    as('ADMIN')
    const res = await call('bulk', '/api/hr/time-tracking/bulk', 'POST', {
      employeeIds: [BLANK.id],
      startDate: '2026-12-03',
      endDate: '2026-12-03',
      clockInUtc: '2026-12-03T08:00:00.000Z',
      clockOutUtc: '2026-12-03T16:00:00.000Z',
      skipWeekends: false,
    })
    expect(res.status).toBe(201)
  })
})

describe('organisation structure counts', () => {
  it('should count only staff cards in a division', async () => {
    as('ADMIN')
    const divisions = await json<Array<{ id: string; _count: { employees: number } }>>('divisions', '/api/hr/divisions')
    // div-1: staff, blank, manager (contractor excluded); div-2: other staff (other contractor excluded)
    expect(divisions.find((division) => division.id === 'div-1')?._count.employees).toBe(3)
    expect(divisions.find((division) => division.id === 'div-2')?._count.employees).toBe(1)
  })

  it('should not list a contractor under a department', async () => {
    as('ADMIN')
    const divisions = await json<Array<{ departments: Array<{ id: string; employees: Array<{ id: string }>; _count: { employees: number } }> }>>('divisions', '/api/hr/divisions')
    const department = divisions.flatMap((division) => division.departments).find((item) => item.id === 'dep-1')
    expect(idsOf(department?.employees ?? [])).not.toContain(CONTRACTOR.id)
    expect(department?._count.employees).toBe(3)
  })

  it('should count only staff cards per department and position', async () => {
    as('ADMIN')
    const departments = await json<Array<{ id: string; _count: { employees: number } }>>('departments', '/api/hr/departments')
    const positions = await json<Array<{ id: string; _count: { employees: number } }>>('positions', '/api/hr/positions')
    expect(departments.find((department) => department.id === 'dep-1')?._count.employees).toBe(3)
    expect(positions.find((position) => position.id === 'pos-1')?._count.employees).toBe(4)
  })

  it('should still block deleting a division that only a contractor belongs to', async () => {
    await prisma.division.create({ data: { id: 'div-only-contractor', name: 'Oddzial wykonawcy' } })
    await prisma.employee.update({ where: { id: OTHER_CONTRACTOR.id }, data: { divisionId: 'div-only-contractor' } })
    as('ADMIN')
    const res = await call('divisionItem', '/api/hr/divisions/div-only-contractor', 'DELETE', undefined, { id: 'div-only-contractor' })
    expect(res.status).toBe(409)
    await prisma.employee.update({ where: { id: OTHER_CONTRACTOR.id }, data: { divisionId: 'div-2' } })
  })
})

describe('GET /api/hr/employees kind parameter', () => {
  async function ids(url: string, who: Who = 'ADMIN') {
    as(who)
    const body = await json<{ employees: Array<{ id: string }>; total: number }>('employees', url)
    return { ids: idsOf(body.employees), total: body.total }
  }

  it('should return staff and cards with an empty employment type for kind=staff', async () => {
    const { ids: list, total } = await ids('/api/hr/employees?kind=staff&limit=100')
    expect(list).toEqual(expect.arrayContaining([STAFF.id, BLANK.id, MANAGER.id, OTHER_STAFF.id]))
    expect(list).not.toContain(CONTRACTOR.id)
    expect(total).toBe(4)
  })

  it('should return only B2B cards for kind=contractors', async () => {
    const { ids: list, total } = await ids('/api/hr/employees?kind=contractors&limit=100')
    expect(list.sort()).toEqual([CONTRACTOR.id, OTHER_CONTRACTOR.id].sort())
    expect(total).toBe(2)
  })

  it('should return everybody for kind=all', async () => {
    expect((await ids('/api/hr/employees?kind=all&limit=100')).total).toBe(ALL_PEOPLE.length)
  })

  it('should return everybody when kind is missing so older callers do not change', async () => {
    expect((await ids('/api/hr/employees?limit=100')).total).toBe(ALL_PEOPLE.length)
  })

  it('should offer contractors to the pickers of user management and installations', async () => {
    const { ids: list } = await ids('/api/hr/employees?status=active&limit=100&kind=all')
    expect(list).toContain(CONTRACTOR.id)
  })

  it('should reject an unknown kind', async () => {
    as('ADMIN')
    const res = await call('employees', '/api/hr/employees?kind=everyone')
    expect(res.status).toBe(400)
  })

  it('should combine kind=staff with a text search', async () => {
    const { ids: list } = await ids('/api/hr/employees?kind=staff&search=Testowy&limit=100')
    expect(list).toContain(BLANK.id)
    expect(list).not.toContain(CONTRACTOR.id)
  })

  it('should combine kind=contractors with a text search', async () => {
    const { ids: list } = await ids(`/api/hr/employees?kind=contractors&search=${CONTRACTOR.lastName}`)
    expect(list).toEqual([CONTRACTOR.id])
  })

  it('should show a MANAGER only the contractors of their own division', async () => {
    const { ids: list } = await ids('/api/hr/employees?kind=contractors&limit=100', 'MANAGER')
    expect(list).toEqual([CONTRACTOR.id])
  })

  it('should show a MANAGER only the staff of their own division', async () => {
    const { ids: list } = await ids('/api/hr/employees?kind=staff&limit=100', 'MANAGER')
    expect(list.sort()).toEqual([STAFF.id, BLANK.id, MANAGER.id].sort())
  })
})

describe('contractor lifecycle and leave balances (D21)', () => {
  async function create(extra: Record<string, unknown>) {
    as('ADMIN')
    const res = await call('employees', '/api/hr/employees', 'POST', {
      firstName: 'Nowy', lastName: 'Karta', email: `nowa-${Math.random().toString(36).slice(2)}@example.test`,
      startDate: '2026-11-01', costCenterId: 'JAG', position: 'Montażysta (test)', ...extra,
    })
    expect(res.status).toBe(201)
    return (await res.json()) as { id: string }
  }

  it('should not create any leave balance when a contractor is created', async () => {
    const created = await create({ employmentType: 'B2B' })
    expect(await prisma.leaveBalanceNew.count({ where: { employeeId: created.id } })).toBe(0)
    expect(await prisma.leaveEntitlementConfig.count({ where: { employeeId: created.id } })).toBe(0)
  })

  it('should list a new contractor on the contractors list only', async () => {
    const created = await create({ employmentType: 'B2B' })
    as('ADMIN')
    const staff = await json<{ employees: Array<{ id: string }> }>('employees', '/api/hr/employees?kind=staff&limit=100')
    const contractors = await json<{ employees: Array<{ id: string }> }>('employees', '/api/hr/employees?kind=contractors&limit=100')
    expect(idsOf(staff.employees)).not.toContain(created.id)
    expect(idsOf(contractors.employees)).toContain(created.id)
  })

  it('should move a card to staff lists when B2B changes to UoP, creating no balance by itself', async () => {
    const created = await create({ employmentType: 'B2B' })
    as('ADMIN')
    const patch = await call('employee', `/api/hr/employees/${created.id}`, 'PATCH', { employmentType: 'UoP' }, { id: created.id })
    expect(patch.status).toBe(200)
    const staff = await json<{ employees: Array<{ id: string }> }>('employees', '/api/hr/employees?kind=staff&limit=100')
    const schedules = await json<{ employees: Array<{ id: string }> }>('schedules', `/api/hr/schedules?month=${MONTH}`)
    expect(idsOf(staff.employees)).toContain(created.id)
    expect(idsOf(schedules.employees)).toContain(created.id)
    expect(await prisma.leaveBalanceNew.count({ where: { employeeId: created.id } })).toBe(0)
  })

  it('should remove a card from staff lists when UoP changes to B2B, keeping its balances in the database', async () => {
    const created = await create({ employmentType: 'UoP' })
    await prisma.leaveBalanceNew.create({ data: { employeeId: created.id, leaveTypeId: 'lt-vl', year: 2026, totalDays: 20 } })
    as('ADMIN')
    const patch = await call('employee', `/api/hr/employees/${created.id}`, 'PATCH', { employmentType: 'B2B' }, { id: created.id })
    expect(patch.status).toBe(200)
    const balances = await json<Array<{ employeeId: string }>>('leaveBalances', '/api/hr/leave-balances?year=2026')
    expect(balances.map((row) => row.employeeId)).not.toContain(created.id)
    expect(await prisma.leaveBalanceNew.count({ where: { employeeId: created.id } })).toBe(1)
  })

  it('should deactivate a contractor like any other card', async () => {
    const created = await create({ employmentType: 'B2B' })
    as('ADMIN')
    const patch = await call('employee', `/api/hr/employees/${created.id}`, 'PATCH', { active: false }, { id: created.id })
    expect(patch.status).toBe(200)
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: created.id } })).active).toBe(false)
  })

  it('should refuse to set a leave entitlement on a contractor', async () => {
    as('ADMIN')
    const res = await call('entitlement', `/api/hr/employees/${CONTRACTOR.id}/leave-entitlement`, 'POST', {
      mode: 'DAYS_26', employmentFraction: 1, effectiveFrom: '2026-01-01', year: 2026, preview: true,
    }, { id: CONTRACTOR.id })
    expect(res.status).toBe(409)
  })

  it('should not carry balances over to a new year for a contractor, but should for staff', async () => {
    const { executeLeaveCarryoverBatch } = await import('@/lib/hr/leave-carryover')
    await prisma.$transaction((tx) => executeLeaveCarryoverBatch(tx, {
      fromYear: 2025, toYear: 2027, reason: 'Test przeniesienia', actorId: 'admin-1',
    }))
    expect(await prisma.leaveBalanceNew.count({ where: { employeeId: STAFF.id, year: 2027 } })).toBe(1)
    expect(await prisma.leaveBalanceNew.count({ where: { employeeId: BLANK.id, year: 2027 } })).toBe(1)
    expect(await prisma.leaveBalanceNew.count({ where: { employeeId: CONTRACTOR.id, year: 2027 } })).toBe(0)
    expect(await prisma.leaveBalanceNew.count({ where: { employeeId: CONTRACTOR.id, year: 2025 } })).toBe(1)
  })
})

describe('contractors stay available to installations and user management', () => {
  it('should let ADMIN create an installer account linked to a contractor card', async () => {
    as('ADMIN')
    const res = await call('users', '/api/users', 'POST', {
      username: 'wykonawcatestowy', email: 'wykonawca-konto@example.test', name: 'Wykonawca Testowy', role: 'INSTALLER', employeeId: CONTRACTOR.id,
    })
    expect(res.status).toBe(201)
  })

  it('should keep the contractor active and selectable for installations', async () => {
    const contractor = await prisma.employee.findFirstOrThrow({ where: { id: CONTRACTOR.id, active: true } })
    expect(contractor.employmentType).toBe('B2B')
  })
})
