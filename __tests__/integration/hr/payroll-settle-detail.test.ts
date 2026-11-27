// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { PrismaClient } from '@/generated/prisma'

// "Zapisz i zatwierdź" / "Zapisz korektę" of the settlement details page (stage 5) on a FRESH database
// built from the real migration chain. The page must reach the very same server path as a sheet row,
// so the audit trail is compared with the one a sheet row leaves. All data is synthetic.

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const mockSession = vi.mocked(getServerSession)

const workspace = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-payroll-settle-'))
const databaseUrl = `file:${path.join(directory, 'payroll-settle.db')}`

type Routes = {
  sheet: typeof import('@/app/api/hr/payroll/sheet/route')
  months: typeof import('@/app/api/hr/payroll/months/[month]/route')
  settlements: typeof import('@/app/api/hr/payroll/settlements/route')
  settlement: typeof import('@/app/api/hr/payroll/settlements/[id]/route')
  settle: typeof import('@/app/api/hr/payroll/settlements/[id]/settle/route')
}

let prisma: PrismaClient
let routes: Routes

async function boot() {
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  vi.resetModules()
  vi.doMock('@/lib/prisma', () => ({ prisma }))
  routes = {
    sheet: await import('@/app/api/hr/payroll/sheet/route'),
    months: await import('@/app/api/hr/payroll/months/[month]/route'),
    settlements: await import('@/app/api/hr/payroll/settlements/route'),
    settlement: await import('@/app/api/hr/payroll/settlements/[id]/route'),
    settle: await import('@/app/api/hr/payroll/settlements/[id]/settle/route'),
  }
}

function as(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | null) {
  mockSession.mockResolvedValue(role ? ({ user: { id: 'admin-1', role, employeeId: null } } as Session) : null)
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function createDraft(employeeId: string, month: string) {
  const res = await routes.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId, month }))
  expect(res.status).toBe(201)
  return (await res.json()).id as string
}

async function detail(id: string) {
  const res = await routes.settlement.GET(req(`/api/hr/payroll/settlements/${id}`), ctx(id))
  expect(res.status).toBe(200)
  return res.json()
}

async function settle(id: string, body: Record<string, unknown>) {
  const current = await detail(id)
  const res = await routes.settle.POST(req(`/api/hr/payroll/settlements/${id}/settle`, 'POST', { expectedRevision: current.revision, ...body }), ctx(id))
  return { res, json: await res.json() }
}

