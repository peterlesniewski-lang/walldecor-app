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

// Employer cost (rates, exemptions, salon split, estimates) on a FRESH database built from the real
// migration chain. All people and amounts are synthetic test data.

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const mockSession = vi.mocked(getServerSession)

const workspace = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-employer-cost-'))
const databaseUrl = `file:${path.join(directory, 'payroll.db')}`

type Routes = {
  baseSalaries: typeof import('@/app/api/hr/payroll/base-salaries/route')
  settlements: typeof import('@/app/api/hr/payroll/settlements/route')
  settlement: typeof import('@/app/api/hr/payroll/settlements/[id]/route')
  rates: typeof import('@/app/api/hr/payroll/employer-rates/route')
  revokeRate: typeof import('@/app/api/hr/payroll/employer-rates/[id]/revoke/route')
  costSettings: typeof import('@/app/api/hr/payroll/cost-settings/route')
  splits: typeof import('@/app/api/hr/payroll/cost-splits/route')
  revokeSplit: typeof import('@/app/api/hr/payroll/cost-splits/[id]/revoke/route')
  contracts: typeof import('@/lib/payroll/contracts')
}

let prisma: PrismaClient
let routes: Routes

const JULY = { year: 2026, month: 7 }
const AUGUST = { year: 2026, month: 8 }

