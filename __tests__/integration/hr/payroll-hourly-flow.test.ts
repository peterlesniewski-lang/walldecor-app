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

// Stage 3 — hourly basis (D15–D19) and the pay reminder (D18) on a FRESH database built from the real
// migration chain. Hours go in through the real Czas pracy routes (batch entry, single approval).
// Every person and amount is synthetic test data.

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
const mockSession = vi.mocked(getServerSession)

const workspace = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-payroll-hourly-'))
const databaseUrl = `file:${path.join(directory, 'payroll-hourly.db')}`

type Modules = {
  sheet: typeof import('@/app/api/hr/payroll/sheet/route')
  approveHours: typeof import('@/app/api/hr/payroll/sheet/approve-hours/route')
  baseSalaries: typeof import('@/app/api/hr/payroll/base-salaries/route')
  settlement: typeof import('@/app/api/hr/payroll/settlements/[id]/route')
  approveEntry: typeof import('@/app/api/hr/time-tracking/[id]/approve/route')
  batch: typeof import('@/app/api/hr/time-tracking/batch/handler')
  scheduler: typeof import('@/lib/payroll/auto-carryover-scheduler')
  carryover: typeof import('@/lib/payroll/auto-carryover')
}

let prisma: PrismaClient
let m: Modules

const OCT = { year: 2026, month: 10 }
const UZ_RATES = DEFAULT_EMPLOYER_RATES.UZ