const auditActions = async (employeeId: string, month: number) =>
  (await prisma.payrollAuditEvent.findMany({ where: { employeeId, settlement: { year: 2026, month } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
    .map((event) => event.action)

beforeAll(async () => {
  const result = spawnSync(process.execPath, [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 120_000,
  })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  await boot()
  await prisma.costCenter.create({ data: { id: 'JAG', name: 'Salon testowy JAG' } })
  await prisma.user.create({ data: { id: 'admin-1', name: 'Admin Testowy', email: 'admin@example.test', role: 'ADMIN', passwordHash: 'test-only' } })
  for (const [id, last] of [['emp-sheet', 'Arkuszowa'], ['emp-page', 'Stronowa']] as const) {
    await prisma.employee.create({
      data: { id, firstName: 'Testowa', lastName: last, email: `${id}@example.test`, position: 'Doradca', costCenterId: 'JAG', startDate: new Date('2026-01-01'), employmentType: 'UoP' },
    })
    await prisma.payrollBaseSalary.create({ data: { employeeId: id, effectiveFrom: '2026-01-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS', createdById: 'admin-1' } })
  }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('payroll settlement details — save and approve', () => {
  it('should leave the same audit trail as a sheet row when a draft is saved and approved', async () => {
    as('ADMIN')
    const sheetRes = await routes.sheet.POST(req('/api/hr/payroll/sheet', 'POST', {
      month: '2026-03', rows: [{ employeeId: 'emp-sheet', finalGross: '5000,00', finalNet: '3600,00' }],
    }))
    expect((await sheetRes.json()).results[0].status).toBe('APPROVED')

    const id = await createDraft('emp-page', '2026-03')
    const { res, json } = await settle(id, { finalGross: '5000,00', finalNet: '3600,00' })
    expect([res.status, json.outcome, json.versionNumber]).toEqual([200, 'APPROVED', 1])
    expect(await auditActions('emp-page', 3)).toEqual(await auditActions('emp-sheet', 3))
  })

  it('should store the same figures as a sheet row would', async () => {
    const fromSheet = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'emp-sheet', year: 2026, month: 3, supersededAt: null } })
    const fromPage = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'emp-page', year: 2026, month: 3, supersededAt: null } })
    const pick = (v: typeof fromSheet) => [v.finalGrossGrosze, v.finalNetGrosze, v.employerCostGrosze, v.employerCostSource, v.origin, v.versionNumber]
    expect(pick(fromPage)).toEqual(pick(fromSheet))
  })

  it('should refuse a correction of an approved settlement without a reason and write nothing', async () => {
    const id = (await prisma.payrollSettlement.findFirstOrThrow({ where: { employeeId: 'emp-page', year: 2026, month: 3 } })).id
    const before = await prisma.payrollAuditEvent.count({ where: { settlementId: id } })
    const { res, json } = await settle(id, { finalGross: '5200,00', finalNet: '3700,00' })
    expect([res.status, json.error]).toEqual([400, 'Podaj powód korekty (min. 3 znaki).'])
    expect(await prisma.payrollAuditEvent.count({ where: { settlementId: id } })).toBe(before)
    expect((await prisma.payrollSettlementVersion.count({ where: { settlementId: id } }))).toBe(1)
  })

  it('should record the typed reason when an approved settlement is corrected', async () => {
    const id = (await prisma.payrollSettlement.findFirstOrThrow({ where: { employeeId: 'emp-page', year: 2026, month: 3 } })).id
    const { res, json } = await settle(id, { finalGross: '5200,00', finalNet: '3700,00', reason: 'Premia uznaniowa (test)' })
    expect([res.status, json.outcome, json.versionNumber]).toEqual([200, 'APPROVED', 2])
    const reopen = await prisma.payrollAuditEvent.findFirstOrThrow({ where: { settlementId: id, action: 'settlement.reopen' } })
    expect(reopen.reason).toBe('Premia uznaniowa (test)')
  })

  it('should supersede the previous version and keep exactly one effective version', async () => {
    const id = (await prisma.payrollSettlement.findFirstOrThrow({ where: { employeeId: 'emp-page', year: 2026, month: 3 } })).id
    const versions = await prisma.payrollSettlementVersion.findMany({ where: { settlementId: id }, orderBy: { versionNumber: 'asc' } })
    expect(versions.map((v) => [v.versionNumber, v.supersededAt !== null, v.finalGrossGrosze])).toEqual([[1, true, 500000], [2, false, 520000]])
  })

  it('should answer UNCHANGED and create no version for identical figures', async () => {
    const id = (await prisma.payrollSettlement.findFirstOrThrow({ where: { employeeId: 'emp-page', year: 2026, month: 3 } })).id
    const { json } = await settle(id, { finalGross: '5200,00', finalNet: '3700,00', reason: 'Bez zmian (test)' })
    expect([json.outcome, json.versionNumber]).toEqual(['UNCHANGED', 2])
    expect(await prisma.payrollSettlementVersion.count({ where: { settlementId: id } })).toBe(2)
  })

  it('should keep a draft untouched when the approval is blocked (all or nothing)', async () => {
    // Overtime waiting for a manager blocks the approval; the figures must not be confirmed either.
    await prisma.timeEntry.create({
      data: {
        id: 'te-blocking', employeeId: 'emp-sheet', date: new Date('2026-04-06T00:00:00Z'), clockIn: new Date('2026-04-06T09:00:00Z'),
        clockOut: new Date('2026-04-06T19:00:00Z'), totalMinutes: 600, breakMinutes: 0, overtimeMinutes: 120, status: 'pending', source: 'manual',
      },
    })
    const id = await createDraft('emp-sheet', '2026-04')
    const { res, json } = await settle(id, { finalGross: '5000,00', finalNet: '3600,00' })
    expect(res.status).toBe(409)
    expect(json.details.blockers.map((b: { code: string }) => b.code)).toContain('OVERTIME_PENDING_APPROVAL')
    const row = await prisma.payrollSettlement.findUniqueOrThrow({ where: { id } })
    expect([row.status, row.finalGrossGrosze, row.payrollOfficeConfirmedAt]).toEqual(['DRAFT', null, null])
  })

  it('should deny the route to MANAGER, EMPLOYEE and no session', async () => {
    const id = (await prisma.payrollSettlement.findFirstOrThrow({ where: { employeeId: 'emp-page', year: 2026, month: 3 } })).id
    const statuses: number[] = []
    for (const role of ['MANAGER', 'EMPLOYEE', null] as const) {
      as(role)
      const res = await routes.settle.POST(req(`/api/hr/payroll/settlements/${id}/settle`, 'POST', { expectedRevision: 1, finalGross: '1,00', finalNet: '1,00' }), ctx(id))
      statuses.push(res.status)
    }
    as('ADMIN')
    expect(statuses).toEqual([403, 403, 401])
  })
})

describe('payroll settlement details — page data', () => {
  it('should return the month list number and the same suggestion the sheet shows', async () => {
    as('ADMIN')
    const id = await createDraft('emp-page', '2026-05')
    await routes.months.PUT(req('/api/hr/payroll/months/2026-05', 'PUT', { listReference: 'LP 05/2026 (test)' }), { params: Promise.resolve({ month: '2026-05' }) })
    // April has no approved version for this person; March does not count (only the previous month is a source).
    const page = await detail(id)
    expect([page.listReference, page.monthKey]).toEqual(['LP 05/2026 (test)', '2026-05'])

    const sheet = await (await routes.sheet.GET(req('/api/hr/payroll/sheet?month=2026-05'))).json()
    const row = sheet.rows.find((r: { employee: { id: string } }) => r.employee.id === 'emp-page')
    expect(page.sheetRow.suggestion).toEqual(row.suggestion)
  })

  it('should suggest last month\'s figures once the previous month is approved', async () => {
    const april = await routes.sheet.POST(req('/api/hr/payroll/sheet', 'POST', {
      month: '2026-04', rows: [{ employeeId: 'emp-page', finalGross: '5100,00', finalNet: '3650,00' }],
    }))
    expect((await april.json()).results[0].status).toBe('APPROVED')
    const id = (await prisma.payrollSettlement.findFirstOrThrow({ where: { employeeId: 'emp-page', year: 2026, month: 5 } })).id
    const page = await detail(id)
    expect([page.sheetRow.suggestion.kind, page.sheetRow.suggestion.finalGrossGrosze, page.sheetRow.suggestion.finalNetGrosze, page.sheetRow.suggestion.sourceMonth])
      .toEqual(['PREVIOUS_MONTH', 510000, 365000, '2026-04'])
  })
})
