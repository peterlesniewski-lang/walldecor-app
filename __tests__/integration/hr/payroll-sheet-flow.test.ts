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
import { calculateEmployerCostGrosze, DEFAULT_EMPLOYER_RATES } from '@/lib/payroll/employer-cost'

// Month sheet ("arkusz miesiąca") on a FRESH database built from the real migration chain.
// Every person and amount is synthetic test data.

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const mockSession = vi.mocked(getServerSession)

const workspace = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-payroll-sheet-'))
const databaseUrl = `file:${path.join(directory, 'payroll-sheet.db')}`

type Routes = {
  sheet: typeof import('@/app/api/hr/payroll/sheet/route')
  months: typeof import('@/app/api/hr/payroll/months/[month]/route')
  baseSalaries: typeof import('@/app/api/hr/payroll/base-salaries/route')
  settlements: typeof import('@/app/api/hr/payroll/settlements/route')
  settlement: typeof import('@/app/api/hr/payroll/settlements/[id]/route')
  contracts: typeof import('@/lib/payroll/contracts')
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
    baseSalaries: await import('@/app/api/hr/payroll/base-salaries/route'),
    settlements: await import('@/app/api/hr/payroll/settlements/route'),
    settlement: await import('@/app/api/hr/payroll/settlements/[id]/route'),
    contracts: await import('@/lib/payroll/contracts'),
  }
}

