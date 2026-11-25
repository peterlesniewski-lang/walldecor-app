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
import { calculateEmployerCostGrosze, type EmployerRates } from '@/lib/payroll/employer-cost'

// Payroll automat (stage 2) on a FRESH database built from the real migration chain: the run on the
// 1st (here: caught up on the 5th), the D8 rules, notifications, "change after approval" and the
// switch. Every person and amount is synthetic test data.

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const mockSession = vi.mocked(getServerSession)

const workspace = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-payroll-auto-'))
const databaseUrl = `file:${path.join(directory, 'payroll-auto.db')}`

type Modules = {
  sheet: typeof import('@/app/api/hr/payroll/sheet/route')
  baseSalaries: typeof import('@/app/api/hr/payroll/base-salaries/route')
  settlements: typeof import('@/app/api/hr/payroll/settlements/route')
  settlement: typeof import('@/app/api/hr/payroll/settlements/[id]/route')
  acknowledge: typeof import('@/app/api/hr/payroll/settlements/[id]/acknowledge-changes/route')
  automation: typeof import('@/app/api/hr/payroll/automation/route')
  leaveApproval: typeof import('@/app/api/hr/leave-requests/[id]/approve/handler')
  scheduler: typeof import('@/lib/payroll/auto-carryover-scheduler')
  carryover: typeof import('@/lib/payroll/auto-carryover')
  contracts: typeof import('@/lib/payroll/contracts')
  costSettings: typeof import('@/lib/payroll/cost-settings')
}

let prisma: PrismaClient
let m: Modules

const SYSTEM = 'system:payroll-auto'
const NOV = { year: 2026, month: 11 }
const OCT = { year: 2026, month: 10 }
// Warsaw is UTC+1 in October (after 25.10) and November.
const at = (iso: string) => new Date(iso)
const OCT_20 = at('2026-10-20T10:00:00Z')
const NOV_05 = at('2026-11-05T08:00:00Z') // 09:00 in Warsaw: the server came back on the 5th
// November rates differ from the defaults, so a recalculated cost differs from October's.
const NOV_RATES: EmployerRates = { pensionBp: 976, disabilityBp: 650, accidentBp: 120, labourFundBp: 245, guaranteeFundBp: 10, ppkBp: 0 }