type Session_ = { id: string; role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'; employeeId: string | null }
const ADMIN: Session_ = { id: 'admin-1', role: 'ADMIN', employeeId: null }
let current: Session_ | null = ADMIN

function as(role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | null, id = 'admin-1', employeeId: string | null = null) {
  current = role ? { id, role, employeeId } : null
  mockSession.mockResolvedValue(current ? ({ user: current } as unknown as Session) : null)
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

type Row = {
  employee: { id: string }
  settlement: { id: string; status: string; revision: number } | null
  effectiveVersion: { versionNumber: number } | null
  suggestion: { kind: string; finalGrossGrosze: number; finalNetGrosze: number | null; employerCostGrosze: number | null; employerCostSource: string; sourceMonth: string | null } | null
  hours: {
    approvedMinutes: number
    pendingMinutes: number
    pendingEntries: number
    approvablePendingEntries: number
    openEntries: number
    calculation: { rateGrosze: number; approvedMinutes: number; grossGrosze: number } | null
  } | null
  flags: Array<{ code: string; message: string }>
  blockers: Array<{ code: string; message: string }>
  autoEligible: boolean
  changeAfterApproval: { changes: Array<{ code: string; message: string }> } | null
}

async function sheetRows(month: string): Promise<Row[]> {
  as('ADMIN')
  const res = await m.sheet.GET(req(`/api/hr/payroll/sheet?month=${month}`))
  expect(res.status).toBe(200)
  return (await res.json() as { rows: Row[] }).rows
}

async function sheetRow(month: string, employeeId: string): Promise<Row> {
  const found = (await sheetRows(month)).find((row) => row.employee.id === employeeId)
  if (!found) throw new Error(`no sheet row for ${employeeId}`)
  return found
}

type SubmitResult = { employeeId: string; status: string; versionNumber?: number; settlementId?: string; message?: string; blockers?: Array<{ code: string; message: string }> }

async function submit(month: string, rows: unknown[]): Promise<SubmitResult[]> {
  as('ADMIN')
  const res = await m.sheet.POST(req('/api/hr/payroll/sheet', 'POST', { month, rows }))
  expect(res.status).toBe(200)
  return (await res.json()).results
}

async function approveHours(employeeId: string, month = '2026-10') {
  return m.approveHours.POST(req('/api/hr/payroll/sheet/approve-hours', 'POST', { employeeId, month }))
}

/** Hours typed by the ADMIN in Czas pracy (the monthly employee grid posts exactly this). */
async function enterHours(employeeId: string, rows: Array<{ date: string; from: string; to: string; breakMinutes?: number }>) {
  as('ADMIN')
  const handler = m.batch.createTimeEntryBatchHandler({
    prisma,
    getSession: async () => (current ? ({ user: current } as unknown as Session) : null),
    getHrSettings: async () => ({ saturdayWorkable: true, standardClockIn: '11:00', standardClockOut: '19:00', overtimeThresholdMinutes: 480 }),
  })
  const res = await handler(req('/api/hr/time-tracking/batch', 'POST', {
    employeeId,
    rows: rows.map((row) => ({ date: row.date, clockIn: row.from, clockOut: row.to, breakMinutes: row.breakMinutes ?? 0 })),
  }))
  const json = await res.json() as { saved: Array<{ entryId: string; date: string }>; failed: unknown[] }
  expect([res.status, json.failed]).toEqual([200, []])
  return json.saved
}

async function approveEntry(id: string) {
  as('ADMIN')
  const res = await m.approveEntry.PATCH(req(`/api/hr/time-tracking/${id}/approve`, 'PATCH'), { params: Promise.resolve({ id }) })
  expect(res.status).toBe(200)
}

const notificationsOf = (userId: string) =>
  prisma.notification.findMany({ where: { userId, type: 'payroll_reminder' }, orderBy: { createdAt: 'asc' } })

// Warsaw: CEST (UTC+2) until 25.10.2026, CET (UTC+1) afterwards.
const SAT = '2026-10-10'

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
    approveHours: await import('@/app/api/hr/payroll/sheet/approve-hours/route'),
    baseSalaries: await import('@/app/api/hr/payroll/base-salaries/route'),
    settlement: await import('@/app/api/hr/payroll/settlements/[id]/route'),
    approveEntry: await import('@/app/api/hr/time-tracking/[id]/approve/route'),
    batch: await import('@/app/api/hr/time-tracking/batch/handler'),
    scheduler: await import('@/lib/payroll/auto-carryover-scheduler'),
    carryover: await import('@/lib/payroll/auto-carryover'),
  }

  await prisma.costCenter.createMany({ data: [{ id: 'JAG', name: 'Salon testowy JAG' }, { id: 'PUL', name: 'Salon testowy PUL' }] })
  const person = (id: string, lastName: string, extra: Record<string, unknown> = {}) => ({
    id, firstName: 'Testowa', lastName, email: `${id}@example.test`, position: 'Doradca (test)', costCenterId: 'JAG',
    startDate: new Date('2025-01-01T00:00:00Z'), employmentType: 'UZ', ...extra,
  })
  await prisma.employee.createMany({
    data: [
      person('h-main', 'Godzinowa'),
      person('h-none', 'Bezgodzinowa'),
      person('h-equal', 'Równa'),
      person('h-open', 'Otwarta'),
      person('m-ot', 'Etatowa', { employmentType: 'UoP' }),
    ],
  })
  await prisma.user.createMany({
    data: [
      { id: 'admin-1', name: 'Admin Testowy', email: 'admin-1@example.test', role: 'ADMIN', passwordHash: 'test-only' },
      { id: 'admin-2', name: 'Admin Drugi', email: 'admin-2@example.test', role: 'ADMIN', passwordHash: 'test-only' },
      { id: 'admin-off', name: 'Admin Zablokowany', email: 'admin-off@example.test', role: 'ADMIN', passwordHash: 'test-only', isActive: false },
      { id: 'manager-1', name: 'Kierownik Testowy', email: 'manager@example.test', role: 'MANAGER', passwordHash: 'test-only' },
      { id: 'user-h', name: 'Testowa Godzinowa', email: 'user-h@example.test', role: 'EMPLOYEE', passwordHash: 'test-only', employeeId: 'h-main' },
    ],
  })

  as('ADMIN')
  const base = async (employeeId: string, amount: string, basis = 'HOURLY_GROSS') => {
    const res = await m.baseSalaries.POST(req('/api/hr/payroll/base-salaries', 'POST', { employeeId, effectiveFrom: '2025-01-01', amount, basis }))
    expect(res.status).toBe(201)
  }
  await base('h-main', '50,00')
  await base('h-none', '40,00')
  await base('h-equal', '30,00')
  await base('h-open', '50,00')
  await base('m-ot', '5000,00', 'MONTHLY_GROSS')

  // September approved by hand (no hours in the calendar: amounts typed, as before stage 3).
  const september = await submit('2026-09', [
    { employeeId: 'h-main', finalGross: '4000,00', finalNet: '3200,00' },
    { employeeId: 'h-none', finalGross: '3000,00', finalNet: '2400,00' },
    { employeeId: 'h-equal', finalGross: '2000,00', finalNet: '2000,00' },
    { employeeId: 'h-open', finalGross: '4000,00', finalNet: '3200,00' },
    { employeeId: 'm-ot', finalGross: '5000,00', finalNet: '3600,00' },
  ])
  expect(september.filter((r) => r.status !== 'APPROVED')).toEqual([])
}, 180_000)