function as(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | null, id = 'admin-1', employeeId: string | null = null) {
  mockSession.mockResolvedValue(role ? ({ user: { id, role, employeeId } } as Session) : null)
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function post<T extends { POST: (r: NextRequest) => Promise<Response> }>(route: T, url: string, body: unknown) {
  const res = await route.POST(req(url, 'POST', body))
  return { res, json: await res.json() }
}

async function detail(id: string) {
  const res = await routes.settlement.GET(req(`/api/hr/payroll/settlements/${id}`), ctx(id))
  return res.json()
}

async function act(id: string, body: Record<string, unknown>) {
  const current = await detail(id)
  const res = await routes.settlement.PATCH(
    req(`/api/hr/payroll/settlements/${id}`, 'PATCH', { expectedRevision: current.revision, ...body }),
    ctx(id)
  )
  return { res, json: await res.json() }
}

async function createSettlement(employeeId: string, month: string) {
  const { res, json } = await post(routes.settlements, '/api/hr/payroll/settlements', { employeeId, month })
  expect(res.status, JSON.stringify(json)).toBe(201)
  return json.id as string
}

async function monthlyCosts(period: { year: number; month: number }) {
  const rows = await routes.contracts.getMonthlyEmployerCosts(prisma, period)
  return Object.fromEntries(rows.map((row) => [row.employeeId, [row.status, row.gap, row.employerCostGrosze, row.allocations]]))
}

beforeAll(async () => {
  const result = spawnSync(process.execPath, [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 120_000,
  })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  vi.resetModules()
  vi.doMock('@/lib/prisma', () => ({ prisma }))
  routes = {
    baseSalaries: await import('@/app/api/hr/payroll/base-salaries/route'),
    settlements: await import('@/app/api/hr/payroll/settlements/route'),
    settlement: await import('@/app/api/hr/payroll/settlements/[id]/route'),
    rates: await import('@/app/api/hr/payroll/employer-rates/route'),
    revokeRate: await import('@/app/api/hr/payroll/employer-rates/[id]/revoke/route'),
    costSettings: await import('@/app/api/hr/payroll/cost-settings/route'),
    splits: await import('@/app/api/hr/payroll/cost-splits/route'),
    revokeSplit: await import('@/app/api/hr/payroll/cost-splits/[id]/revoke/route'),
    contracts: await import('@/lib/payroll/contracts'),
  }

  await prisma.costCenter.createMany({ data: ['JAG', 'PUL', 'GLOBAL'].map((id) => ({ id, name: `Centrum ${id}` })) })
  const employee = (id: string, employmentType: string, costCenterId: string, endDate: Date | null = null) => ({
    id, firstName: 'Test', lastName: id, email: `${id}@example.test`, position: 'Test', costCenterId,
    startDate: new Date('2025-01-01'), endDate, employmentType,
  })
  await prisma.employee.createMany({
    data: [
      employee('emp-uop', 'UoP', 'PUL'),
      employee('emp-board', 'Zarząd', 'GLOBAL'),
      employee('emp-uz', 'UZ', 'JAG'),
      employee('emp-b2b', 'B2B', 'JAG'),
      employee('emp-left', 'UoP', 'JAG', new Date('2026-07-15')),
    ],
  })
  await prisma.user.create({ data: { id: 'admin-1', name: 'Admin Testowy', email: 'admin@example.test', role: 'ADMIN', passwordHash: 'test-only' } })

  as('ADMIN')
  for (const [employeeId, amount] of [['emp-uop', '8000'], ['emp-board', '10000'], ['emp-b2b', '5000'], ['emp-left', '6000']]) {
    const { res } = await post(routes.baseSalaries, '/api/hr/payroll/base-salaries', { employeeId, effectiveFrom: '2026-01-01', amount, basis: 'MONTHLY_GROSS' })
    expect(res.status).toBe(201)
  }
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('employer cost — estimates before payroll is approved', () => {
  it('should estimate the UoP employer cost from the base salary and allocate it to the employee salon', async () => {
    // 8 000,00 + 20,48% default UoP employer contributions = 9 638,40
    expect((await monthlyCosts(AUGUST))['emp-uop']).toEqual(['ESTIMATE', null, 963840, [{ costCenterId: 'PUL', amountGrosze: 963840 }]])
  })

  it('should report the management board in GLOBAL without a split as missing, not as zero', async () => {
    expect((await monthlyCosts(AUGUST))['emp-board']).toEqual(['MISSING', 'COST_SPLIT_MISSING', null, []])
  })

  it('should report a person without a base salary as missing', async () => {
    expect((await monthlyCosts(AUGUST))['emp-uz']).toEqual(['MISSING', 'BASE_MISSING', null, []])
  })

  it('should leave B2B out because its cost arrives as invoices', async () => {
    expect(Object.keys(await monthlyCosts(AUGUST))).not.toContain('emp-b2b')
  })

  it('should leave out a person whose employment ended before the month', async () => {
    expect(Object.keys(await monthlyCosts(AUGUST))).not.toContain('emp-left')
  })

  it('should still include a person in the month their employment ends', async () => {
    expect((await monthlyCosts(JULY))['emp-left']?.[0]).toBe('ESTIMATE')
  })
})

describe('employer cost — salon split', () => {
  it('should let ADMIN split the management board cost 50/50 from August', async () => {
    const { res } = await post(routes.splits, '/api/hr/payroll/cost-splits', { employeeId: 'emp-board', effectiveFrom: '2026-08', jagPercent: 50 })
    expect(res.status).toBe(201)
  })

  it('should estimate the management board without employer contributions and split it between salons', async () => {
    expect((await monthlyCosts(AUGUST))['emp-board']).toEqual(['ESTIMATE', null, 1000000, [
      { costCenterId: 'JAG', amountGrosze: 500000 },
      { costCenterId: 'PUL', amountGrosze: 500000 },
    ]])
  })

  it('should block approving a GLOBAL person for a month before the split applies', async () => {
    const id = await createSettlement('emp-board', '2026-07')
    await act(id, { action: 'payrollOffice.confirm', finalGross: '10000', finalNet: '8000' })
    const { res, json } = await act(id, { action: 'approve' })
    expect([res.status, json.details?.blockers?.map((b: { code: string }) => b.code)]).toEqual([409, ['COST_SPLIT_MISSING']])
  })

  it('should name the person and the reason when a month has no split', async () => {
    const { loadEmployerCostsForMonths } = await import('@/lib/finance/employer-costs')
    const july = await loadEmployerCostsForMonths(prisma, 2026, [7])
    expect(july.missing.map((row) => row.label)).toContain('Test emp-board — brak podziału JAG/PUL obowiązującego w tym miesiącu')
  })

  it('should record the split in the audit history', async () => {
    const events = await prisma.payrollAuditEvent.findMany({ where: { employeeId: 'emp-board', action: 'costSplit.create' } })
    expect(events.map((event) => JSON.parse(event.afterJson ?? '{}'))).toEqual([{ effectiveFrom: '2026-08', jagPercent: 50, pulPercent: 50 }])
  })

  it('should reject a split above 100%', async () => {
    const { res } = await post(routes.splits, '/api/hr/payroll/cost-splits', { employeeId: 'emp-board', effectiveFrom: '2026-09', jagPercent: 120 })
    expect(res.status).toBe(400)
  })
})

describe('employer cost — payroll approval', () => {
  let augustId: string

  it('should calculate the employer cost when the payroll office gives gross and net only', async () => {
    augustId = await createSettlement('emp-uop', '2026-08')
    const { json } = await act(augustId, { action: 'payrollOffice.confirm', finalGross: '8000', finalNet: '5800' })
    expect([json.employerCostGrosze, json.employerCostSource]).toEqual([963840, 'CALCULATED'])
  })

  it('should freeze the salon allocation and the rates used in the approved version', async () => {
    const { json } = await act(augustId, { action: 'approve' })
    const version = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { settlementId: augustId } })
    expect([
      json.status,
      version.employerCostSource,
      JSON.parse(version.costAllocationJson),
      JSON.parse(version.employerRatesJson ?? '{}').ratesSource,
    ]).toEqual(['APPROVED', 'CALCULATED', [{ costCenterId: 'PUL', amountGrosze: 963840 }], 'DEFAULT'])
  })

  it('should replace the estimate with the approved amount', async () => {
    expect((await monthlyCosts(AUGUST))['emp-uop']?.[0]).toBe('APPROVED')
  })

  it('should keep an explicit employer cost as an override without rates', async () => {
    const id = await createSettlement('emp-board', '2026-08')
    await act(id, { action: 'payrollOffice.confirm', finalGross: '10000', finalNet: '8000', employerCost: '10200' })
    await act(id, { action: 'approve' })
    const version = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { settlementId: id } })
    expect([version.employerCostSource, version.employerCostGrosze, version.employerRatesJson, JSON.parse(version.costAllocationJson)])
      .toEqual(['OVERRIDDEN', 1020000, null, [{ costCenterId: 'JAG', amountGrosze: 510000 }, { costCenterId: 'PUL', amountGrosze: 510000 }]])
  })
})