function as(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | null, id = 'admin-1', employeeId: string | null = null) {
  mockSession.mockResolvedValue(role ? ({ user: { id, role, employeeId } } as Session) : null)
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

type SheetRow = {
  employee: { id: string }
  settlement: { id: string; status: string; revision: number } | null
  effectiveVersion: { versionNumber: number; finalGrossGrosze: number; finalNetGrosze: number; employerCostGrosze: number } | null
  suggestion: { finalGrossGrosze: number; finalNetGrosze: number; employerCostGrosze: number; employerCostSource: string; sourceMonth: string } | null
  flags: Array<{ code: string; message: string }>
  blockers: Array<{ code: string; message: string }>
  autoEligible: boolean
}
type Sheet = { month: string; listReference: string | null; approvedEmployerCostGrosze: number; previousApprovedEmployerCostGrosze: number | null; rows: SheetRow[] }
type RowResult = { employeeId: string; status: string; versionNumber?: number; message?: string; blockers?: Array<{ code: string; message: string }> }

async function sheet(month: string): Promise<Sheet> {
  const res = await routes.sheet.GET(req(`/api/hr/payroll/sheet?month=${month}`))
  expect(res.status).toBe(200)
  return res.json()
}

async function submit(month: string, rows: unknown[]): Promise<RowResult[]> {
  const res = await routes.sheet.POST(req('/api/hr/payroll/sheet', 'POST', { month, rows }))
  expect(res.status).toBe(200)
  return (await res.json()).results
}

function row(data: Sheet, employeeId: string) {
  return data.rows.find((r) => r.employee.id === employeeId)
}

const UOP_RATES = DEFAULT_EMPLOYER_RATES.UOP
const OCT = { year: 2026, month: 10 }

beforeAll(async () => {
  const result = spawnSync(process.execPath, [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    timeout: 120_000,
  })
  expect(result.status, result.stderr || result.stdout).toBe(0)
  await boot()

  await prisma.costCenter.createMany({
    data: [{ id: 'JAG', name: 'Salon testowy JAG' }, { id: 'GLOBAL', name: 'Centrala testowa' }],
  })
  const person = (id: string, lastName: string, extra: Record<string, unknown> = {}) => ({
    id,
    firstName: 'Testowa',
    lastName,
    email: `${id}@example.test`,
    position: 'Doradca (test)',
    costCenterId: 'JAG',
    startDate: new Date('2025-01-01T00:00:00Z'),
    employmentType: 'UoP',
    ...extra,
  })
  await prisma.employee.createMany({
    data: [
      person('emp-a', 'Alfa'),
      person('emp-b', 'Beta'),
      person('emp-c', 'Gamma'),
      person('emp-x', 'Wykonawca', { employmentType: 'B2B' }),
      person('emp-y', 'Wykonawczyni', { employmentType: 'B2B' }),
      person('emp-n', 'Bezumowna', { employmentType: null }),
      person('emp-nobase', 'Bezangażowa'),
      person('emp-ot', 'Nadgodzinowa'),
      person('emp-bonus', 'Premiowa'),
      person('emp-part', 'Odchodząca', { endDate: new Date('2026-10-15T00:00:00Z') }),
      person('emp-sick', 'Chorobowa'),
      person('emp-hourly', 'Godzinowa', { employmentType: 'UZ' }),
      person('emp-basechg', 'Podwyżkowa'),
      person('emp-noprev', 'Nowa', { startDate: new Date('2026-10-01T00:00:00Z') }),
      person('emp-global', 'Centralna', { costCenterId: 'GLOBAL' }),
    ],
  })
  await prisma.user.createMany({
    data: [
      { id: 'admin-1', name: 'Admin Testowy', email: 'admin@example.test', role: 'ADMIN', passwordHash: 'test-only' },
      { id: 'user-a', name: 'Testowa Alfa', email: 'user-a@example.test', role: 'EMPLOYEE', passwordHash: 'test-only', employeeId: 'emp-a' },
    ],
  })

  as('ADMIN')
  const base = (employeeId: string, amount: string, basis = 'MONTHLY_GROSS', effectiveFrom = '2025-01-01') =>
    routes.baseSalaries.POST(req('/api/hr/payroll/base-salaries', 'POST', { employeeId, effectiveFrom, amount, basis }))
  for (const id of ['emp-a', 'emp-b', 'emp-c', 'emp-n', 'emp-ot', 'emp-bonus', 'emp-part', 'emp-sick', 'emp-basechg', 'emp-noprev', 'emp-global', 'emp-y']) {
    expect((await base(id, '5000,00')).status).toBe(201)
  }
  expect((await base('emp-hourly', '50,00', 'HOURLY_GROSS')).status).toBe(201)
  expect((await base('emp-basechg', '5500,00', 'MONTHLY_GROSS', '2026-10-01')).status).toBe(201)
  await prisma.payrollCostSplit.create({ data: { employeeId: 'emp-global', effectiveFrom: '2026-09', jagPercent: 100, createdById: 'admin-1' } })

  // October: approved overtime without a payout/time-off decision.
  await prisma.timeEntry.create({
    data: {
      id: 'te-ot', employeeId: 'emp-ot', date: new Date('2026-10-07T00:00:00Z'),
      clockIn: new Date('2026-10-07T09:00:00Z'), clockOut: new Date('2026-10-07T19:00:00Z'),
      totalMinutes: 600, breakMinutes: 0, overtimeMinutes: 120, status: 'approved', source: 'bulk',
    },
  })
  // October: approved sick leave (paid in the catalog, but it changes the payroll amount).
  const sick = await prisma.leaveType.create({ data: { code: 'SL', name: 'Zwolnienie chorobowe', isPaid: true, requiresApproval: false } })
  await prisma.leaveRequestNew.create({
    data: {
      id: 'leave-sick', employeeId: 'emp-sick', leaveTypeId: sick.id, status: 'approved', days: 3,
      startDate: new Date('2026-10-12T00:00:00Z'), endDate: new Date('2026-10-14T00:00:00Z'),
    },
  })
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('payroll month sheet — previous month entered by hand', () => {
  it('should approve September rows typed in by hand, each with three history events', async () => {
    as('ADMIN')
    const results = await submit('2026-09', [
      { employeeId: 'emp-a', finalGross: '5000,00', finalNet: '3600,00' },
      { employeeId: 'emp-b', finalGross: '5200,00', finalNet: '3700,00' },
      { employeeId: 'emp-c', finalGross: '4800,00', finalNet: '3500,00' },
      { employeeId: 'emp-n', finalGross: '5000,00', finalNet: '3600,00', employerCost: '6100,00' },
      { employeeId: 'emp-part', finalGross: '5000,00', finalNet: '3600,00' },
      { employeeId: 'emp-sick', finalGross: '5000,00', finalNet: '3600,00' },
      { employeeId: 'emp-hourly', finalGross: '4000,00', finalNet: '3100,00' },
      { employeeId: 'emp-basechg', finalGross: '5000,00', finalNet: '3600,00' },
      { employeeId: 'emp-global', finalGross: '5000,00', finalNet: '3600,00' },
    ])
    const audit = await prisma.payrollAuditEvent.findMany({ where: { employeeId: 'emp-a' }, orderBy: { createdAt: 'asc' } })
    expect({
      statuses: results.map((r) => r.status),
      audit: audit.filter((e) => e.settlementId).map((e) => e.action),
    }).toEqual({
      statuses: Array(9).fill('APPROVED'),
      audit: ['settlement.create', 'payrollOffice.confirm', 'settlement.approve'],
    })
  })

  it('should approve a September settlement with a bonus through the detail page', async () => {
    const created = await routes.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId: 'emp-bonus', month: '2026-09' }))
    const id = (await created.json()).id as string
    const ctx = { params: Promise.resolve({ id }) }
    const act = async (body: Record<string, unknown>) => {
      const current = await (await routes.settlement.GET(req(`/api/hr/payroll/settlements/${id}`), ctx)).json()
      return routes.settlement.PATCH(req(`/api/hr/payroll/settlements/${id}`, 'PATCH', { expectedRevision: current.revision, ...body }), ctx)
    }
    await act({ action: 'adjustment.add', kind: 'BONUS', label: 'Premia testowa', amount: '300' })
    await act({ action: 'payrollOffice.confirm', finalGross: '5300', finalNet: '3800' })
    const res = await act({ action: 'approve' })
    expect([res.status, (await res.json()).status]).toEqual([200, 'APPROVED'])
  })
})