afterAll(async () => {
  await prisma?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('hourly basis — hours from Czas pracy', () => {
  let mainEntries: Array<{ entryId: string; date: string }> = []

  it('should let the ADMIN enter hours for a day that is still to come (D16)', async () => {
    // A real future day, relative to the clock running this test.
    const tomorrow = new Date(Date.now() + 36 * 3600_000).toISOString().slice(0, 10)
    const saved = await enterHours('h-equal', [{ date: tomorrow, from: `${tomorrow}T08:00:00Z`, to: `${tomorrow}T12:00:00Z` }])
    const stored = await prisma.timeEntry.findUnique({ where: { id: saved[0].entryId } })
    expect([saved.length, stored?.status, stored?.totalMinutes]).toEqual([1, 'pending', 240])
    await prisma.timeEntry.delete({ where: { id: saved[0].entryId } })
  })

  it('should show hours entered in Czas pracy as waiting and calculate gross from approved hours only', async () => {
    mainEntries = await enterHours('h-main', [
      { date: '2026-10-05', from: '2026-10-05T07:00:00Z', to: '2026-10-05T15:00:00Z' }, // 8 h
      { date: '2026-10-06', from: '2026-10-06T07:00:00Z', to: '2026-10-06T15:30:00Z', breakMinutes: 30 }, // 8 h
      { date: SAT, from: `${SAT}T08:00:00Z`, to: `${SAT}T12:00:00Z` }, // Saturday 4 h — all of it overtime
      { date: '2026-10-30', from: '2026-10-30T08:00:00Z', to: '2026-10-30T14:00:00Z' }, // 6 h, end of the month
    ])
    await approveEntry(mainEntries[0].entryId)
    const row = await sheetRow('2026-10', 'h-main')
    expect({
      hours: row.hours,
      gross: row.suggestion?.finalGrossGrosze,
      kind: row.suggestion?.kind,
      blockers: row.blockers.map((b) => b.code),
    }).toEqual({
      hours: {
        approvedMinutes: 480, pendingMinutes: 18 * 60, pendingEntries: 3, approvablePendingEntries: 3, openEntries: 0,
        calculation: { rateGrosze: 5000, approvedMinutes: 480, grossGrosze: 40000 },
      },
      gross: 40000,
      kind: 'HOURS',
      blockers: ['HOURLY_ENTRIES_PENDING'],
    })
  })

  it('should record the approver when Czas pracy approves one entry (shared approval logic)', async () => {
    const stored = await prisma.timeEntry.findUnique({ where: { id: mainEntries[0].entryId } })
    expect([stored?.status, stored?.approvedById]).toEqual(['approved', 'admin-1'])
  })

  it('should refuse to approve a person with waiting hours and leave no settlement behind', async () => {
    const [result] = await submit('2026-10', [{ employeeId: 'h-main', finalGross: '400,00', finalNet: '320,00' }])
    expect({
      status: result.status,
      blockers: result.blockers?.map((b) => b.message),
      settlements: await prisma.payrollSettlement.count({ where: { employeeId: 'h-main', ...OCT } }),
    }).toEqual({
      status: 'BLOCKED',
      blockers: ['Stawka godzinowa: w kalendarzu są niezatwierdzone wpisy czasu pracy.'],
      settlements: 0,
    })
  })

  it('should approve every waiting entry with "Zatwierdź godziny" and record the approver', async () => {
    as('ADMIN', 'admin-2')
    const res = await approveHours('h-main')
    const entries = await prisma.timeEntry.findMany({ where: { employeeId: 'h-main' }, orderBy: { date: 'asc' } })
    expect({
      status: res.status,
      cache: res.headers.get('Cache-Control'),
      body: await res.json(),
      entries: entries.map((e) => [e.status, e.approvedById]),
    }).toEqual({
      status: 200,
      cache: 'no-store, private',
      body: { month: '2026-10', employeeId: 'h-main', approved: 3, leftOpen: 0 },
      entries: [['approved', 'admin-1'], ['approved', 'admin-2'], ['approved', 'admin-2'], ['approved', 'admin-2']],
    })
  })

  it('should bring the waiting count to zero and make gross = approved hours × rate to the grosz', async () => {
    const row = await sheetRow('2026-10', 'h-main')
    // 8 + 8 + 4 (Saturday) + 6 = 26 h × 50,00 zł
    expect([row.hours?.approvedMinutes, row.hours?.pendingEntries, row.suggestion?.finalGrossGrosze, row.blockers]).toEqual([1560, 0, 130000, []])
  })

  it('should count the Saturday entry (automatic overtime) at the same rate without blocking', async () => {
    const saturday = await prisma.timeEntry.findFirst({ where: { employeeId: 'h-main', date: new Date(`${SAT}T00:00:00Z`) } })
    const row = await sheetRow('2026-10', 'h-main')
    expect([saturday?.overtimeMinutes, row.hours?.approvedMinutes, row.blockers]).toEqual([240, 1560, []])
  })

  it('should suggest the net from the last approved proportion (0,8) and calculate the cost from rates', async () => {
    const row = await sheetRow('2026-10', 'h-main')
    expect([row.suggestion?.finalNetGrosze, row.suggestion?.sourceMonth, row.suggestion?.employerCostGrosze, row.suggestion?.employerCostSource])
      .toEqual([104000, '2026-09', calculateEmployerCostGrosze(130000, UZ_RATES), 'CALCULATED'])
  })

  it('should suggest net equal to gross for a person whose net equalled gross', async () => {
    const saved = await enterHours('h-equal', [{ date: '2026-10-07', from: '2026-10-07T07:00:00Z', to: '2026-10-07T17:00:00Z' }]) // 10 h
    as('ADMIN')
    expect((await approveHours('h-equal')).status).toBe(200)
    const row = await sheetRow('2026-10', 'h-equal')
    expect([saved.length, row.suggestion?.finalGrossGrosze, row.suggestion?.finalNetGrosze]).toEqual([1, 30000, 30000])
  })

  it('should give a person without hours last month\'s amount and the warning "brak godzin — sprawdź kwotę" (D19)', async () => {
    const row = await sheetRow('2026-10', 'h-none')
    expect([row.suggestion?.kind, row.suggestion?.finalGrossGrosze, row.suggestion?.finalNetGrosze, row.flags.map((f) => f.message)])
      .toEqual(['PREVIOUS_MONTH', 300000, 240000, ['stawka godzinowa — sprawdź kwotę', 'brak godzin — sprawdź kwotę']])
  })

  it('should still require an overtime decision for a monthly salary (no regression)', async () => {
    const [entry] = await enterHours('m-ot', [{ date: '2026-10-05', from: '2026-10-05T06:00:00Z', to: '2026-10-05T16:00:00Z' }]) // 10 h → 2 h overtime
    await approveEntry(entry.entryId)
    const [result] = await submit('2026-10', [{ employeeId: 'm-ot', finalGross: '5000,00', finalNet: '3600,00' }])
    expect([result.status, result.blockers?.map((b) => b.code), await prisma.payrollSettlement.count({ where: { employeeId: 'm-ot', ...OCT } })])
      .toEqual(['BLOCKED', ['OVERTIME_UNRESOLVED'], 0])
  })

  it('should never preselect an hourly row, and the automat must skip it', async () => {
    const rows = (await sheetRows('2026-10')).filter((row) => row.employee.id.startsWith('h-'))
    const summary = await m.carryover.runPayrollAutoCarryover(prisma, OCT)
    const versions = await prisma.payrollSettlementVersion.count({ where: { employeeId: { startsWith: 'h-' }, ...OCT } })
    expect({
      autoEligible: rows.map((row) => row.autoEligible),
      approved: summary.approved.map((p) => p.employeeId),
      attention: summary.attention.map((p) => p.employeeId).filter((id) => id.startsWith('h-')).sort(),
      versions,
    }).toEqual({
      autoEligible: [false, false, false, false],
      approved: [],
      attention: ['h-equal', 'h-main', 'h-none', 'h-open'],
      versions: 0,
    })
  })

  it('should approve the person without hours by hand with last month\'s amount', async () => {
    const [result] = await submit('2026-10', [{ employeeId: 'h-none', finalGross: '3000,00', finalNet: '2400,00' }])
    expect([result.status, result.versionNumber]).toEqual(['APPROVED', 1])
  })

  it('should keep a manually changed gross over the calculation and record the approved hours in the history', async () => {
    const [result] = await submit('2026-10', [{ employeeId: 'h-main', finalGross: '1350,00', finalNet: '1040,00' }])
    const version = await prisma.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: 'h-main', ...OCT, supersededAt: null } })
    const approval = await prisma.payrollAuditEvent.findFirstOrThrow({ where: { settlementId: result.settlementId, action: 'settlement.approve' } })
    const after = JSON.parse(approval.afterJson ?? '{}')
    expect({
      status: result.status,
      gross: version.finalGrossGrosze,
      net: version.finalNetGrosze,
      workedMinutes: version.approvedWorkedMinutes,
      payout: version.payoutOvertimeMinutes,
      timeOff: version.timeOffOvertimeMinutes,
      history: [after.approvedWorkedMinutes, after.hourlyRateGrosze, after.finalGrossGrosze],
    }).toEqual({
      status: 'APPROVED', gross: 135000, net: 104000, workedMinutes: 1560, payout: 0, timeOff: 0,
      history: [1560, 5000, 135000],
    })
  })

  it('should show on the detail page a Saturday line without blockers or overtime to pay out', async () => {
    const id = (await prisma.payrollSettlement.findFirstOrThrow({ where: { employeeId: 'h-main', ...OCT } })).id
    as('ADMIN')
    const detail = await (await m.settlement.GET(req(`/api/hr/payroll/settlements/${id}`), { params: Promise.resolve({ id }) })).json()
    expect({
      lines: detail.overtimeLines.map((l: { date: string; isSaturday: boolean; overtimeMinutes: number }) => [l.date, l.isSaturday, l.overtimeMinutes]),
      blockers: detail.summary.approvalBlockers,
      payout: detail.summary.payoutOvertimeMinutes,
    }).toEqual({ lines: [[SAT, true, 240]], blockers: [], payout: 0 })
  })

  it('should label the approved row "zmiana po zatwierdzeniu" when the hours change afterwards', async () => {
    const [extra] = await enterHours('h-main', [{ date: '2026-10-08', from: '2026-10-08T07:00:00Z', to: '2026-10-08T11:00:00Z' }])
    expect((await sheetRow('2026-10', 'h-main')).changeAfterApproval).toBeNull() // waiting: pay unchanged yet
    await approveEntry(extra.entryId)
    const row = await sheetRow('2026-10', 'h-main')
    expect([row.settlement?.status, row.changeAfterApproval?.changes]).toEqual(['APPROVED', [{ code: 'HOURS', message: 'godziny' }]])
  })

  it('should leave an entry without a clock-out waiting, and keep blocking with a clear reason', async () => {
    await enterHours('h-open', [{ date: '2026-10-05', from: '2026-10-05T07:00:00Z', to: '2026-10-05T15:00:00Z' }])
    await prisma.timeEntry.create({
      data: { employeeId: 'h-open', date: new Date('2026-10-06T00:00:00Z'), clockIn: new Date('2026-10-06T07:00:00Z'), status: 'pending' },
    })
    as('ADMIN')
    const body = await (await approveHours('h-open')).json()
    const row = await sheetRow('2026-10', 'h-open')
    const [result] = await submit('2026-10', [{ employeeId: 'h-open', finalGross: '400,00', finalNet: '320,00' }])
    expect({
      body,
      hours: [row.hours?.approvedMinutes, row.hours?.pendingEntries, row.hours?.approvablePendingEntries, row.hours?.openEntries],
      blockers: row.blockers.map((b) => b.message),
      result: result.status,
      settlements: await prisma.payrollSettlement.count({ where: { employeeId: 'h-open', ...OCT } }),
    }).toEqual({
      body: { month: '2026-10', employeeId: 'h-open', approved: 1, leftOpen: 1 },
      hours: [480, 1, 0, 1],
      blockers: [
        'Stawka godzinowa: w kalendarzu są niezatwierdzone wpisy czasu pracy.',
        'W kalendarzu jest otwarty wpis (brak wyjścia).',
      ],
      result: 'BLOCKED',
      settlements: 0,
    })
  })
})