describe('employer cost — rates and exemptions', () => {
  let julyId: string
  let rateId: string

  it('should block approval when rates change after the payroll office confirmation', async () => {
    julyId = await createSettlement('emp-uop', '2026-07')
    await act(julyId, { action: 'payrollOffice.confirm', finalGross: '8000', finalNet: '5800' })
    const { res, json } = await post(routes.rates, '/api/hr/payroll/employer-rates', {
      settlementType: 'UOP', effectiveFrom: '2026-07', pension: '9,76', disability: '6,50', accident: '1,80', labourFund: '2,45', guaranteeFund: '0,10', ppk: '0',
    })
    rateId = json.id
    const approve = await act(julyId, { action: 'approve' })
    expect([res.status, approve.res.status, approve.json.details?.blockers?.map((b: { code: string }) => b.code)])
      .toEqual([201, 409, ['EMPLOYER_COST_STALE']])
  })

  it('should approve with the new rates after the payroll office data is confirmed again', async () => {
    // accident 1,80% instead of 1,67%: 8 000,00 × 20,61% = 1 648,80
    await act(julyId, { action: 'payrollOffice.confirm', finalGross: '8000', finalNet: '5800' })
    const { json } = await act(julyId, { action: 'approve' })
    expect([json.status, json.versions[0].employerCostGrosze]).toEqual(['APPROVED', 964880])
  })

  it('should not let rates be edited in place in the database', async () => {
    await expect(prisma.payrollEmployerRate.update({ where: { id: rateId }, data: { accidentBp: 100 } })).rejects.toThrow()
  })

  it('should revoke rates instead of deleting them and allow new ones for the same month', async () => {
    const revoke = await routes.revokeRate.POST(req(`/api/hr/payroll/employer-rates/${rateId}/revoke`, 'POST'), ctx(rateId))
    const again = await post(routes.rates, '/api/hr/payroll/employer-rates', {
      settlementType: 'UOP', effectiveFrom: '2026-07', pension: '9,76', disability: '6,50', accident: '1,67', labourFund: '2,45', guaranteeFund: '0,10', ppk: '0',
    })
    expect([revoke.status, again.res.status]).toEqual([200, 201])
  })

  it('should reject a rate above 50%', async () => {
    const { res } = await post(routes.rates, '/api/hr/payroll/employer-rates', {
      settlementType: 'UZ', effectiveFrom: '2026-07', pension: '60', disability: '0', accident: '0', labourFund: '0', guaranteeFund: '0', ppk: '0',
    })
    expect(res.status).toBe(400)
  })

  it('should estimate a UZ person exempt from contributions at the base salary', async () => {
    await post(routes.baseSalaries, '/api/hr/payroll/base-salaries', { employeeId: 'emp-uz', effectiveFrom: '2026-01-01', amount: '3000', basis: 'MONTHLY_GROSS' })
    const res = await routes.costSettings.PUT(req('/api/hr/payroll/cost-settings', 'PUT', { employeeId: 'emp-uz', withoutFunds: false, withoutContributions: true }))
    expect([res.status, (await monthlyCosts(AUGUST))['emp-uz']?.[2]]).toEqual([200, 300000])
  })
})

describe('employer cost — access', () => {
  it.each([
    ['a manager', 'MANAGER', 'manager-1', null],
    ['an employee', 'EMPLOYEE', 'user-uop', 'emp-uop'],
  ] as const)('should deny %s access to employer cost settings', async (_label, role, userId, employeeId) => {
    as(role, userId, employeeId)
    const responses = await Promise.all([
      routes.rates.GET(),
      routes.rates.POST(req('/api/hr/payroll/employer-rates', 'POST', {})),
      routes.costSettings.GET(req('/api/hr/payroll/cost-settings?employeeId=emp-uop')),
      routes.costSettings.PUT(req('/api/hr/payroll/cost-settings', 'PUT', {})),
      routes.splits.POST(req('/api/hr/payroll/cost-splits', 'POST', {})),
    ])
    as('ADMIN')
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403])
  })
})
