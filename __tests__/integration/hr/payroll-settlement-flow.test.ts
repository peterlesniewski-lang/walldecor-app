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

// Full admin flow on a FRESH database built from the real migration chain.
// All people and amounts are synthetic test data.

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const mockSession = vi.mocked(getServerSession)

const workspace = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-payroll-'))
const databaseUrl = `file:${path.join(directory, 'payroll.db')}`

type Routes = {
  baseSalaries: typeof import('@/app/api/hr/payroll/base-salaries/route')
  revokeBase: typeof import('@/app/api/hr/payroll/base-salaries/[id]/revoke/route')
  settlements: typeof import('@/app/api/hr/payroll/settlements/route')
  settlement: typeof import('@/app/api/hr/payroll/settlements/[id]/route')
  approveEntry: typeof import('@/app/api/hr/time-tracking/[id]/approve/route')
  contracts: typeof import('@/lib/payroll/contracts')
}

let prisma: PrismaClient
let routes: Routes

async function boot() {
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  vi.resetModules()
  vi.doMock('@/lib/prisma', () => ({ prisma }))
  routes = {
    baseSalaries: await import('@/app/api/hr/payroll/base-salaries/route'),
    revokeBase: await import('@/app/api/hr/payroll/base-salaries/[id]/revoke/route'),
    settlements: await import('@/app/api/hr/payroll/settlements/route'),
    settlement: await import('@/app/api/hr/payroll/settlements/[id]/route'),
    approveEntry: await import('@/app/api/hr/time-tracking/[id]/approve/route'),
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

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function detail(id: string) {
  const res = await routes.settlement.GET(req(`/api/hr/payroll/settlements/${id}`), ctx(id))
  expect(res.status).toBe(200)
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
  await prisma.employee.createMany({
    data: [
      { id: 'emp-a', firstName: 'Testowa', lastName: 'Alfa', email: 'alfa@example.test', position: 'Doradca', costCenterId: 'JAG', startDate: new Date('2025-01-01'), employmentType: 'UoP' },
      { id: 'emp-b', firstName: 'Testowy', lastName: 'Beta', email: 'beta@example.test', position: 'Doradca', costCenterId: 'JAG', startDate: new Date('2025-01-01'), employmentType: 'UoP' },
    ],
  })
  await prisma.user.createMany({
    data: [
      { id: 'admin-1', name: 'Admin Testowy', email: 'admin@example.test', role: 'ADMIN', passwordHash: 'test-only' },
      { id: 'user-a', name: 'Testowa Alfa', email: 'alfa@example.test', role: 'EMPLOYEE', passwordHash: 'test-only', employeeId: 'emp-a' },
      { id: 'user-b', name: 'Testowy Beta', email: 'beta@example.test', role: 'EMPLOYEE', passwordHash: 'test-only', employeeId: 'emp-b' },
    ],
  })

  // Calendar for August 2026 (existing HR module data; payroll never re-enters hours).
  const day = (iso: string, h: number) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00.000Z`)
  await prisma.timeEntry.createMany({
    data: [
      { id: 'te-wed', employeeId: 'emp-a', date: new Date('2026-08-05T00:00:00Z'), clockIn: day('2026-08-05', 9), clockOut: day('2026-08-05', 18), totalMinutes: 540, breakMinutes: 0, overtimeMinutes: 60, status: 'approved', source: 'bulk' },
      { id: 'te-sat', employeeId: 'emp-a', date: new Date('2026-08-08T00:00:00Z'), clockIn: day('2026-08-08', 9), clockOut: day('2026-08-08', 12), totalMinutes: 180, breakMinutes: 0, overtimeMinutes: 180, status: 'approved', source: 'bulk' },
      { id: 'te-pending', employeeId: 'emp-a', date: new Date('2026-08-12T00:00:00Z'), clockIn: day('2026-08-12', 9), clockOut: day('2026-08-12', 17), totalMinutes: 510, breakMinutes: 0, overtimeMinutes: 30, status: 'pending', source: 'manual' },
      { id: 'te-regular', employeeId: 'emp-a', date: new Date('2026-08-13T00:00:00Z'), clockIn: day('2026-08-13', 9), clockOut: day('2026-08-13', 17), totalMinutes: 480, breakMinutes: 0, overtimeMinutes: 0, status: 'approved', source: 'bulk' },
    ],
  })
  await prisma.overtimeRequest.create({
    data: { employeeId: 'emp-a', date: new Date('2026-08-08T00:00:00Z'), minutes: 180, reason: 'Sobota', status: 'approved', resolution: 'time_off' },
  })
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('payroll settlement — admin flow on a fresh database', () => {
  let settlementId = ''
  let baseId = ''

  it('should let ADMIN set a base salary with an effective date', async () => {
    as('ADMIN')
    const res = await routes.baseSalaries.POST(req('/api/hr/payroll/base-salaries', 'POST', {
      employeeId: 'emp-a', effectiveFrom: '2026-01-01', amount: '4321,00', basis: 'MONTHLY_GROSS', note: 'dane testowe',
    }))
    const row = await res.json()
    baseId = row.id
    expect([res.status, row.amountGrosze]).toEqual([201, 432100])
  })

  it('should reject a second active base with the same effective date', async () => {
    const res = await routes.baseSalaries.POST(req('/api/hr/payroll/base-salaries', 'POST', {
      employeeId: 'emp-a', effectiveFrom: '2026-01-01', amount: '1,00', basis: 'MONTHLY_GROSS',
    }))
    expect(res.status).toBe(409)
  })

  it('should create a draft settlement that pulls overtime from the calendar', async () => {
    const res = await routes.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId: 'emp-a', month: '2026-08' }))
    settlementId = (await res.json()).id
    const data = await detail(settlementId)
    expect({
      status: res.status,
      draft: data.status,
      base: data.baseSalaryGrosze,
      lines: data.overtimeLines.map((l: { timeEntryId: string; entryStatus: string; resolution: string | null }) => [l.timeEntryId, l.entryStatus, l.resolution]),
      workedMinutes: data.approvedWorkedMinutes,
    }).toEqual({
      status: 201,
      draft: 'DRAFT',
      base: 432100,
      lines: [['te-wed', 'approved', null], ['te-sat', 'approved', 'TIME_OFF'], ['te-pending', 'pending', null]],
      workedMinutes: 540 + 180 + 480,
    })
  })

  it('should refuse a duplicate settlement for the same employee-month', async () => {
    const res = await routes.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId: 'emp-a', month: '2026-08' }))
    expect(res.status).toBe(409)
  })

  it('should not accept payroll office data while calendar overtime is unapproved or unresolved', async () => {
    const { res, json } = await act(settlementId, { action: 'payrollOffice.confirm', finalGross: '5000', finalNet: '3600', employerCost: '6000' })
    expect([res.status, json.details.blockers.map((b: { code: string }) => b.code).sort()])
      .toEqual([409, ['OVERTIME_PENDING_APPROVAL', 'OVERTIME_UNRESOLVED']])
  })

  it('should detect calendar changes after the manager approves the pending entry', async () => {
    as('ADMIN')
    const res = await routes.approveEntry.PATCH(req('/api/hr/time-tracking/te-pending/approve', 'PATCH'), ctx('te-pending'))
    expect(res.status).toBe(200)
    const data = await detail(settlementId)
    expect([data.calendarInSync, data.summary.inputBlockers]).toEqual([false, expect.arrayContaining(['CALENDAR_OUT_OF_SYNC'])])
  })

  it('should re-sync from the calendar and then classify each approved overtime day', async () => {
    expect((await act(settlementId, { action: 'calendar.sync' })).res.status).toBe(200)
    const lines = (await detail(settlementId)).overtimeLines as Array<{ id: string; timeEntryId: string }>
    const lineId = (entryId: string) => lines.find((l) => l.timeEntryId === entryId)!.id
    expect((await act(settlementId, { action: 'overtime.resolve', lineId: lineId('te-wed'), resolution: 'PAYOUT' })).res.status).toBe(200)
    const { json } = await act(settlementId, { action: 'overtime.resolve', lineId: lineId('te-pending'), resolution: 'PAYOUT' })
    expect([json.summary.payoutOvertimeMinutes, json.summary.timeOffOvertimeMinutes, json.summary.inputBlockers]).toEqual([90, 180, []])
  })

  it('should keep a change history for bonuses and corrections', async () => {
    const added = await act(settlementId, { action: 'adjustment.add', kind: 'BONUS', label: 'Premia testowa', amount: '250,00' })
    const bonusId = added.json.adjustments[0].id
    await act(settlementId, { action: 'adjustment.update', adjustmentId: bonusId, label: 'Premia testowa', amount: '300,00', reason: 'Korekta wysokości premii' })
    const correction = await act(settlementId, { action: 'adjustment.add', kind: 'CORRECTION', label: 'Korekta testowa', amount: '-40,00' })
    const correctionId = correction.json.adjustments.find((a: { kind: string }) => a.kind === 'CORRECTION').id
    const { json } = await act(settlementId, { action: 'adjustment.delete', adjustmentId: correctionId, reason: 'Wpisana omyłkowo' })
    const actions = json.auditEvents.map((e: { action: string }) => e.action)
    expect({
      bonuses: json.summary.bonusesGrosze,
      corrections: json.summary.correctionsGrosze,
      history: actions.filter((a: string) => a.startsWith('adjustment.')).reverse(),
      updateBefore: JSON.parse(json.auditEvents.find((e: { action: string }) => e.action === 'adjustment.update').beforeJson).amountGrosze,
    }).toEqual({
      bonuses: 30000,
      corrections: 0,
      history: ['adjustment.add', 'adjustment.update', 'adjustment.add', 'adjustment.delete'],
      updateBefore: 25000,
    })
  })

  it('should reject a negative bonus', async () => {
    const { res } = await act(settlementId, { action: 'adjustment.add', kind: 'BONUS', label: 'Zła premia', amount: '-1' })
    expect(res.status).toBe(400)
  })

  it('should reject payroll office figures with net above gross', async () => {
    const { res } = await act(settlementId, { action: 'payrollOffice.confirm', finalGross: '5000', finalNet: '5000,01', employerCost: '6000' })
    expect(res.status).toBe(400)
  })

  it('should calculate the employer cost from gross and default UoP rates when it is not given', async () => {
    // 5 000,00 × (9,76% + 6,50% + 1,67% + 2,45% + 0,10%) = 1 024,00
    const { res, json } = await act(settlementId, { action: 'payrollOffice.confirm', finalGross: '5000', finalNet: '3600' })
    expect([res.status, json.employerCostGrosze, json.employerCostSource]).toEqual([200, 602400, 'CALCULATED'])
  })

  it('should store gross, net and full employer cost separately after payroll office confirmation', async () => {
    const { res, json } = await act(settlementId, {
      action: 'payrollOffice.confirm', finalGross: '4 771,11', finalNet: '3 512,34', employerCost: '5 748,22', reference: 'LP test 08/2026',
    })
    expect([res.status, json.finalGrossGrosze, json.finalNetGrosze, json.employerCostGrosze, json.summary.approvalBlockers])
      .toEqual([200, 477111, 351234, 574822, []])
  })

  it('should invalidate the payroll office confirmation when an input changes afterwards', async () => {
    const { json } = await act(settlementId, { action: 'adjustment.add', kind: 'BONUS', label: 'Dodatkowa premia', amount: '10' })
    expect([json.payrollOfficeConfirmedAt, json.summary.approvalBlockers]).toEqual([null, ['PAYROLL_OFFICE_NOT_CONFIRMED']])
  })

  it('should approve and freeze version 1 once the payroll office data is re-confirmed', async () => {
    await act(settlementId, { action: 'payrollOffice.confirm', finalGross: '4 781,11', finalNet: '3 518,34', employerCost: '5 760,26', reference: 'LP test 08/2026 v2' })
    const { res, json } = await act(settlementId, { action: 'approve', note: 'Zgodne z listą płac' })
    expect([res.status, json.status, json.currentVersionNumber, json.versions[0].employerCostGrosze, json.versions[0].bonusesGrosze])
      .toEqual([200, 'APPROVED', 1, 576026, 31000])
  })

  it('should reject a stale revision', async () => {
    const res = await routes.settlement.PATCH(
      req(`/api/hr/payroll/settlements/${settlementId}`, 'PATCH', { expectedRevision: 1, action: 'reopen', reason: 'test' }),
      ctx(settlementId)
    )
    expect(res.status).toBe(409)
  })

  it('should refuse edits on an approved settlement without reopening', async () => {
    const { res } = await act(settlementId, { action: 'adjustment.add', kind: 'BONUS', label: 'Po zatwierdzeniu', amount: '1' })
    expect(res.status).toBe(409)
  })

  it('should return the same approved data after an application restart', async () => {
    const before = await detail(settlementId)
    await prisma.$disconnect()
    await boot()
    as('ADMIN')
    const after = await detail(settlementId)
    const pick = (d: typeof before) => [d.status, d.revision, d.finalGrossGrosze, d.finalNetGrosze, d.employerCostGrosze, d.versions.length, d.auditEvents.length]
    expect(pick(after)).toEqual(pick(before))
  })

  it.each([
    ['another employee', 'EMPLOYEE', 'user-b', 'emp-b'],
    ['the settled employee (own data is a later, separate screen)', 'EMPLOYEE', 'user-a', 'emp-a'],
    ['a manager', 'MANAGER', 'manager-1', null],
  ] as const)('should deny %s access to the settlement', async (_label, role, userId, employeeId) => {
    as(role, userId, employeeId)
    const responses = await Promise.all([
      routes.settlement.GET(req(`/api/hr/payroll/settlements/${settlementId}`), ctx(settlementId)),
      routes.settlements.GET(req('/api/hr/payroll/settlements?month=2026-08')),
      routes.baseSalaries.GET(req('/api/hr/payroll/base-salaries?employeeId=emp-a')),
      routes.settlement.PATCH(req(`/api/hr/payroll/settlements/${settlementId}`, 'PATCH', { expectedRevision: 1, action: 'reopen', reason: 'atak' }), ctx(settlementId)),
    ])
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403])
  })

  it('should return 401 without a session', async () => {
    as(null)
    const res = await routes.settlement.GET(req(`/api/hr/payroll/settlements/${settlementId}`), ctx(settlementId))
    expect(res.status).toBe(401)
  })

  it('should keep exactly one effective cost through a correction (no double counting)', async () => {
    as('ADMIN')
    await act(settlementId, { action: 'reopen', reason: 'Korekta premii po weryfikacji' })
    const whileReopened = await routes.contracts.getEffectivePayrollCosts(prisma, { year: 2026, month: 8 })
    await act(settlementId, { action: 'adjustment.add', kind: 'BONUS', label: 'Wyrównanie', amount: '50' })
    await act(settlementId, { action: 'payrollOffice.confirm', finalGross: '4 831,11', finalNet: '3 553,34', employerCost: '5 820,46' })
    await act(settlementId, { action: 'approve' })
    const afterCorrection = await routes.contracts.getEffectivePayrollCosts(prisma, { year: 2026, month: 8 })
    expect({
      reopened: whileReopened.map((c) => [c.sourceKey, c.versionNumber, c.employerCostGrosze]),
      corrected: afterCorrection.map((c) => [c.sourceKey, c.versionNumber, c.employerCostGrosze]),
    }).toEqual({
      reopened: [['payroll:emp-a:2026-08', 1, 576026]],
      corrected: [['payroll:emp-a:2026-08', 2, 582046]],
    })
  })

  it('should expose to the employee contract only their own statement without employer cost', async () => {
    const own = await routes.contracts.getOwnPayrollStatements(prisma, 'emp-a')
    const other = await routes.contracts.getOwnPayrollStatements(prisma, 'emp-b')
    expect([own.length, 'employerCostGrosze' in own[0], own[0].finalNetGrosze, other.length]).toEqual([1, false, 355334, 0])
  })

  it('should start a new month empty instead of copying amounts from a previous month', async () => {
    as('ADMIN')
    const res = await routes.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId: 'emp-a', month: '2026-09' }))
    const data = await detail((await res.json()).id)
    expect([data.finalGrossGrosze, data.finalNetGrosze, data.employerCostGrosze, data.adjustments.length]).toEqual([null, null, null, 0])
  })

  it('should refuse a future month', async () => {
    const res = await routes.settlements.POST(req('/api/hr/payroll/settlements', 'POST', { employeeId: 'emp-a', month: '2099-01' }))
    expect(res.status).toBe(400)
  })

  it('should revoke a base salary with a reason instead of deleting it', async () => {
    const res = await routes.revokeBase.POST(req(`/api/hr/payroll/base-salaries/${baseId}/revoke`, 'POST', { reason: 'Błędna data' }), ctx(baseId))
    const rows = await (await routes.baseSalaries.GET(req('/api/hr/payroll/base-salaries?employeeId=emp-a'))).json()
    expect([res.status, rows.length, rows[0].revokeReason]).toEqual([200, 1, 'Błędna data'])
  })
})

describe('payroll database guards', () => {
  // Raw SQL mirrors someone bypassing the API (e.g. sqlite3 on the server); Prisma surfaces the
  // same trigger aborts as P2003, which the API maps to 409.
  const raw = (sql: string) => prisma.$executeRawUnsafe(sql)

  it('should block updating an approved version directly in the database', async () => {
    await expect(raw(`UPDATE "PayrollSettlementVersion" SET "employerCostGrosze" = 1 WHERE "versionNumber" = 2`))
      .rejects.toThrow(/approved payroll versions are immutable/)
  })

  it('should block un-superseding an old version', async () => {
    await expect(raw(`UPDATE "PayrollSettlementVersion" SET "supersededAt" = NULL, "supersededByVersionId" = NULL WHERE "versionNumber" = 1`))
      .rejects.toThrow(/immutable/)
  })

  it('should block deleting approved versions', async () => {
    await expect(raw(`DELETE FROM "PayrollSettlementVersion"`)).rejects.toThrow(/cannot be deleted/)
  })

  it('should block tampering with the audit trail', async () => {
    await expect(raw(`UPDATE "PayrollAuditEvent" SET "reason" = 'zmienione'`)).rejects.toThrow(/append-only/)
  })

  it('should block deleting a settlement', async () => {
    await expect(raw(`DELETE FROM "PayrollSettlement"`)).rejects.toThrow(/cannot be deleted/)
  })

  it('should block editing an approved settlement in place', async () => {
    await expect(raw(`UPDATE "PayrollSettlement" SET "employerCostGrosze" = 1 WHERE "status" = 'APPROVED'`))
      .rejects.toThrow(/locked/)
  })

  it('should block a second effective version for the same employee-month', async () => {
    const effective = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { supersededAt: null, month: 8 } })
    const { id: _id, versionNumber, ...copy } = effective
    void _id
    await expect(prisma.payrollSettlementVersion.create({ data: { ...copy, versionNumber: versionNumber + 10 } }))
      .rejects.toThrow(/Unique constraint/)
  })

  it('should block adding an adjustment to an approved settlement through Prisma as well', async () => {
    const approved = await prisma.payrollSettlement.findFirstOrThrow({ where: { status: 'APPROVED' } })
    await expect(prisma.payrollAdjustment.create({
      data: { settlementId: approved.id, kind: 'BONUS', label: 'Obejście API', amountGrosze: 100, createdById: 'admin-1' },
    })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('should reject net above gross at the database level', async () => {
    const draft = await prisma.payrollSettlement.findFirstOrThrow({ where: { status: 'DRAFT' } })
    await expect(raw(`UPDATE "PayrollSettlement" SET "finalGrossGrosze" = 100, "finalNetGrosze" = 101 WHERE "id" = '${draft.id}'`))
      .rejects.toThrow(/CHECK constraint failed/)
  })
})