describe('payroll month sheet — October from September', () => {
  it('should suggest last month amounts without writing any October settlement', async () => {
    const data = await sheet('2026-10')
    const pick = (id: string) => {
      const r = row(data, id)!
      return [r.suggestion?.finalGrossGrosze, r.suggestion?.finalNetGrosze, r.suggestion?.sourceMonth, r.flags.length, r.autoEligible]
    }
    expect({
      a: pick('emp-a'),
      b: pick('emp-b'),
      c: pick('emp-c'),
      octoberSettlements: await prisma.payrollSettlement.count({ where: OCT }),
    }).toEqual({
      a: [500000, 360000, '2026-09', 0, true],
      b: [520000, 370000, '2026-09', 0, true],
      c: [480000, 350000, '2026-09', 0, true],
      octoberSettlements: 0,
    })
  })

  it('should recalculate a calculated employer cost from current rates', async () => {
    const data = await sheet('2026-10')
    expect(row(data, 'emp-a')!.suggestion).toMatchObject({
      employerCostGrosze: calculateEmployerCostGrosze(500000, UOP_RATES),
      employerCostSource: 'CALCULATED',
    })
  })

  it('should copy a manually entered employer cost as a manual amount', async () => {
    const data = await sheet('2026-10')
    expect(row(data, 'emp-n')!.suggestion).toMatchObject({ employerCostGrosze: 610000, employerCostSource: 'OVERRIDDEN' })
  })

  it('should leave out an external contractor without a settlement', async () => {
    const data = await sheet('2026-10')
    expect(row(data, 'emp-x')).toBeUndefined()
  })

  it('should show a contractor who already has a settlement in the month', async () => {
    const res = await routes.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId: 'emp-y', month: '2026-10' }))
    expect(res.status).toBe(201)
    expect(row(await sheet('2026-10'), 'emp-y')?.settlement?.status).toBe('DRAFT')
  })

  it('should keep a person without an employment type on the sheet with a warning', async () => {
    const r = row(await sheet('2026-10'), 'emp-n')!
    expect([r.flags.map((f) => f.code), r.flags[0].message, r.autoEligible])
      .toEqual([['EMPLOYMENT_TYPE_MISSING'], 'brak rodzaju umowy — uzupełnij w karcie', false])
  })

  it.each([
    ['emp-bonus', 'PREVIOUS_HAD_ADJUSTMENTS', 'poprzedni miesiąc zawierał premię'],
    ['emp-part', 'PARTIAL_MONTH', 'niepełny miesiąc — zatrudnienie do 2026-10-15'],
    ['emp-sick', 'PAY_AFFECTING_ABSENCE', 'nieobecność zmieniająca wypłatę — sprawdź kwotę'],
    ['emp-basechg', 'BASE_CHANGED', 'angaż zmienił się od września'],
    ['emp-noprev', 'NO_PREVIOUS_MONTH', 'brak zatwierdzonego września — wpisz kwoty'],
  ])('should flag %s with %s and not preselect it', async (employeeId, code, message) => {
    const r = row(await sheet('2026-10'), employeeId)!
    expect([r.flags, r.blockers, r.autoEligible]).toEqual([[{ code, message }], [], false])
  })

  // Stage 3 (D19): an hourly person without approved hours also gets "brak godzin — sprawdź kwotę".
  it('should flag emp-hourly without hours with HOURLY_BASIS and HOURLY_NO_HOURS and not preselect it', async () => {
    const r = row(await sheet('2026-10'), 'emp-hourly')!
    expect([r.flags, r.blockers, r.autoEligible]).toEqual([[
      { code: 'HOURLY_BASIS', message: 'stawka godzinowa — sprawdź kwotę' },
      { code: 'HOURLY_NO_HOURS', message: 'brak godzin — sprawdź kwotę' },
    ], [], false])
  })

  it.each([
    ['emp-nobase', 'BASE_MISSING'],
    ['emp-ot', 'OVERTIME_UNRESOLVED'],
  ])('should mark %s as blocked by %s', async (employeeId, code) => {
    const r = row(await sheet('2026-10'), employeeId)!
    expect([r.blockers.map((b) => b.code), r.autoEligible]).toEqual([[code], false])
  })

  it('should block a GLOBAL person without a JAG/PUL split in the month', async () => {
    // The split from September covers October too; revoke it to reproduce a missing split.
    await prisma.payrollCostSplit.updateMany({ where: { employeeId: 'emp-global' }, data: { revokedAt: new Date(), revokedById: 'admin-1' } })
    const r = row(await sheet('2026-10'), 'emp-global')!
    expect(r.blockers.map((b) => b.code)).toEqual(['COST_SPLIT_MISSING'])
  })

  it('should save the month payroll list number without touching any version', async () => {
    const before = await prisma.payrollSettlementVersion.count()
    const res = await routes.months.PUT(
      req('/api/hr/payroll/months/2026-10', 'PUT', { listReference: 'LP 10/2026 (test)' }),
      { params: Promise.resolve({ month: '2026-10' }) }
    )
    expect([res.status, (await sheet('2026-10')).listReference, await prisma.payrollSettlementVersion.count()])
      .toEqual([200, 'LP 10/2026 (test)', before])
  })

  it('should approve three ready rows with v1, history in order and the list number', async () => {
    const results = await submit('2026-10', [
      { employeeId: 'emp-a', finalGross: '5000,00', finalNet: '3600,00' },
      // Gross changed before approval: the server recalculates the employer cost.
      { employeeId: 'emp-b', finalGross: '5450,50', finalNet: '3700,00' },
      { employeeId: 'emp-c', finalGross: '4800,00', finalNet: '3500,00' },
    ])
    const versions = await prisma.payrollSettlementVersion.findMany({ where: { ...OCT, supersededAt: null }, orderBy: { employeeId: 'asc' } })
    const audit = await prisma.payrollAuditEvent.findMany({ where: { employeeId: 'emp-a', settlement: OCT }, orderBy: { createdAt: 'asc' } })
    expect({
      results: results.map((r) => [r.employeeId, r.status, r.versionNumber]),
      versions: versions.map((v) => [v.employeeId, v.versionNumber, v.finalGrossGrosze, v.employerCostGrosze, v.payrollOfficeReference]),
      audit: audit.map((e) => e.action),
      approved: (await sheet('2026-10')).rows.filter((r) => ['emp-a', 'emp-b', 'emp-c'].includes(r.employee.id) && r.settlement?.status === 'APPROVED').length,
    }).toEqual({
      results: [['emp-a', 'APPROVED', 1], ['emp-b', 'APPROVED', 1], ['emp-c', 'APPROVED', 1]],
      versions: [
        ['emp-a', 1, 500000, calculateEmployerCostGrosze(500000, UOP_RATES), 'LP 10/2026 (test)'],
        ['emp-b', 1, 545050, calculateEmployerCostGrosze(545050, UOP_RATES), 'LP 10/2026 (test)'],
        ['emp-c', 1, 480000, calculateEmployerCostGrosze(480000, UOP_RATES), 'LP 10/2026 (test)'],
      ],
      audit: ['settlement.create', 'payrollOffice.confirm', 'settlement.approve'],
      approved: 3,
    })
  })

  it('should record the clamped employment dates and pay-affecting absences in the version snapshot', async () => {
    const [result] = await submit('2026-10', [{ employeeId: 'emp-sick', finalGross: '4200,00', finalNet: '3100,00' }])
    const version = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'emp-sick', ...OCT } })
    expect([result.status, JSON.parse(version.snapshotJson).inputs]).toEqual([
      'APPROVED',
      { employment: { from: '2026-10-01', to: '2026-10-31' }, payAffectingAbsenceIds: ['leave-sick'] },
    ])
  })

  it.each(['emp-bonus', 'emp-part', 'emp-hourly', 'emp-basechg', 'emp-noprev'])(
    'should approve the flagged row %s once it is selected by hand',
    async (employeeId) => {
      const [result] = await submit('2026-10', [{ employeeId, finalGross: '5000,00', finalNet: '3600,00' }])
      expect([result.status, result.versionNumber]).toEqual(['APPROVED', 1])
    }
  )

  it.each([
    ['emp-nobase', 'BASE_MISSING'],
    ['emp-ot', 'OVERTIME_UNRESOLVED'],
    ['emp-global', 'COST_SPLIT_MISSING'],
  ])('should return BLOCKED for %s and leave no settlement row behind', async (employeeId, code) => {
    const [result] = await submit('2026-10', [{ employeeId, finalGross: '5000,00', finalNet: '3600,00' }])
    expect({
      status: result.status,
      codes: result.blockers?.map((b) => b.code),
      settlements: await prisma.payrollSettlement.count({ where: { employeeId, ...OCT } }),
      audit: await prisma.payrollAuditEvent.count({ where: { employeeId, settlementId: { not: null } } }),
    }).toEqual({
      status: 'BLOCKED',
      codes: [code],
      settlements: 0,
      // emp-global has its September settlement history (3 events); the others none.
      audit: employeeId === 'emp-global' ? 3 : 0,
    })
  })

  it('should reject zero and negative amounts as INVALID while approving the valid row of the same request', async () => {
    const results = await submit('2026-10', [
      { employeeId: 'emp-n', finalGross: '0', finalNet: '0', employerCost: '6100' },
      { employeeId: 'emp-n', finalGross: '-5,00', finalNet: '0', employerCost: '6100' },
      { employeeId: 'emp-n', finalGross: '5000,00', finalNet: '3600,00', employerCost: '6100,00' },
    ])
    expect(results.map((r) => [r.status, r.message ?? null])).toEqual([
      ['INVALID', 'Brutto musi być większe od zera.'],
      ['INVALID', 'Brutto: podaj kwotę w PLN (maks. 2 miejsca po przecinku).'],
      ['APPROVED', null],
    ])
  })

  it('should require a manual employer cost for a contractor that has no payroll rates', async () => {
    const results = await submit('2026-10', [{ employeeId: 'emp-y', expectedRevision: 1, finalGross: '5000,00', finalNet: '5000,00' }])
    expect([results[0].status, results[0].message]).toEqual(['INVALID', 'Ten rodzaj umowy nie ma stawek pracodawcy — podaj pełny koszt pracodawcy ręcznie.'])
  })

  it('should keep the same state after an application restart', async () => {
    const before = await sheet('2026-10')
    await prisma.$disconnect()
    await boot()
    as('ADMIN')
    const after = await sheet('2026-10')
    const pick = (data: Sheet) => data.rows.map((r) => [r.employee.id, r.settlement?.status ?? null, r.effectiveVersion?.versionNumber ?? null, r.effectiveVersion?.employerCostGrosze ?? null])
    expect([pick(after), after.approvedEmployerCostGrosze]).toEqual([pick(before), before.approvedEmployerCostGrosze])
  })
})

