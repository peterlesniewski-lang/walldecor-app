// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { executeCashierCommand, readCashierBootstrap } from '@/lib/cashier/service'
import { MAX_MONEY_CENTS, type CashierCommand, type CashierCenterId } from '@/lib/cashier/contracts'
import { createCashierHandlers } from '@/lib/cashier/http'
import { assertAccountCanBeDeactivated, cashierTransaction } from '@/lib/cashier/ledger'
import { NextRequest } from 'next/server'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-cashier-test-'))
const url = `file:${path.join(directory, 'cashier.db')}`
const db = new PrismaClient({ datasources: { db: { url } } })
const now = new Date('2026-09-10T10:00:00.000Z')
const run = (command: CashierCommand, userId = 'admin') => executeCashierCommand(db, userId, command, now)
const view = (costCenterId: CashierCenterId = 'PUL', userId = 'admin', reportId?: string) => readCashierBootstrap(db, userId, { costCenterId, reportId }, now)

beforeAll(async () => {
  const created = spawnSync('sqlite3', [path.join(directory, 'cashier.db'), 'VACUUM;'], { encoding: 'utf8' })
  if (created.status !== 0) throw new Error(`Temporary SQLite creation failed: ${created.stderr}`)
  const result = spawnSync(process.execPath, ['--preserve-symlinks', 'node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`Temporary schema setup failed: ${result.stderr || result.stdout}`)
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "CashDailyReport_one_draft_per_salon" ON "CashDailyReport"("costCenterId") WHERE "status" = 'DRAFT'`)
  await db.$queryRawUnsafe('PRAGMA journal_mode = WAL')
}, 30_000)

beforeEach(async () => {
  await db.$transaction([
    db.cashierAuditLog.deleteMany(), db.cashDailyOperation.deleteMany(), db.cashDeposit.deleteMany(),
    db.cashDailyReport.deleteMany(), db.salonCashSettings.deleteMany(), db.cashBalanceHistory.deleteMany(),
    db.cashAccount.deleteMany(), db.user.deleteMany(), db.employee.deleteMany(), db.costCenter.deleteMany(),
  ])
  await db.costCenter.createMany({ data: [{ id: 'PUL', name: 'Puławska' }, { id: 'JAG', name: 'Jagiellońska' }, { id: 'GLOBAL', name: 'Global' }] })
  for (const center of ['PUL', 'JAG', 'GLOBAL']) {
    await db.employee.create({ data: { id: `employee-${center}`, firstName: 'Jan', lastName: center, email: `${center}@employee.test`, position: 'Sprzedawca', costCenterId: center, startDate: now } })
  }
  await db.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.test', name: 'Admin', passwordHash: 'test', role: 'ADMIN' },
    { id: 'manager', email: 'manager@example.test', name: 'Manager', passwordHash: 'test', role: 'MANAGER' },
    { id: 'orphan', email: 'orphan@example.test', name: 'Orphan', passwordHash: 'test', role: 'EMPLOYEE' },
    ...['PUL', 'JAG', 'GLOBAL'].map((center) => ({ id: `user-${center}`, email: `${center}@example.test`, name: center, passwordHash: 'test', role: 'EMPLOYEE', employeeId: `employee-${center}` })),
  ] })
  await db.cashAccount.createMany({ data: [
    { id: 'cash-PUL', name: 'Gotówka PUL', currency: 'PLN', type: 'cash', balance: 270 },
    { id: 'cash-JAG', name: 'Gotówka JAG', currency: 'PLN', type: 'cash', balance: 270 },
    { id: 'owner', name: 'Sejf właściciela', currency: 'PLN', type: 'cash', balance: 100 },
    { id: 'bank', name: 'Bank', currency: 'PLN', type: 'bank', balance: 270 },
  ] })
})

afterAll(async () => {
  await db.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

async function setup(costCenterId: CashierCenterId = 'PUL') {
  return run({ action: 'setup', costCenterId, cashAccountId: `cash-${costCenterId}`, startDate: '2026-09-01', initialCashCents: 27000, targetFloatCents: 27000, sourceReportConfirmed: true })
}

async function createDay(businessDate = '2026-09-09', costCenterId: CashierCenterId = 'PUL') {
  const result = await run({ action: 'createReport', costCenterId, businessDate }, `user-${costCenterId}`)
  return (await view(costCenterId, 'admin', result.reportId)).selectedReport!
}

async function prepareExample() {
  await setup()
  const report = await createDay()
  await run({ action: 'updateReport', costCenterId: 'PUL', reportId: report.id, version: report.version, cashReceiptsCents: 150000, cardReceiptsCents: 300000, countedCents: 167000 }, 'user-PUL')
  for (const operation of [
    { kind: 'SALES_REFUND', method: 'CASH', amountCents: 20000, reference: 'ZW/1' },
    { kind: 'DEPOSIT_IN', method: 'CASH', amountCents: 10000, reference: 'KA/1' },
    { kind: 'SALES_REFUND', method: 'CARD', amountCents: 30000, reference: 'ZW/2' },
  ] as const) {
    const current = (await view()).selectedReport!
    await run({ action: 'addOperation', costCenterId: 'PUL', reportId: report.id, version: current.version, ...operation }, 'user-PUL')
  }
  return (await view()).selectedReport!
}

async function closeExample() {
  const report = await prepareExample()
  const command: CashierCommand = { action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: report.version, requestId: 'example-close-request', retainedConfirmed: true, depositConfirmed: true }
  await run(command, 'user-PUL')
  return { report: (await view()).selectedReport!, command }
}

describe('cashier actor and setup on actual SQLite', () => {
  it('denies anonymous, missing, manager, unlinked and GLOBAL users before returning data', async () => {
    await expect(readCashierBootstrap(db, null, {}, now)).rejects.toMatchObject({ status: 401 })
    for (const userId of ['missing', 'manager', 'orphan', 'user-GLOBAL']) {
      await expect(readCashierBootstrap(db, userId, {}, now)).rejects.toMatchObject({ status: 403 })
    }
  })

  it('resolves current employee activity and salon on every request', async () => {
    await setup()
    const own = await view('PUL', 'user-PUL')
    expect(own.centers.map((center) => center.id)).toEqual(['PUL'])
    expect(own.accounts).toEqual([])
    await expect(view('JAG', 'user-PUL')).rejects.toMatchObject({ status: 403 })
    await db.employee.update({ where: { id: 'employee-PUL' }, data: { active: false } })
    await expect(view('PUL', 'user-PUL')).rejects.toMatchObject({ status: 403 })
    await db.employee.update({ where: { id: 'employee-PUL' }, data: { active: true, costCenterId: 'JAG' } })
    await expect(view('PUL', 'user-PUL')).rejects.toMatchObject({ status: 403 })
    expect((await view('JAG', 'user-PUL')).actor.costCenterId).toBe('JAG')
  })

  it('does not trust stale admin identity after role change or deactivation', async () => {
    await db.user.update({ where: { id: 'admin' }, data: { role: 'MANAGER' } })
    await expect(setup()).rejects.toMatchObject({ status: 403 })
    await db.user.update({ where: { id: 'admin' }, data: { role: 'ADMIN', isActive: false } })
    await expect(setup()).rejects.toMatchObject({ status: 403 })
  })

  it('denies a password-change-required account and revoked employee role', async () => {
    await db.user.update({ where: { id: 'user-PUL' }, data: { mustChangePassword: true } })
    await expect(view('PUL', 'user-PUL')).rejects.toMatchObject({ status: 403 })
    await db.user.update({ where: { id: 'user-PUL' }, data: { mustChangePassword: false, role: 'MANAGER' } })
    await expect(view('PUL', 'user-PUL')).rejects.toMatchObject({ status: 403 })
  })

  it('requires matching existing balance, active PLN cash and unique salon mapping', async () => {
    const command = { action: 'setup', costCenterId: 'PUL', cashAccountId: 'cash-PUL', startDate: '2026-09-01', initialCashCents: 27000, targetFloatCents: 27000, sourceReportConfirmed: true } as const
    await expect(run({ ...command, initialCashCents: 30000 })).rejects.toMatchObject({ status: 409 })
    await expect(run({ ...command, cashAccountId: 'bank' })).rejects.toMatchObject({ status: 400 })
    await expect(run(command, 'user-PUL')).rejects.toMatchObject({ status: 403 })
    await run(command)
    await expect(run({ ...command, costCenterId: 'JAG' })).rejects.toMatchObject({ status: 409 })
    expect(await db.cashAccount.findUniqueOrThrow({ where: { id: 'cash-PUL' } })).toMatchObject({ balance: 270 })
    expect(await db.cashierAuditLog.count()).toBeGreaterThan(0)
  })

  it('creates a new mapped cash account only with explicit no-duplicate confirmation', async () => {
    await run({ action: 'setup', costCenterId: 'PUL', newAccountName: 'Nowa kasa', noDuplicateCashConfirmed: true, sourceReportConfirmed: true, startDate: '2026-09-01', initialCashCents: 27000, targetFloatCents: 30000 })
    const state = await view()
    expect(state.settings).toMatchObject({ cashAccountName: 'Nowa kasa', balanceCents: 27000, targetFloatCents: 30000 })
    expect(await db.cashBalanceHistory.count()).toBe(1)
  })
})

describe('daily drafts, operations and chronology', () => {
  it('returns the current open report independently of the historical date filter', async () => {
    await setup()
    const report = await createDay('2026-09-10')
    const historical = await readCashierBootstrap(db, 'admin', { costCenterId: 'PUL', from: '2026-09-01', to: '2026-09-09' }, now)
    expect(historical.reports).toEqual([])
    expect(historical.selectedReport).toBeNull()
    expect(historical.openReport).toMatchObject({ id: report.id, businessDate: '2026-09-10', status: 'DRAFT', targetFloatCents: 27000 })
  })

  it('allows only chronological dates from setup through Warsaw today and one draft per salon', async () => {
    await setup()
    for (const businessDate of ['2026-08-31', '2026-09-11']) {
      await expect(createDay(businessDate)).rejects.toMatchObject({ status: 400 })
    }
    const day = await createDay()
    expect(day.openingCents).toBe(27000)
    expect(day.cashReceiptsCents).toBeNull()
    await expect(createDay('2026-09-10')).rejects.toMatchObject({ status: 409 })
    expect(await db.cashDailyReport.count()).toBe(1)
  })

  it('prevents report-id and operation-id cross-salon access', async () => {
    await setup()
    await setup('JAG')
    const report = await createDay()
    await expect(view('JAG', 'user-JAG', report.id)).rejects.toMatchObject({ status: 404 })
    await expect(run({ action: 'updateReport', costCenterId: 'JAG', reportId: report.id, version: 1, countedCents: 0 }, 'user-JAG')).rejects.toMatchObject({ status: 404 })
    expect((await view()).selectedReport!.version).toBe(1)
  })

  it('edits and soft-cancels an operation once, preserving original values in audit and rejecting stale report versions', async () => {
    await setup()
    const report = await createDay()
    await run({ action: 'addOperation', costCenterId: 'PUL', reportId: report.id, version: 1, kind: 'DEPOSIT_IN', method: 'CASH', amountCents: 10000, reference: 'KA/1' }, 'user-PUL')
    let current = (await view()).selectedReport!
    await expect(run({ action: 'updateReport', costCenterId: 'PUL', reportId: report.id, version: 1, cashReceiptsCents: 10 }, 'user-PUL')).rejects.toMatchObject({ status: 409 })
    await run({ action: 'updateOperation', costCenterId: 'PUL', reportId: report.id, operationId: current.operations[0].id, version: current.version, kind: 'DEPOSIT_IN', method: 'CASH', amountCents: 12000, reference: 'KA/2' }, 'user-PUL')
    current = (await view()).selectedReport!
    await run({ action: 'cancelOperation', costCenterId: 'PUL', reportId: report.id, operationId: current.operations[0].id, version: current.version, reason: 'Błędny dokument' }, 'user-PUL')
    current = (await view()).selectedReport!
    expect(current.operations).toHaveLength(1)
    expect(current.operations[0].cancelledAt).not.toBeNull()
    expect(await db.cashDailyOperation.count()).toBe(1)
    const audit = await db.cashierAuditLog.findMany({ where: { entityId: current.operations[0].id }, orderBy: { createdAt: 'asc' } })
    expect(audit.length).toBe(3)
    expect(audit.some((entry) => entry.beforeJson?.includes('10000'))).toBe(true)
  })

  it('changing the float target keeps opening and counted cash, changes deposit and invalidates an open report version', async () => {
    let report = await prepareExample()
    const oldVersion = report.version
    await run({ action: 'setTarget', costCenterId: 'PUL', version: 1, targetFloatCents: 30000, reason: 'Więcej reszty' })
    report = (await view()).selectedReport!
    expect(report).toMatchObject({ openingCents: 27000, countedCents: 167000, expectedCents: 167000, differenceCents: 0, targetFloatCents: 30000, depositCents: 137000, retainedCents: 30000, version: oldVersion + 1 })
    await expect(run({ action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: oldVersion, requestId: 'stale-close-target', retainedConfirmed: true, depositConfirmed: true })).rejects.toMatchObject({ status: 409 })
    await run({ action: 'setTarget', costCenterId: 'PUL', version: 2, targetFloatCents: 25000, reason: 'Mniej reszty' })
    expect((await view()).selectedReport).toMatchObject({ depositCents: 142000, retainedCents: 25000, differenceCents: 0 })
  })
})

describe('complete and date-filtered audit history', () => {
  it('filters before pagination and allows every same-day entry beyond the first hundred', async () => {
    const audit = (id: string, createdAt: string, costCenterId = 'PUL', entityType = 'REPORT') => ({
      id, costCenterId, entityType, entityId: id, action: 'UPDATE', actorId: 'admin', actorName: 'Admin', afterJson: '{}', createdAt: new Date(createdAt),
    })
    await db.cashierAuditLog.createMany({ data: [
      audit('old-history', '2026-09-07T21:59:59.999Z'),
      ...Array.from({ length: 105 }, (_, i) => audit(`day-${String(i).padStart(3, '0')}`, '2026-09-08T12:00:00.000Z')),
      audit('day-first', '2026-09-07T22:00:00.000Z'),
      audit('day-last', '2026-09-08T21:59:59.999Z'),
      audit('next-day', '2026-09-08T22:00:00.000Z'),
      audit('other-salon', '2026-09-08T12:00:00.000Z', 'JAG'),
      audit('private-owner-account', '2026-09-08T12:00:00.000Z', 'PUL', 'CASH_ACCOUNT'),
    ] })
    const filter = { costCenterId: 'PUL', from: '2026-09-08', to: '2026-09-08' }
    const first = await readCashierBootstrap(db, 'user-PUL', filter, now)
    expect(first).toMatchObject({ auditPage: 1, auditHasMore: true })
    expect(first.audit).toHaveLength(100)
    expect(first.audit[0].id).toBe('day-last')
    const second = await readCashierBootstrap(db, 'user-PUL', { ...filter, auditPage: '2' }, now)
    expect(second).toMatchObject({ auditPage: 2, auditHasMore: false })
    expect(second.audit).toHaveLength(7)
    expect(second.audit.at(-1)?.id).toBe('day-first')
    expect(new Set([...first.audit, ...second.audit].map((entry) => entry.id)).size).toBe(107)
    const older = await readCashierBootstrap(db, 'user-PUL', { costCenterId: 'PUL', from: '2026-09-07', to: '2026-09-07' }, now)
    expect(older.audit.map((entry) => entry.id)).toEqual(['old-history'])
    const beyond = await readCashierBootstrap(db, 'user-PUL', { ...filter, auditPage: '3' }, now)
    expect(beyond).toMatchObject({ audit: [], auditPage: 3, auditHasMore: false })
  })

  it.each([
    ['2026-03-29', '2026-03-28T23:00:00.000Z', '2026-03-29T21:59:59.999Z'],
    ['2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T22:59:59.999Z'],
  ])('uses the inclusive Warsaw day %s despite a daylight-saving offset change', async (day, start, end) => {
    await db.cashierAuditLog.createMany({ data: [
      { id: 'before', createdAt: new Date(new Date(start).getTime() - 1) },
      { id: 'first', createdAt: new Date(start) },
      { id: 'last', createdAt: new Date(end) },
      { id: 'after', createdAt: new Date(new Date(end).getTime() + 1) },
    ].map((entry) => ({ ...entry, costCenterId: 'PUL', entityType: 'REPORT', entityId: 'report', action: 'UPDATE', actorId: 'admin', actorName: 'Admin', afterJson: '{}' })) })
    const state = await readCashierBootstrap(db, 'admin', { costCenterId: 'PUL', from: day, to: day }, now)
    expect(state.audit.map((entry) => entry.id)).toEqual(['last', 'first'])
  })
})

describe('close, corrections and cash transfers', () => {
  it('closes once, updates managed account once, and starts the next day from retained cash', async () => {
    const { report, command } = await closeExample()
    expect(report).toMatchObject({ status: 'CLOSED', expectedCents: 167000, retainedCents: 27000, depositCents: 140000 })
    expect(report.deposit).toMatchObject({ status: 'WAITING', declaredCents: 140000 })
    expect((await view()).settings?.balanceCents).toBe(167000)
    expect(await run(command, 'user-PUL')).toMatchObject({ replayed: true })
    expect(await db.cashDeposit.count()).toBe(1)
    expect(await db.cashBalanceHistory.count()).toBe(1)
    expect((await createDay('2026-09-10')).openingCents).toBe(27000)
    expect((await view()).waitingDepositsCents).toBe(140000)
  })

  it('requires explicit zero sales and counted cash, and explanation for shortage', async () => {
    await setup()
    let report = await createDay()
    const close = () => run({ action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: report.version, requestId: 'close-zero-shortage', retainedConfirmed: true, depositConfirmed: true }, 'user-PUL')
    await expect(close()).rejects.toMatchObject({ status: 400 })
    await run({ action: 'updateReport', costCenterId: 'PUL', reportId: report.id, version: 1, cashReceiptsCents: 0, cardReceiptsCents: 0, countedCents: 20000 }, 'user-PUL')
    report = (await view()).selectedReport!
    await expect(close()).rejects.toMatchObject({ status: 400 })
    await run({ action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: report.version, requestId: 'close-zero-shortage', retainedConfirmed: true, depositConfirmed: true, reason: 'Brak 70 zł podczas liczenia' }, 'user-PUL')
    expect((await view()).selectedReport).toMatchObject({ retainedCents: 20000, depositCents: 0, shortfallCents: 7000, differenceCents: -7000, deposit: null })
    expect((await createDay('2026-09-10')).openingCents).toBe(20000)
  })

  it('corrects only the last closed report before the next report and updates its account/deposit atomically', async () => {
    const { report } = await closeExample()
    const correction = { action: 'correctReport', costCenterId: 'PUL', reportId: report.id, version: report.version, cashReceiptsCents: 160000, cardReceiptsCents: 300000, countedCents: 177000, retainedConfirmed: true, depositConfirmed: true, reason: 'Poprawiony raport źródłowy' } as const
    await expect(run(correction, 'user-PUL')).rejects.toMatchObject({ status: 403 })
    await run(correction)
    expect((await view()).settings?.balanceCents).toBe(177000)
    const changed = (await view()).selectedReport!
    expect(changed.deposit?.declaredCents).toBe(150000)
    await createDay('2026-09-10')
    await expect(run({ ...correction, version: changed.version })).rejects.toMatchObject({ status: 409 })
  })

  it('records a zero-deposit correction as VOID without deleting the envelope', async () => {
    const { report } = await closeExample()
    await run({ action: 'correctReport', costCenterId: 'PUL', reportId: report.id, version: report.version, cashReceiptsCents: 10000, cardReceiptsCents: 300000, countedCents: 27000, retainedConfirmed: true, depositConfirmed: true, reason: 'Błędna kwota wpływów' })
    expect((await view()).selectedReport?.deposit).toMatchObject({ id: report.deposit!.id, status: 'VOID' })
    expect((await view()).settings?.balanceCents).toBe(27000)
    expect(await db.cashDeposit.count()).toBe(1)
  })

  it('receives sealed cash separately, preserves company total and applies only the verified difference once', async () => {
    const { report } = await closeExample()
    const deposit = report.deposit!
    const receive = { action: 'receiveDeposit', costCenterId: 'PUL', depositId: deposit.id, version: deposit.version, destinationAccountId: 'owner', physicalReceiptConfirmed: true } as const
    await expect(run(receive, 'user-PUL')).rejects.toMatchObject({ status: 403 })
    await run(receive)
    expect(await run(receive)).toMatchObject({ replayed: true })
    expect((await db.cashAccount.findUniqueOrThrow({ where: { id: 'cash-PUL' } })).balance).toBe(270)
    expect((await db.cashAccount.findUniqueOrThrow({ where: { id: 'owner' } })).balance).toBe(1500)
    let current = (await view()).selectedReport!.deposit!
    expect(current).toMatchObject({ status: 'RECEIVED', actualCents: null })
    const verify = { action: 'verifyDeposit', costCenterId: 'PUL', depositId: deposit.id, version: current.version, actualCents: 139000, countedConfirmed: true, reason: 'Brak 10 zł po przeliczeniu' } as const
    await run(verify)
    expect(await run(verify)).toMatchObject({ replayed: true })
    current = (await view()).selectedReport!.deposit!
    expect(current).toMatchObject({ status: 'DISCREPANCY', actualCents: 139000 })
    expect((await db.cashAccount.findUniqueOrThrow({ where: { id: 'owner' } })).balance).toBe(1490)
    await expect(run({ ...verify, actualCents: 140000 })).rejects.toMatchObject({ status: 409 })
    const employeeView = await view('PUL', 'user-PUL')
    expect(employeeView.audit.some((entry) => entry.entityId === 'owner')).toBe(false)
  })

  it('preserves an active destination until received deposits are verified, then allows deactivation', async () => {
    const { report } = await closeExample()
    const deposit = report.deposit!
    await run({ action: 'receiveDeposit', costCenterId: 'PUL', depositId: deposit.id, version: deposit.version, destinationAccountId: 'owner', physicalReceiptConfirmed: true })
    const deactivate = () => cashierTransaction(db, async (tx) => {
      await assertAccountCanBeDeactivated(tx, 'owner')
      await tx.cashAccount.update({ where: { id: 'owner' }, data: { isActive: false } })
    })
    await expect(deactivate()).rejects.toMatchObject({ status: 409, code: 'ACCOUNT_HAS_UNVERIFIED_DEPOSITS' })
    expect((await db.cashAccount.findUniqueOrThrow({ where: { id: 'owner' } })).isActive).toBe(true)
    const received = (await view()).selectedReport!.deposit!
    await run({ action: 'verifyDeposit', costCenterId: 'PUL', depositId: received.id, version: received.version, actualCents: received.declaredCents, countedConfirmed: true })
    await deactivate()
    expect((await db.cashAccount.findUniqueOrThrow({ where: { id: 'owner' } })).isActive).toBe(false)
  })

  it('blocks receiving to a salon-managed or non-cash account and corrections after pickup', async () => {
    const { report } = await closeExample()
    await setup('JAG')
    const deposit = report.deposit!
    const receive = { action: 'receiveDeposit', costCenterId: 'PUL', depositId: deposit.id, version: deposit.version, destinationAccountId: 'cash-JAG', physicalReceiptConfirmed: true } as const
    await expect(run(receive)).rejects.toMatchObject({ status: 409 })
    await expect(run({ ...receive, destinationAccountId: 'bank' })).rejects.toMatchObject({ status: 400 })
    await run({ ...receive, destinationAccountId: 'owner' })
    await expect(run({ action: 'correctReport', costCenterId: 'PUL', reportId: report.id, version: report.version, cashReceiptsCents: 150000, cardReceiptsCents: 300000, countedCents: 167000, retainedConfirmed: true, depositConfirmed: true, reason: 'Za późna korekta' })).rejects.toMatchObject({ status: 409 })
  })

  it('rolls back close and all balance/history/deposit changes when immutable audit cannot be written', async () => {
    const report = await prepareExample()
    const countsBefore = { logs: await db.cashierAuditLog.count(), history: await db.cashBalanceHistory.count() }
    await db.$executeRawUnsafe(`CREATE TRIGGER "cashier_test_reject_audit" BEFORE INSERT ON "CashierAuditLog" BEGIN SELECT RAISE(ABORT, 'test audit unavailable'); END`)
    try {
      await expect(run({ action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: report.version, requestId: 'close-audit-failure', retainedConfirmed: true, depositConfirmed: true })).rejects.toThrow()
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER "cashier_test_reject_audit"')
    }
    expect((await view()).selectedReport).toMatchObject({ status: 'DRAFT', version: report.version })
    expect((await view()).settings?.balanceCents).toBe(27000)
    expect(await db.cashDeposit.count()).toBe(0)
    expect(await db.cashierAuditLog.count()).toBe(countsBefore.logs)
    expect(await db.cashBalanceHistory.count()).toBe(countsBefore.history)
  })

  it('rejects aggregate cents overflow without changing a draft or account', async () => {
    await setup()
    const report = await createDay()
    await expect(run({ action: 'updateReport', costCenterId: 'PUL', reportId: report.id, version: 1, cashReceiptsCents: MAX_MONEY_CENTS, cardReceiptsCents: 0, countedCents: 0 })).rejects.toMatchObject({ status: 400 })
    expect((await view()).selectedReport?.version).toBe(1)
    expect((await view()).settings?.balanceCents).toBe(27000)
  })

  it('reactivates the same VOID deposit by a later permitted correction, preserving audit and uniqueness', async () => {
    const { report } = await closeExample()
    const correction = { action: 'correctReport', costCenterId: 'PUL', reportId: report.id, version: report.version, cashReceiptsCents: 10000, cardReceiptsCents: 300000, countedCents: 27000, retainedConfirmed: true, depositConfirmed: true, reason: 'Pierwsza korekta' } as const
    await run(correction)
    const voided = (await view()).selectedReport!
    expect(voided.canCorrect).toBe(true)
    await run({ ...correction, version: voided.version, cashReceiptsCents: 150000, countedCents: 167000, reason: 'Uzupełniony raport źródłowy' })
    const restored = (await view()).selectedReport!
    expect(restored.deposit).toMatchObject({ id: report.deposit!.id, status: 'WAITING', declaredCents: 140000, version: 3 })
    expect(await db.cashDeposit.count()).toBe(1)
    expect((await view()).settings?.balanceCents).toBe(167000)
  })

  it('does not rewrite a closed report when the next target is changed', async () => {
    const { report } = await closeExample()
    await run({ action: 'setTarget', costCenterId: 'PUL', version: 1, targetFloatCents: 50000, reason: 'Nowy zapas reszty' })
    expect((await view()).selectedReport).toMatchObject({ version: report.version, targetFloatCents: 27000, depositCents: 140000 })
    expect(await createDay('2026-09-10')).toMatchObject({ openingCents: 27000, targetFloatCents: 50000 })
  })

  it('rolls back receiving if the destination account would overflow', async () => {
    const { report } = await closeExample()
    await db.cashAccount.update({ where: { id: 'owner' }, data: { balance: MAX_MONEY_CENTS / 100 } })
    const historyBefore = await db.cashBalanceHistory.count()
    await expect(run({ action: 'receiveDeposit', costCenterId: 'PUL', depositId: report.deposit!.id, version: 1, destinationAccountId: 'owner', physicalReceiptConfirmed: true })).rejects.toMatchObject({ status: 400 })
    expect((await view()).selectedReport?.deposit?.status).toBe('WAITING')
    expect((await view()).settings?.balanceCents).toBe(167000)
    expect(await db.cashBalanceHistory.count()).toBe(historyBefore)
  })

  it('rejects different payload under a reused close key', async () => {
    const { command } = await closeExample()
    await expect(run({ ...command, reason: 'Inne żądanie' })).rejects.toMatchObject({ status: 409 })
    expect((await view()).settings?.balanceCents).toBe(167000)
  })

  it('returns only the public deposit DTO, without embedded Prisma relations', async () => {
    await closeExample()
    const state = await view('PUL', 'user-PUL')
    expect(state.selectedReport!.deposit).not.toHaveProperty('destinationAccount')
    expect(state.deposits[0]).not.toHaveProperty('destinationAccount')
    expect(state.deposits[0]).not.toHaveProperty('report')
  })

  it('reports a float shortage separately from a balanced physical cash count', async () => {
    await setup()
    const report = await createDay()
    await run({ action: 'setTarget', costCenterId: 'PUL', version: 1, targetFloatCents: 50000, reason: 'Większa kasa stała' })
    await run({ action: 'updateReport', costCenterId: 'PUL', reportId: report.id, version: 2, cashReceiptsCents: 0, cardReceiptsCents: 0, countedCents: 27000 })
    const current = (await view()).selectedReport!
    expect(current).toMatchObject({ expectedCents: 27000, differenceCents: 0, shortfallCents: 23000, retainedCents: 27000, depositCents: 0 })
    await run({ action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: current.version, requestId: 'float-shortage-only', retainedConfirmed: true, depositConfirmed: true, reason: 'Pozostawiono rzeczywiste 270 zł' })
    expect((await createDay('2026-09-10')).openingCents).toBe(27000)
  })
})

describe('concurrent cashier writes on independent SQLite connections', () => {
  it('commits exactly one edit for competing report versions', async () => {
    await setup()
    const report = await createDay()
    const otherDb = new PrismaClient({ datasources: { db: { url } } })
    try {
      const results = await Promise.allSettled([
        run({ action: 'updateReport', costCenterId: 'PUL', reportId: report.id, version: 1, cashReceiptsCents: 100 }),
        executeCashierCommand(otherDb, 'admin', { action: 'updateReport', costCenterId: 'PUL', reportId: report.id, version: 1, cashReceiptsCents: 200 }, now),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 409 })
      expect((await view()).selectedReport?.version).toBe(2)
    } finally { await otherDb.$disconnect() }
  }, 30_000)

  it('replays a competing close with one deposit and one account movement', async () => {
    const report = await prepareExample()
    const command = { action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: report.version, requestId: 'concurrent-close-same-request', retainedConfirmed: true, depositConfirmed: true } as const
    const otherDb = new PrismaClient({ datasources: { db: { url } } })
    try {
      const results = await Promise.all([
        run(command), executeCashierCommand(otherDb, 'admin', command, now),
      ])
      expect(results.filter((result) => result.replayed)).toHaveLength(1)
      expect(await db.cashDeposit.count()).toBe(1)
      expect(await db.cashBalanceHistory.count()).toBe(1)
      expect((await view()).settings?.balanceCents).toBe(167000)
    } finally { await otherDb.$disconnect() }
  }, 30_000)

  it('keeps a concurrent target change consistent with close: either stale close or old target remains frozen', async () => {
    const report = await prepareExample()
    const otherDb = new PrismaClient({ datasources: { db: { url } } })
    try {
      const results = await Promise.allSettled([
        run({ action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: report.version, requestId: 'close-racing-target', retainedConfirmed: true, depositConfirmed: true }),
        executeCashierCommand(otherDb, 'admin', { action: 'setTarget', costCenterId: 'PUL', version: 1, targetFloatCents: 30000, reason: 'Nowy cel kasy' }, now),
      ])
      expect(results[1].status).toBe('fulfilled')
      const state = await view()
      expect(state.settings?.targetFloatCents).toBe(30000)
      if (results[0].status === 'fulfilled') {
        expect(state.selectedReport).toMatchObject({ status: 'CLOSED', targetFloatCents: 27000, depositCents: 140000 })
      } else {
        expect(results[0].reason).toMatchObject({ status: 409 })
        expect(state.selectedReport).toMatchObject({ status: 'DRAFT', targetFloatCents: 30000, depositCents: 137000 })
        expect(state.settings?.balanceCents).toBe(27000)
      }
    } finally { await otherDb.$disconnect() }
  }, 30_000)
})

describe('HTTP cashier boundary', () => {
  it('returns no-store 401/403 and checks the database rather than the session role', async () => {
    const anonymous = createCashierHandlers({ db, getSession: async () => null, now: () => now })
    const unauthenticated = await anonymous.GET(new NextRequest('http://localhost/api/cashier'))
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('cache-control')).toContain('no-store')
    const staleAdmin = createCashierHandlers({ db, getSession: async () => ({ user: { id: 'manager', role: 'ADMIN' } }), now: () => now })
    expect((await staleAdmin.GET(new NextRequest('http://localhost/api/cashier'))).status).toBe(403)
  })

  it('accepts a valid command, returns the typed bootstrap and rejects malformed input with readable Polish errors', async () => {
    await setup()
    const employee = createCashierHandlers({ db, getSession: async () => ({ user: { id: 'user-PUL', role: 'ADMIN' } }), now: () => now })
    const post = await employee.POST(new NextRequest('http://localhost/api/cashier', { method: 'POST', body: JSON.stringify({ action: 'createReport', costCenterId: 'PUL', businessDate: '2026-09-09' }), headers: { 'content-type': 'application/json' } }))
    expect(post.status).toBe(200)
    const result = await post.json()
    expect(result).toMatchObject({ ok: true })
    const response = await employee.GET(new NextRequest(`http://localhost/api/cashier?reportId=${result.reportId}`))
    const body = await response.json()
    expect(body.actor).toMatchObject({ role: 'EMPLOYEE', costCenterId: 'PUL' })
    expect(body.accounts).toEqual([])
    expect(body.selectedReport.id).toBe(result.reportId)
    const malformed = await employee.POST(new NextRequest('http://localhost/api/cashier', { method: 'POST', body: '{bad json' }))
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error).toMatch(/Nieprawidłow/)
    expect((await employee.GET(new NextRequest('http://localhost/api/cashier?costCenterId=JAG'))).status).toBe(403)
  })
})