function as(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | null, id = 'admin-1', employeeId: string | null = null) {
  mockSession.mockResolvedValue(role ? ({ user: { id, role, employeeId } } as Session) : null)
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

type Row = {
  employee: { id: string }
  settlement: { id: string; status: string; revision: number } | null
  effectiveVersion: { versionNumber: number; origin: string } | null
  blockers: Array<{ code: string; message: string }>
  changeAfterApproval: { changes: Array<{ code: string; message: string }>; signature: string } | null
}

async function sheetRow(month: string, employeeId: string): Promise<Row> {
  as('ADMIN')
  const res = await m.sheet.GET(req(`/api/hr/payroll/sheet?month=${month}`))
  expect(res.status).toBe(200)
  const data = await res.json() as { rows: Row[] }
  const found = data.rows.find((row) => row.employee.id === employeeId)
  if (!found) throw new Error(`no sheet row for ${employeeId}`)
  return found
}

async function submit(month: string, rows: unknown[]) {
  as('ADMIN')
  const res = await m.sheet.POST(req('/api/hr/payroll/sheet', 'POST', { month, rows }))
  expect(res.status).toBe(200)
  return (await res.json()).results as Array<{ employeeId: string; status: string; message?: string }>
}

async function acknowledge(settlementId: string, signature: string) {
  return m.acknowledge.POST(
    req(`/api/hr/payroll/settlements/${settlementId}/acknowledge-changes`, 'POST', { signature }),
    { params: Promise.resolve({ id: settlementId }) }
  )
}

async function counts() {
  const [versions, events, settlements] = await Promise.all([
    prisma.payrollSettlementVersion.count(),
    prisma.payrollAuditEvent.count(),
    prisma.payrollSettlement.count(),
  ])
  return { versions, events, settlements }
}

const notificationsOf = (userId: string, type: string) =>
  prisma.notification.findMany({ where: { userId, type }, orderBy: { createdAt: 'asc' } })

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
  m = {
    sheet: await import('@/app/api/hr/payroll/sheet/route'),
    baseSalaries: await import('@/app/api/hr/payroll/base-salaries/route'),
    settlements: await import('@/app/api/hr/payroll/settlements/route'),
    settlement: await import('@/app/api/hr/payroll/settlements/[id]/route'),
    acknowledge: await import('@/app/api/hr/payroll/settlements/[id]/acknowledge-changes/route'),
    automation: await import('@/app/api/hr/payroll/automation/route'),
    leaveApproval: await import('@/app/api/hr/leave-requests/[id]/approve/handler'),
    scheduler: await import('@/lib/payroll/auto-carryover-scheduler'),
    carryover: await import('@/lib/payroll/auto-carryover'),
    contracts: await import('@/lib/payroll/contracts'),
    costSettings: await import('@/lib/payroll/cost-settings'),
  }

  await prisma.costCenter.createMany({
    data: [{ id: 'JAG', name: 'Salon testowy JAG' }, { id: 'PUL', name: 'Salon testowy PUL' }, { id: 'GLOBAL', name: 'Centrala testowa' }],
  })
  const person = (id: string, lastName: string, extra: Record<string, unknown> = {}) => ({
    id, firstName: 'Testowa', lastName, email: `${id}@example.test`, position: 'Doradca (test)', costCenterId: 'JAG',
    startDate: new Date('2025-01-01T00:00:00Z'), employmentType: 'UoP', ...extra,
  })
  await prisma.employee.createMany({
    data: [
      person('auto-a', 'Alfa'),
      person('auto-b', 'Beta'),
      person('auto-ovr', 'Ręczna'),
      person('auto-noprev', 'Bezpoprzednia'),
      person('auto-leaving', 'Odchodząca', { endDate: new Date('2026-11-15T00:00:00Z') }),
      person('auto-raise', 'Podwyżkowa'),
      person('auto-bonus', 'Premiowa'),
      person('auto-ot', 'Nadgodzinowa'),
      person('auto-sick', 'Chorobowa'),
      person('auto-global', 'Centralna', { costCenterId: 'GLOBAL' }),
      person('auto-prevpart', 'Październikowa', { startDate: new Date('2026-10-12T00:00:00Z') }),
      person('auto-prevsick', 'Wcześniejchora'),
      person('auto-hourly', 'Godzinowa', { employmentType: 'UZ' }),
      person('auto-draft', 'Robocza'),
      person('auto-manual', 'Ręcznie'),
      person('auto-b2b', 'Wykonawca', { employmentType: 'B2B' }),
    ],
  })
  await prisma.user.createMany({
    data: [
      { id: 'admin-1', name: 'Admin Testowy', email: 'admin-1@example.test', role: 'ADMIN', passwordHash: 'test-only' },
      { id: 'admin-2', name: 'Admin Drugi', email: 'admin-2@example.test', role: 'ADMIN', passwordHash: 'test-only' },
      { id: 'admin-off', name: 'Admin Zablokowany', email: 'admin-off@example.test', role: 'ADMIN', passwordHash: 'test-only', isActive: false },
      { id: 'manager-1', name: 'Kierownik Testowy', email: 'manager@example.test', role: 'MANAGER', passwordHash: 'test-only' },
      { id: 'user-a', name: 'Testowa Alfa', email: 'user-a@example.test', role: 'EMPLOYEE', passwordHash: 'test-only', employeeId: 'auto-a' },
    ],
  })

  as('ADMIN')
  const base = async (employeeId: string, amount: string, basis = 'MONTHLY_GROSS', effectiveFrom = '2025-01-01') => {
    const res = await m.baseSalaries.POST(req('/api/hr/payroll/base-salaries', 'POST', { employeeId, effectiveFrom, amount, basis }))
    expect(res.status).toBe(201)
  }
  for (const id of ['auto-a', 'auto-b', 'auto-ovr', 'auto-noprev', 'auto-leaving', 'auto-raise', 'auto-bonus', 'auto-ot', 'auto-sick',
    'auto-global', 'auto-prevpart', 'auto-prevsick', 'auto-draft', 'auto-manual', 'auto-b2b']) await base(id, '5000,00')
  await base('auto-hourly', '50,00', 'HOURLY_GROSS')
  const split = await prisma.payrollCostSplit.create({ data: { employeeId: 'auto-global', effectiveFrom: '2026-10', jagPercent: 100, createdById: 'admin-1' } })

  const sick = await prisma.leaveType.create({ data: { code: 'SL', name: 'Zwolnienie chorobowe', isPaid: true, requiresApproval: true, tracksBalance: false } })
  // October: a pay-affecting absence of the source month.
  await prisma.leaveRequestNew.create({
    data: { id: 'leave-oct', employeeId: 'auto-prevsick', leaveTypeId: sick.id, status: 'approved', days: 2,
      startDate: new Date('2026-10-05T00:00:00Z'), endDate: new Date('2026-10-06T00:00:00Z') },
  })

  // October, approved by hand on the sheet (one with a manually entered employer cost).
  const october = await submit('2026-10', [
    ...['auto-a', 'auto-leaving', 'auto-raise', 'auto-ot', 'auto-sick', 'auto-global', 'auto-prevpart', 'auto-prevsick', 'auto-draft', 'auto-manual']
      .map((employeeId) => ({ employeeId, finalGross: '5000,00', finalNet: '3600,00' })),
    { employeeId: 'auto-b', finalGross: '5200,00', finalNet: '3700,00' },
    { employeeId: 'auto-ovr', finalGross: '5000,00', finalNet: '3600,00', employerCost: '6100,00' },
    { employeeId: 'auto-hourly', finalGross: '4000,00', finalNet: '3100,00' },
  ])
  expect(october.filter((r) => r.status !== 'APPROVED')).toEqual([])
  // October with a bonus, through the detail page.
  const created = await m.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId: 'auto-bonus', month: '2026-10' }))
  const bonusId = (await created.json()).id as string
  const ctx = { params: Promise.resolve({ id: bonusId }) }
  const act = async (body: Record<string, unknown>) => {
    const current = await (await m.settlement.GET(req(`/api/hr/payroll/settlements/${bonusId}`), ctx)).json()
    return m.settlement.PATCH(req(`/api/hr/payroll/settlements/${bonusId}`, 'PATCH', { expectedRevision: current.revision, ...body }), ctx)
  }
  await act({ action: 'adjustment.add', kind: 'BONUS', label: 'Premia testowa', amount: '300' })
  await act({ action: 'payrollOffice.confirm', finalGross: '5300', finalNet: '3800' })
  expect((await act({ action: 'approve' })).status).toBe(200)

  // Changes for November, all before the run.
  await base('auto-raise', '5500,00', 'MONTHLY_GROSS', '2026-11-01')
  await m.costSettings.revokeCostSplit(prisma, 'admin-1', split.id, 'Podział wygasł (test)')
  await prisma.timeEntry.create({
    data: { id: 'te-nov-ot', employeeId: 'auto-ot', date: new Date('2026-11-03T00:00:00Z'), clockIn: new Date('2026-11-03T09:00:00Z'),
      clockOut: new Date('2026-11-03T19:00:00Z'), totalMinutes: 600, breakMinutes: 0, overtimeMinutes: 120, status: 'approved', source: 'bulk' },
  })
  await prisma.leaveRequestNew.create({
    data: { id: 'leave-nov', employeeId: 'auto-sick', leaveTypeId: sick.id, status: 'approved', days: 2,
      startDate: new Date('2026-11-09T00:00:00Z'), endDate: new Date('2026-11-10T00:00:00Z') },
  })
  expect((await m.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId: 'auto-draft', month: '2026-11' }))).status).toBe(201)
  expect((await submit('2026-11', [{ employeeId: 'auto-manual', finalGross: '5000,00', finalNet: '3600,00' }]))[0]?.status).toBe('APPROVED')
  await prisma.payrollEmployerRate.create({ data: { settlementType: 'UOP', effectiveFrom: '2026-11', ...NOV_RATES, createdById: 'admin-1' } })
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