describe('payroll month sheet — corrections and concurrency', () => {
  it('should save a correction of an approved row as v2 with exactly one effective cost', async () => {
    const b = row(await sheet('2026-10'), 'emp-b')!
    const [result] = await submit('2026-10', [
      { employeeId: 'emp-b', finalGross: '5450,50', finalNet: '3711,11', expectedRevision: b.settlement!.revision },
    ])
    const versions = await prisma.payrollSettlementVersion.findMany({ where: { employeeId: 'emp-b', ...OCT }, orderBy: { versionNumber: 'asc' } })
    const effective = (await routes.contracts.getEffectivePayrollCosts(prisma, OCT)).filter((c) => c.employeeId === 'emp-b')
    const reopen = await prisma.payrollAuditEvent.findFirstOrThrow({ where: { employeeId: 'emp-b', action: 'settlement.reopen' } })
    expect({
      result: [result.status, result.versionNumber],
      versions: versions.map((v) => [v.versionNumber, v.finalNetGrosze, v.supersededAt !== null]),
      effective: effective.map((c) => c.versionNumber),
      reason: reopen.reason,
    }).toEqual({
      result: ['APPROVED', 2],
      versions: [[1, 370000, true], [2, 371111, false]],
      effective: [2],
      reason: 'Korekta kwot na liście miesiąca',
    })
  })

  it('should answer UNCHANGED for the same amounts and create no version or event', async () => {
    const b = row(await sheet('2026-10'), 'emp-b')!
    const [versions, events] = [await prisma.payrollSettlementVersion.count(), await prisma.payrollAuditEvent.count()]
    const [result] = await submit('2026-10', [
      { employeeId: 'emp-b', finalGross: '5450,50', finalNet: '3711,11', expectedRevision: b.settlement!.revision },
    ])
    expect([result.status, result.versionNumber, await prisma.payrollSettlementVersion.count(), await prisma.payrollAuditEvent.count()])
      .toEqual(['UNCHANGED', 2, versions, events])
  })

  it('should return CONFLICT when a second tab approves a row the first tab already approved', async () => {
    // The second tab loaded the sheet before the first approval: no settlement, so no revision.
    const [result] = await submit('2026-10', [{ employeeId: 'emp-c', finalGross: '4900,00', finalNet: '3550,00' }])
    const effective = await prisma.payrollSettlementVersion.count({ where: { employeeId: 'emp-c', ...OCT, supersededAt: null } })
    expect([result.status, effective]).toEqual(['CONFLICT', 1])
  })

  it('should return CONFLICT for a stale revision', async () => {
    const [result] = await submit('2026-10', [{ employeeId: 'emp-c', finalGross: '4900,00', finalNet: '3550,00', expectedRevision: 1 }])
    expect(result.status).toBe('CONFLICT')
  })

  it('should keep one effective version when two tabs approve the same new row at the same time', async () => {
    const body = { employeeId: 'emp-noprev-2', finalGross: '5000,00', finalNet: '3600,00' }
    await prisma.employee.create({
      data: { id: body.employeeId, firstName: 'Testowa', lastName: 'Równoległa', email: 'rownolegla@example.test', position: 'Doradca (test)', costCenterId: 'JAG', startDate: new Date('2025-01-01T00:00:00Z'), employmentType: 'UoP' },
    })
    await prisma.payrollBaseSalary.create({ data: { employeeId: body.employeeId, effectiveFrom: '2025-01-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS', createdById: 'admin-1' } })
    const [first, second] = await Promise.all([submit('2026-10', [body]), submit('2026-10', [body])])
    const statuses = [first[0].status, second[0].status].sort()
    expect({
      statuses,
      settlements: await prisma.payrollSettlement.count({ where: { employeeId: body.employeeId } }),
      effective: await prisma.payrollSettlementVersion.count({ where: { employeeId: body.employeeId, supersededAt: null } }),
    }).toEqual({ statuses: ['APPROVED', 'CONFLICT'], settlements: 1, effective: 1 })
  })

  it('should not create a version when the list number changes after approval', async () => {
    const before = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'emp-a', ...OCT } })
    const count = await prisma.payrollSettlementVersion.count()
    await routes.months.PUT(req('/api/hr/payroll/months/2026-10', 'PUT', { listReference: 'LP 10/2026 poprawiona (test)' }), { params: Promise.resolve({ month: '2026-10' }) })
    const after = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'emp-a', ...OCT, supersededAt: null } })
    expect([await prisma.payrollSettlementVersion.count(), after.id, after.payrollOfficeReference, (await sheet('2026-10')).listReference])
      .toEqual([count, before.id, 'LP 10/2026 (test)', 'LP 10/2026 poprawiona (test)'])
  })

  it('should clear the list number with an empty value', async () => {
    const res = await routes.months.PUT(req('/api/hr/payroll/months/2026-10', 'PUT', { listReference: '   ' }), { params: Promise.resolve({ month: '2026-10' }) })
    expect([res.status, (await res.json()).listReference]).toEqual([200, null])
  })
})