describe('"Zatwierdź godziny" — access and validation', () => {
  it.each([
    ['MANAGER', 'manager-1', null],
    ['EMPLOYEE', 'user-h', 'h-main'],
  ] as const)('should refuse %s with 403 and change no entry', async (role, id, employeeId) => {
    const [entry] = await enterHours('h-equal', [{ date: `2026-10-1${role === 'MANAGER' ? 2 : 3}`, from: `2026-10-1${role === 'MANAGER' ? 2 : 3}T07:00:00Z`, to: `2026-10-1${role === 'MANAGER' ? 2 : 3}T09:00:00Z` }])
    as(role, id, employeeId)
    const res = await approveHours('h-equal')
    const stored = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.entryId } })
    expect([res.status, stored.status]).toEqual([403, 'pending'])
  })

  it('should answer 401 without a session', async () => {
    as(null)
    expect((await approveHours('h-equal')).status).toBe(401)
  })

  it.each([
    ['an unknown field', { employeeId: 'h-equal', month: '2026-10', all: true }],
    ['a malformed month', { employeeId: 'h-equal', month: '2026-13' }],
  ])('should reject %s with 400', async (_label, body) => {
    as('ADMIN')
    const res = await m.approveHours.POST(req('/api/hr/payroll/sheet/approve-hours', 'POST', body))
    expect(res.status).toBe(400)
  })

  it('should refuse a person on a monthly salary', async () => {
    as('ADMIN')
    const res = await approveHours('m-ot')
    expect([res.status, (await res.json()).error]).toEqual([400, 'Zatwierdzanie godzin z listy płac dotyczy tylko osób na stawce godzinowej.'])
  })
})