let run: Awaited<ReturnType<Modules['scheduler']['runDuePayrollAutomation']>>
let runSummary: import('@/lib/payroll/auto-carryover').PayrollAutoCarryoverSummary

describe('payroll automat — switch and due run', () => {
  it('should do nothing while the automat is switched off', async () => {
    const before = await counts()
    const tick = await m.scheduler.runDuePayrollAutomation(prisma, NOV_05)
    expect([tick.carryover, await counts()]).toEqual([{ ran: false, reason: 'DISABLED' }, before])
  })

  it('should not run the month in which the automat is switched on (D10)', async () => {
    const status = await m.scheduler.setPayrollAutomationEnabled(prisma, true, OCT_20)
    const before = await counts()
    const tick = await m.scheduler.runDuePayrollAutomation(prisma, at('2026-10-20T15:00:00Z'))
    expect({
      lastMonth: status.lastMonth,
      nextRun: status.nextRun,
      tick: tick.carryover,
      after: await counts(),
    }).toEqual({ lastMonth: '2026-10', nextRun: { month: '2026-11', date: '2026-11-01' }, tick: { ran: false, reason: 'NOT_DUE' }, after: before })
  })

  it('should run November at the first check on the 5th after the server was down since October', async () => {
    run = await m.scheduler.runDuePayrollAutomation(prisma, NOV_05)
    expect(run.carryover.ran).toBe(true)
    if (!run.carryover.ran) throw new Error('not ran')
    runSummary = run.carryover.summary
    expect([run.carryover.month, runSummary.approved.map((p) => p.employeeId).sort()])
      .toEqual(['2026-11', ['auto-a', 'auto-b', 'auto-ovr']])
  })

  it('should approve with October amounts, a recalculated cost, the origin and a note naming the source month', async () => {
    const version = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'auto-a', ...NOV } })
    const october = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'auto-a', ...OCT } })
    expect({
      versionNumber: version.versionNumber,
      origin: version.origin,
      gross: version.finalGrossGrosze,
      net: version.finalNetGrosze,
      cost: version.employerCostGrosze,
      source: version.employerCostSource,
      note: version.approvalNote,
      approvedBy: version.approvedById,
      costChangedWithRates: version.employerCostGrosze !== october.employerCostGrosze,
    }).toEqual({
      versionNumber: 1,
      origin: 'AUTO_CARRYOVER',
      gross: october.finalGrossGrosze,
      net: october.finalNetGrosze,
      cost: calculateEmployerCostGrosze(500000, NOV_RATES),
      source: 'CALCULATED',
      note: 'Automatyczne przeniesienie z 2026-10',
      approvedBy: SYSTEM,
      costChangedWithRates: true,
    })
  })

  it('should copy a manually entered October employer cost', async () => {
    const version = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'auto-ovr', ...NOV } })
    expect([version.employerCostGrosze, version.employerCostSource, version.origin]).toEqual([610000, 'OVERRIDDEN', 'AUTO_CARRYOVER'])
  })

  it('should record create, payroll office confirmation and approval with "Automat" as the author', async () => {
    const settlement = await prisma.payrollSettlement.findUniqueOrThrow({ where: { employeeId_year_month: { employeeId: 'auto-a', ...NOV } } })
    const events = await prisma.payrollAuditEvent.findMany({ where: { settlementId: settlement.id }, orderBy: { createdAt: 'asc' } })
    as('ADMIN')
    const detail = await (await m.settlement.GET(req(`/api/hr/payroll/settlements/${settlement.id}`), { params: Promise.resolve({ id: settlement.id }) })).json()
    expect({
      events: events.map((e) => [e.action, e.actorId]),
      historyName: detail.actors[SYSTEM],
      versionAuthor: detail.actors[detail.versions[0].approvedById],
      versionOrigin: detail.versions[0].origin,
    }).toEqual({
      events: [['settlement.create', SYSTEM], ['payrollOffice.confirm', SYSTEM], ['settlement.approve', SYSTEM]],
      historyName: 'Automat',
      versionAuthor: 'Automat',
      versionOrigin: 'AUTO_CARRYOVER',
    })
  })

  it.each([
    ['(1) no approved previous month', 'auto-noprev', /brak zatwierdzonego października/],
    ['(2) employment ends during the month', 'auto-leaving', /niepełny miesiąc/],
    ['(3) base salary changed since October', 'auto-raise', /angaż zmienił się/],
    ['(4) the source month had a bonus', 'auto-bonus', /zawierał premię/],
    ['(5) overtime without a decision', 'auto-ot', /nadgodziny mają wskazane/],
    ['(6) a pay-affecting absence in the month', 'auto-sick', /nieobecność zmieniająca wypłatę/],
    ['(7) GLOBAL without a JAG/PUL split', 'auto-global', /podział kosztu na salony/],
    ['(8) the source month was not worked in full', 'auto-prevpart', /poprzedni miesiąc był niepełny/],
    ['(9) the source month had a pay-affecting absence', 'auto-prevsick', /poprzedni miesiąc zawierał nieobecność/],
    ['hourly basis', 'auto-hourly', /stawka godzinowa/],
    ['an existing draft', 'auto-draft', /rozliczenie robocze/],
  ])('should leave %s for the ADMIN with the reason and without a new settlement', async (_label, employeeId, reason) => {
    const attention = runSummary.attention.find((p) => p.employeeId === employeeId)
    const november = await prisma.payrollSettlementVersion.count({ where: { employeeId, ...NOV } })
    expect({ reasons: attention?.reasons.some((text) => reason.test(text)), november }).toEqual({ reasons: true, november: 0 })
  })

  it('should leave a person approved by hand untouched and never list an external contractor', async () => {
    const manual = await prisma.payrollSettlementVersion.findMany({ where: { employeeId: 'auto-manual', ...NOV } })
    const everyone = [...runSummary.approved, ...runSummary.attention, ...runSummary.alreadySettled, ...runSummary.errors].map((p) => p.employeeId)
    expect({
      manual: manual.map((v) => [v.versionNumber, v.origin, v.approvedById]),
      alreadySettled: runSummary.alreadySettled.map((p) => p.employeeId),
      contractor: everyone.includes('auto-b2b'),
      errors: runSummary.errors,
    }).toEqual({ manual: [[1, 'MANUAL', 'admin-1']], alreadySettled: ['auto-manual'], contractor: false, errors: [] })
  })

  it('should notify every active ADMIN once with the counts and a link to the month sheet', async () => {
    const [first, second, blocked, manager, employee] = await Promise.all(
      ['admin-1', 'admin-2', 'admin-off', 'manager-1', 'user-a'].map((id) => notificationsOf(id, 'payroll_auto')))
    expect({
      first: first.map((n) => [n.title, n.link]),
      second: second.length,
      others: [blocked.length, manager.length, employee.length],
      mentionsReason: first[0]?.message.startsWith('Wymagają uwagi: Bezpoprzednia Testowa — brak zatwierdzonego października'),
    }).toEqual({
      first: [['Wynagrodzenia za listopad: 3 zatwierdzone automatycznie, 11 wymaga uwagi', '/hr/payroll?month=2026-11']],
      second: 1,
      others: [0, 0, 0],
      mentionsReason: true,
    })
  })

  it('should remember the result of the run for the settings panel', async () => {
    const status = await m.scheduler.getPayrollAutomationStatus(prisma, NOV_05)
    expect([status.lastMonth, status.lastResult, status.nextRun]).toEqual([
      '2026-11',
      { month: '2026-11', ranAt: NOV_05.toISOString(), approved: 3, attention: 11, errors: 0 },
      { month: '2026-12', date: '2026-12-01' },
    ])
  })

  it('should show the automatic origin on the sheet and the approved month on the employee pay slip', async () => {
    const [auto, manual, own] = await Promise.all([
      sheetRow('2026-11', 'auto-a'),
      sheetRow('2026-11', 'auto-manual'),
      m.contracts.getOwnPayrollStatements(prisma, 'auto-a'),
    ])
    expect({
      auto: auto.effectiveVersion?.origin,
      manual: manual.effectiveVersion?.origin,
      slip: own.filter((s) => s.year === 2026 && s.month === 11).map((s) => [s.versionNumber, s.finalGrossGrosze, s.finalNetGrosze]),
    }).toEqual({ auto: 'AUTO_CARRYOVER', manual: 'MANUAL', slip: [[1, 500000, 360000]] })
  })

  it('should create no version, event or notification on a second run for the same month', async () => {
    const before = { ...(await counts()), notifications: await prisma.notification.count() }
    const again = await m.carryover.runPayrollAutoCarryover(prisma, NOV)
    const tick = await m.scheduler.runDuePayrollAutomation(prisma, at('2026-11-05T09:00:00Z'))
    expect({
      approved: again.approved.length,
      alreadySettled: again.alreadySettled.map((p) => p.employeeId).sort(),
      tick: tick.carryover,
      after: { ...(await counts()), notifications: await prisma.notification.count() },
    }).toEqual({
      approved: 0,
      alreadySettled: ['auto-a', 'auto-b', 'auto-manual', 'auto-ovr'],
      tick: { ran: false, reason: 'NOT_DUE' },
      after: before,
    })
  })

  it('should send nothing for a run that approved nothing and has nobody needing attention', async () => {
    const result = await m.scheduler.executePayrollAutoCarryover(prisma, { year: 2024, month: 1 }, NOV_05)
    expect([result.summary.approved.length, result.summary.attention.length, result.notified]).toEqual([0, 0, 0])
  })

  it('should reject a direct change of the origin of an approved version (database guard)', async () => {
    const version = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'auto-a', ...NOV } })
    // Superseding is the one update the trigger allows; changing the origin on the way must still fail.
    const supersede = (origin?: string) => `UPDATE "PayrollSettlementVersion" SET "supersededAt" = CURRENT_TIMESTAMP, `
      + `"supersededByVersionId" = 'probe'${origin ? `, "origin" = '${origin}'` : ''} WHERE "id" = '${version.id}'`
    class Rollback extends Error { constructor(readonly changed: number) { super('rollback') } }
    const control = await prisma.$transaction(async (tx) => { throw new Rollback(await tx.$executeRawUnsafe(supersede())) })
      .catch((error: unknown) => error instanceof Rollback ? error.changed : error)
    await expect(prisma.$executeRawUnsafe(supersede('MANUAL'))).rejects.toThrow(/approved payroll versions are immutable/)
    await expect(prisma.payrollSettlementVersion.update({ where: { id: version.id }, data: { origin: 'MANUAL' } })).rejects.toThrow(/immutable/)
    const after = await prisma.payrollSettlementVersion.findUniqueOrThrow({ where: { id: version.id } })
    expect([control, after.origin, after.supersededAt]).toEqual([1, 'AUTO_CARRYOVER', null])
  })

  it('should only accept MANUAL or AUTO_CARRYOVER as the origin (CHECK constraint)', async () => {
    const [table] = await prisma.$queryRawUnsafe<Array<{ sql: string }>>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'PayrollSettlementVersion'`)
    const defaults = await prisma.payrollSettlementVersion.groupBy({ by: ['origin'], _count: true, orderBy: { origin: 'asc' } })
    expect([table?.sql.includes(`CHECK ("origin" IN ('MANUAL', 'AUTO_CARRYOVER'))`), defaults.map((d) => d.origin)])
      .toEqual([true, ['AUTO_CARRYOVER', 'MANUAL']])
  })
})

describe('payroll automat — change after approval (D9)', () => {
  it('should raise nothing for an ordinary time entry without overtime, pending or approved', async () => {
    await prisma.timeEntry.create({
      data: { id: 'te-ordinary', employeeId: 'auto-a', date: new Date('2026-11-09T00:00:00Z'), clockIn: new Date('2026-11-09T10:00:00Z'),
        clockOut: new Date('2026-11-09T18:00:00Z'), totalMinutes: 480, breakMinutes: 0, overtimeMinutes: 0, status: 'pending', source: 'clock' },
    })
    const pending = (await sheetRow('2026-11', 'auto-a')).changeAfterApproval
    await prisma.timeEntry.update({ where: { id: 'te-ordinary' }, data: { status: 'approved' } })
    const approved = await sheetRow('2026-11', 'auto-a')
    const before = await prisma.notification.count({ where: { type: 'payroll_change' } })
    const tick = await m.scheduler.runDuePayrollAutomation(prisma, at('2026-11-10T07:00:00Z'))
    expect({
      pending,
      approved: approved.changeAfterApproval,
      notice: tick.changeNotice,
      notifications: (await prisma.notification.count({ where: { type: 'payroll_change' } })) - before,
    }).toEqual({ pending: null, approved: null, notice: { ran: true, pending: 0, fresh: 0, notified: 0 }, notifications: 0 })
  })

  it('should label an approved row after sick leave is approved in Urlopy for that month', async () => {
    const sick = await prisma.leaveType.findUniqueOrThrow({ where: { code: 'SL' } })
    await prisma.leaveRequestNew.create({
      data: { id: 'leave-after', employeeId: 'auto-a', leaveTypeId: sick.id, status: 'pending', days: 2,
        startDate: new Date('2026-11-16T00:00:00Z'), endDate: new Date('2026-11-17T00:00:00Z') },
    })
    const approve = m.leaveApproval.createLeaveApprovalHandler({
      prisma,
      getSession: async () => ({ user: { id: 'admin-1', role: 'ADMIN', employeeId: null } } as unknown as Session),
    })
    const res = await approve(req('/api/hr/leave-requests/leave-after/approve', 'PATCH', {}), { params: Promise.resolve({ id: 'leave-after' }) })
    const row = await sheetRow('2026-11', 'auto-a')
    expect([res.status, row.changeAfterApproval?.changes, row.settlement?.status, row.blockers]).toEqual([
      200, [{ code: 'ABSENCE', message: 'nieobecność' }], 'APPROVED', [],
    ])
  })

  it('should notify the ADMINs about the change once, and not again the next day', async () => {
    const before = await notificationsOf('admin-1', 'payroll_change')
    const first = await m.scheduler.runDuePayrollAutomation(prisma, at('2026-11-11T06:30:00Z'))
    const afterFirst = await notificationsOf('admin-1', 'payroll_change')
    const second = await m.scheduler.runDuePayrollAutomation(prisma, at('2026-11-12T06:30:00Z'))
    const afterSecond = await notificationsOf('admin-1', 'payroll_change')
    expect({
      first: first.changeNotice,
      second: second.changeNotice,
      created: [afterFirst.length - before.length, afterSecond.length - afterFirst.length],
      title: afterFirst.at(-1)?.title,
      message: afterFirst.at(-1)?.message,
      link: afterFirst.at(-1)?.link,
      otherRoles: (await notificationsOf('manager-1', 'payroll_change')).length + (await notificationsOf('user-a', 'payroll_change')).length,
    }).toEqual({
      first: { ran: true, pending: 1, fresh: 1, notified: 2 },
      second: { ran: true, pending: 1, fresh: 0, notified: 0 },
      created: [1, 0],
      title: 'Wynagrodzenia za listopad: zmiana po zatwierdzeniu u 1 osoby — sprawdź kwotę',
      message: 'Zmieniło się: Alfa Testowa (nieobecność).',
      link: '/hr/payroll?month=2026-11',
      otherRoles: 0,
    })
  })

  it('should refuse "Kwota aktualna" for another role, for a stale signature, and accept the signature shown', async () => {
    const row = await sheetRow('2026-11', 'auto-a')
    const settlementId = row.settlement!.id
    as('MANAGER', 'manager-1')
    const manager = await acknowledge(settlementId, row.changeAfterApproval!.signature)
    as('ADMIN')
    const stale = await acknowledge(settlementId, 'f'.repeat(64))
    const ok = await acknowledge(settlementId, row.changeAfterApproval!.signature)
    const event = await prisma.payrollAuditEvent.findFirstOrThrow({ where: { settlementId, action: 'settlement.changesAcknowledged' } })
    const versions = await prisma.payrollSettlementVersion.count({ where: { settlementId } })
    expect({
      statuses: [manager.status, stale.status, ok.status],
      event: [event.actorId, event.reason, JSON.parse(event.afterJson ?? '{}').changesText],
      label: (await sheetRow('2026-11', 'auto-a')).changeAfterApproval,
      versions,
    }).toEqual({
      statuses: [403, 409, 200],
      event: ['admin-1', 'Kwota aktualna mimo zmiany po zatwierdzeniu', 'nieobecność'],
      label: null,
      versions: 1,
    })
  })

  it('should show the label again for the next change (overtime), pointing to the detail page while a decision is missing', async () => {
    await prisma.timeEntry.create({
      data: { id: 'te-after-ot', employeeId: 'auto-a', date: new Date('2026-11-18T00:00:00Z'), clockIn: new Date('2026-11-18T10:00:00Z'),
        clockOut: new Date('2026-11-18T20:00:00Z'), totalMinutes: 600, breakMinutes: 0, overtimeMinutes: 120, status: 'approved', source: 'clock' },
    })
    const row = await sheetRow('2026-11', 'auto-a')
    const tick = await m.scheduler.runDuePayrollAutomation(prisma, at('2026-11-19T06:30:00Z'))
    expect({
      changes: row.changeAfterApproval?.changes.map((c) => c.code),
      blockers: row.blockers.map((b) => b.code),
      status: row.settlement?.status,
      notice: tick.changeNotice,
    }).toEqual({
      changes: ['OVERTIME'],
      blockers: ['OVERTIME_UNRESOLVED'],
      status: 'APPROVED',
      notice: { ran: true, pending: 1, fresh: 1, notified: 2 },
    })
  })

  it('should label an end of employment set in the card on a day of the month', async () => {
    await prisma.employee.update({ where: { id: 'auto-b' }, data: { endDate: new Date('2026-11-20T00:00:00Z') } })
    expect((await sheetRow('2026-11', 'auto-b')).changeAfterApproval?.changes).toEqual([{ code: 'EMPLOYMENT', message: 'daty zatrudnienia' }])
  })

  it('should label a base salary change effective within the approved month', async () => {
    as('ADMIN')
    const res = await m.baseSalaries.POST(req('/api/hr/payroll/base-salaries', 'POST', {
      employeeId: 'auto-ovr', effectiveFrom: '2026-11-15', amount: '5600,00', basis: 'MONTHLY_GROSS',
    }))
    expect([res.status, (await sheetRow('2026-11', 'auto-ovr')).changeAfterApproval?.changes.map((c) => c.code)]).toEqual([201, ['BASE']])
  })

  it('should notify on the 1st of December about a change made on the last day of November, once', async () => {
    // Overtime on 30.11 for a person approved by hand: the 07:00 notice can only come on 1.12, when
    // November is already the previous month.
    await prisma.timeEntry.create({
      data: { id: 'te-last-day', employeeId: 'auto-manual', date: new Date('2026-11-30T00:00:00Z'), clockIn: new Date('2026-11-30T10:00:00Z'),
        clockOut: new Date('2026-11-30T20:00:00Z'), totalMinutes: 600, breakMinutes: 0, overtimeMinutes: 120, status: 'approved', source: 'clock' },
    })
    // December's own run is not the subject here: mark it as done for the two checks, then put the month back.
    const lastMonth = { key: m.scheduler.PAYROLL_AUTOMATION_KEYS.lastMonth }
    await prisma.appSetting.update({ where: lastMonth, data: { value: '2026-12' } })
    const before = await notificationsOf('admin-1', 'payroll_change')
    const first = await m.scheduler.runDuePayrollAutomation(prisma, at('2026-12-01T06:30:00Z'))
    const afterFirst = await notificationsOf('admin-1', 'payroll_change')
    const second = await m.scheduler.runDuePayrollAutomation(prisma, at('2026-12-02T06:30:00Z'))
    const afterSecond = await notificationsOf('admin-1', 'payroll_change')
    await prisma.appSetting.update({ where: lastMonth, data: { value: '2026-11' } })
    expect({
      // November: auto-a (already notified on 19.11), auto-b and auto-ovr (changed since), auto-manual (30.11).
      first: first.changeNotice,
      second: second.changeNotice,
      created: [afterFirst.length - before.length, afterSecond.length - afterFirst.length],
      title: afterFirst.at(-1)?.title,
      message: afterFirst.at(-1)?.message,
      link: afterFirst.at(-1)?.link,
    }).toEqual({
      first: { ran: true, pending: 4, fresh: 3, notified: 2 },
      second: { ran: true, pending: 4, fresh: 0, notified: 0 },
      created: [1, 0],
      title: 'Wynagrodzenia za listopad: zmiana po zatwierdzeniu u 3 osób — sprawdź kwotę',
      message: expect.stringContaining('Ręcznie Testowa (nadgodziny)'),
      link: '/hr/payroll?month=2026-11',
    })
  })

  it('should never reopen an approved settlement on its own', async () => {
    const statuses = await prisma.payrollSettlement.findMany({ where: { ...NOV, employeeId: { in: ['auto-a', 'auto-b', 'auto-ovr'] } }, select: { status: true } })
    const reopened = await prisma.payrollAuditEvent.count({ where: { action: 'settlement.reopen', actorId: SYSTEM } })
    expect([statuses.map((s) => s.status), reopened]).toEqual([['APPROVED', 'APPROVED', 'APPROVED'], 0])
  })
})

describe('payroll automat — settings API', () => {
  it.each([
    ['a manager', 'MANAGER', 'manager-1', null],
    ['an employee', 'EMPLOYEE', 'user-a', 'auto-a'],
  ] as const)('should deny %s the automat settings and "Kwota aktualna"', async (_label, role, id, employeeId) => {
    as(role, id, employeeId)
    const responses = await Promise.all([
      m.automation.GET(),
      m.automation.PUT(req('/api/hr/payroll/automation', 'PUT', { enabled: true })),
      acknowledge('any', 'f'.repeat(64)),
    ])
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403])
  })

  it('should return 401 without a session', async () => {
    as(null)
    expect((await m.automation.GET()).status).toBe(401)
  })

  it('should validate the switch strictly', async () => {
    as('ADMIN')
    const responses = await Promise.all([
      m.automation.PUT(req('/api/hr/payroll/automation', 'PUT', { enabled: 'yes' })),
      m.automation.PUT(req('/api/hr/payroll/automation', 'PUT', { enabled: true, runNow: true })),
    ])
    expect(responses.map((r) => r.status)).toEqual([400, 400])
  })

  it('should switch on for the next month only, survive a re-read, and not run after being switched off', async () => {
    as('ADMIN')
    const today = m.scheduler.warsawClock(new Date())
    const next = m.scheduler.shiftMonthKey(today.month, 1)
    const on = await (await m.automation.PUT(req('/api/hr/payroll/automation', 'PUT', { enabled: true }))).json()
    const reread = await (await m.automation.GET()).json()
    const off = await (await m.automation.PUT(req('/api/hr/payroll/automation', 'PUT', { enabled: false }))).json()
    const before = await counts()
    // The 1st of the next month at 06:30 Warsaw would be due if the automat were on.
    const tick = await m.scheduler.runDuePayrollAutomation(prisma, at(`${next}-01T05:30:00Z`))
    expect({
      on: [on.enabled, on.lastMonth, on.nextRun],
      reread: [reread.enabled, reread.nextRun],
      off: [off.enabled, off.nextRun],
      tick: tick.carryover,
      after: await counts(),
    }).toEqual({
      on: [true, today.month, { month: next, date: `${next}-01` }],
      reread: [true, { month: next, date: `${next}-01` }],
      off: [false, null],
      tick: { ran: false, reason: 'DISABLED' },
      after: before,
    })
  })
})

describe('payroll automat — a run that breaks off', () => {
  it('should keep the month claimed, tell the ADMINs and not run again', async () => {
    const keys = m.scheduler.PAYROLL_AUTOMATION_KEYS
    for (const [key, value] of [[keys.enabled, 'true'], [keys.lastMonth, '2026-12']] as const) {
      await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    }
    // The database stops answering as soon as the run reads the month sheet.
    const broken = new Proxy(prisma, {
      get(target, property) {
        if (property === 'payrollSettlement') {
          return { findMany: async () => { throw new Error('database did not answer (test)') } }
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const before = await notificationsOf('admin-1', 'payroll_auto')
    // 1.01.2027 06:30 in Warsaw: the run is due, the 07:00 change notice is not.
    const failed = await m.scheduler.runDuePayrollAutomation(broken, at('2027-01-01T05:30:00Z'))
    const after = await notificationsOf('admin-1', 'payroll_auto')
    const again = await m.scheduler.runDuePayrollAutomation(prisma, at('2027-01-01T05:40:00Z'))
    expect({
      failed: failed.carryover,
      created: after.length - before.length,
      title: after.at(-1)?.title,
      link: after.at(-1)?.link,
      otherRoles: (await prisma.notification.count({ where: { userId: { in: ['manager-1', 'user-a', 'admin-off'] }, type: 'payroll_auto' } })),
      lastMonth: (await prisma.appSetting.findUnique({ where: { key: keys.lastMonth } }))?.value,
      again: again.carryover,
      january: await prisma.payrollSettlement.count({ where: { year: 2027, month: 1 } }),
    }).toEqual({
      failed: { ran: false, reason: 'FAILED', month: '2027-01', message: 'database did not answer (test)' },
      created: 1,
      title: 'Wynagrodzenia za styczeń: automat nie dokończył przebiegu',
      link: '/hr/payroll?month=2027-01',
      otherRoles: 0,
      lastMonth: '2027-01',
      again: { ran: false, reason: 'NOT_DUE' },
      january: 0,
    })
  })
})