describe('payroll month sheet — year boundary', () => {
  it('should suggest January amounts from December of the previous year', async () => {
    const [december] = await submit('2025-12', [{ employeeId: 'emp-a', finalGross: '4700,00', finalNet: '3400,00' }])
    const january = row(await sheet('2026-01'), 'emp-a')!
    expect([december.status, january.suggestion?.sourceMonth, january.suggestion?.finalGrossGrosze])
      .toEqual(['APPROVED', '2025-12', 470000])
  })
})

describe('payroll month sheet — November from an untypical October', () => {
  it('should flag a row whose source month contained a pay-affecting absence', async () => {
    // emp-sick was on sick leave in October, so the October amount is not her usual one.
    const r = row(await sheet('2026-11'), 'emp-sick')!
    expect([r.suggestion?.sourceMonth, r.flags, r.autoEligible]).toEqual([
      '2026-10',
      [{ code: 'PREVIOUS_HAD_ABSENCE', message: 'poprzedni miesiąc zawierał nieobecność zmieniającą wypłatę — sprawdź kwotę' }],
      false,
    ])
  })

  it('should flag a row whose source month was not worked in full', async () => {
    await prisma.employee.create({
      data: { id: 'emp-midstart', firstName: 'Testowa', lastName: 'Połówkowa', email: 'polowkowa@example.test', position: 'Doradca (test)', costCenterId: 'JAG', startDate: new Date('2026-10-15T00:00:00Z'), employmentType: 'UoP' },
    })
    await prisma.payrollBaseSalary.create({ data: { employeeId: 'emp-midstart', effectiveFrom: '2026-10-15', amountGrosze: 500000, basis: 'MONTHLY_GROSS', createdById: 'admin-1' } })
    const [october] = await submit('2026-10', [{ employeeId: 'emp-midstart', finalGross: '2700,00', finalNet: '2000,00' }])
    const r = row(await sheet('2026-11'), 'emp-midstart')!
    expect([october.status, r.suggestion?.finalGrossGrosze, r.flags, r.autoEligible]).toEqual([
      'APPROVED',
      270000,
      [{ code: 'PREVIOUS_MONTH_PARTIAL', message: 'poprzedni miesiąc był niepełny (zatrudnienie od 2026-10-15) — sprawdź kwotę' }],
      false,
    ])
  })

  it('should still mark an ordinary row as ready in November', async () => {
    const r = row(await sheet('2026-11'), 'emp-a')!
    expect([r.suggestion?.sourceMonth, r.flags, r.autoEligible]).toEqual(['2026-10', [], true])
  })
})