describe('pay reminder before the last working day (D18)', () => {
  const tick = (iso: string, db: PrismaClient = prisma) => m.scheduler.runDuePayrollAutomation(db, new Date(iso))

  it('should send nothing when everyone is approved (September), with the automat switched off', async () => {
    const enabled = await prisma.appSetting.findUnique({ where: { key: 'payroll_auto_carryover_enabled' } })
    const result = await tick('2026-09-28T06:30:00Z') // 08:30 in Warsaw, the reminder day (30.09 is a Wednesday)
    expect([enabled?.value ?? null, result.payReminder, (await notificationsOf('admin-1')).length])
      .toEqual([null, { ran: true, month: '2026-09', unapproved: 0, notified: 0 }, 0])
  })

  it('should not remind before the reminder day', async () => {
    expect((await tick('2026-10-27T10:00:00Z')).payReminder).toEqual({ ran: false })
  })

  it('should notify every active ADMIN once on the reminder day, with the count and the last working day', async () => {
    const unapproved = (await sheetRows('2026-10')).filter((row) => row.effectiveVersion === null).map((row) => row.employee.id)
    const result = await tick('2026-10-28T07:30:00Z') // 08:30 in Warsaw (CET); last working day: Friday 30.10
    const [admin1, admin2, off, manager, employee] = await Promise.all(['admin-1', 'admin-2', 'admin-off', 'manager-1', 'user-h'].map(notificationsOf))
    expect({
      unapproved: unapproved.sort(),
      result: result.payReminder,
      counts: [admin1.length, admin2.length, off.length, manager.length, employee.length],
      title: admin1[0]?.title,
      link: admin1[0]?.link,
      message: admin1[0]?.message,
    }).toEqual({
      unapproved: ['h-equal', 'h-open', 'm-ot'],
      result: { ran: true, month: '2026-10', unapproved: 3, notified: 2 },
      counts: [1, 1, 0, 0, 0],
      title: 'Wynagrodzenia za październik: 3 osoby bez zatwierdzonego rozliczenia, wypłata do 30.10',
      link: '/hr/payroll?month=2026-10',
      message: 'Do zatwierdzenia: Etatowa Testowa; Otwarta Testowa (stawka godzinowa); Równa Testowa (stawka godzinowa).',
    })
  })

  it('should not send a second reminder for the same month', async () => {
    const result = await tick('2026-10-29T09:00:00Z')
    expect([result.payReminder, (await notificationsOf('admin-1')).length]).toEqual([{ ran: false }, 1])
  })

  it('should release the month when sending fails, send nothing, and succeed at the next check', async () => {
    // The database refuses the notification insert (the last step of sending).
    const failing = new Proxy(prisma, {
      get(target, property) {
        if (property === 'notification') return { createMany: () => Promise.reject(new Error('database is locked')) }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const failed = await tick('2026-11-26T08:00:00Z', failing) // 09:00 in Warsaw; 30.11 is a Monday
    const slotAfterFailure = await prisma.appSetting.findUnique({ where: { key: 'payroll_pay_reminder_last_month' } })
    const afterFailure = (await notificationsOf('admin-1')).length
    const retried = await tick('2026-11-26T08:05:00Z')
    expect({
      failed: failed.payReminder,
      slotAfterFailure: slotAfterFailure?.value,
      afterFailure,
      retried: retried.payReminder.ran,
      titles: (await notificationsOf('admin-1')).map((n) => n.title),
    }).toEqual({
      failed: { ran: false, reason: 'FAILED', month: '2026-11', message: 'database is locked' },
      slotAfterFailure: '2026-10',
      afterFailure: 1,
      retried: true,
      titles: [
        'Wynagrodzenia za październik: 3 osoby bez zatwierdzonego rozliczenia, wypłata do 30.10',
        'Wynagrodzenia za listopad: 5 osób bez zatwierdzonego rozliczenia, wypłata do 30.11',
      ],
    })
  })
})