describe('payroll month sheet — external contractors', () => {
  it('should refuse to create a settlement for an external contractor and leave no row behind', async () => {
    const [result] = await submit('2026-10', [{ employeeId: 'emp-x', finalGross: '5000,00', finalNet: '5000,00', employerCost: '5000,00' }])
    expect({
      result: [result.status, result.message],
      settlements: await prisma.payrollSettlement.count({ where: { employeeId: 'emp-x' } }),
    }).toEqual({
      result: ['INVALID', 'Wykonawca zewnętrzny nie jest rozliczany na liście płac.'],
      settlements: 0,
    })
  })
})

describe('payroll month sheet — access', () => {
  it.each([
    ['a manager', 'MANAGER', 'manager-1', null],
    ['an employee (own data included)', 'EMPLOYEE', 'user-a', 'emp-a'],
  ] as const)('should deny %s every sheet route', async (_label, role, userId, employeeId) => {
    as(role, userId, employeeId)
    const responses = await Promise.all([
      routes.sheet.GET(req('/api/hr/payroll/sheet?month=2026-10')),
      routes.sheet.POST(req('/api/hr/payroll/sheet', 'POST', { month: '2026-10', rows: [{ employeeId: 'emp-a', finalGross: '1', finalNet: '1' }] })),
      routes.months.PUT(req('/api/hr/payroll/months/2026-10', 'PUT', { listReference: 'atak' }), { params: Promise.resolve({ month: '2026-10' }) }),
    ])
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403])
  })

  it('should return 401 without a session', async () => {
    as(null)
    const responses = await Promise.all([
      routes.sheet.GET(req('/api/hr/payroll/sheet?month=2026-10')),
      routes.sheet.POST(req('/api/hr/payroll/sheet', 'POST', { month: '2026-10', rows: [] })),
      routes.months.PUT(req('/api/hr/payroll/months/2026-10', 'PUT', { listReference: null }), { params: Promise.resolve({ month: '2026-10' }) }),
    ])
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401])
  })
})
