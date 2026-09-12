// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { withAiQueueMutation } from '@/lib/ai/queue'
import { invalidateClosedInvoicePeriods } from '@/lib/invoice-import/closed-periods'

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-invoice-periods-'))
const databaseUrl = `file:${path.join(directory, 'periods.db')}`
let db: PrismaClient

beforeAll(async () => {
  const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8',
  })
  if (migrated.status !== 0) throw new Error(migrated.stderr || migrated.stdout)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
})

beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "test_period_audit_failure"')
  await db.costAuditLog.deleteMany()
  await db.financePeriodClose.deleteMany()
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
const close = (year: number, month: number) => db.financePeriodClose.create({ data: {
  year, month, closedById: 'earlier-admin', note: 'Potwierdzony komplet dokumentów',
} })
const invalidate = (dates: Date[], confirmedPeriodIds: string[] = []) => withAiQueueMutation(db, () => new Date(), (tx) =>
  invalidateClosedInvoicePeriods(tx, {
    actorId: 'admin', reason: 'invoice.approve', dates, confirmedPeriodIds,
  }),
)

describe('invoice changes to completed finance periods', () => {
  it('does not create a completion or an invalidation audit for an open month', async () => {
    await expect(invalidate([date('2026-04-01')])).resolves.toEqual([])
    expect(await db.financePeriodClose.count()).toBe(0)
    expect(await db.costAuditLog.count()).toBe(0)
  })

  it('requires explicit confirmation of the exact current completion before any mutation', async () => {
    const completed = await close(2026, 4)
    await expect(invalidate([date('2026-04-30')])).rejects.toMatchObject({
      code: 'CLOSED_PERIOD_CONFIRMATION_REQUIRED', status: 409,
      periods: [{ id: completed.id, year: 2026, month: 4, closedAt: completed.closedAt.toISOString() }],
    })
    expect(await db.financePeriodClose.findUnique({ where: { id: completed.id } })).not.toBeNull()
    expect(await db.costAuditLog.count()).toBe(0)
  })

  it('requires all affected old and new months, deduplicates dates, and preserves complete snapshots', async () => {
    const december = await close(2026, 12)
    const january = await close(2027, 1)
    const untouched = await close(2027, 2)
    const dates = [date('2027-01-01'), date('2026-12-31'), date('2027-01-20')]
    await expect(invalidate(dates, [december.id])).rejects.toMatchObject({
      periods: [expect.objectContaining({ id: january.id })],
    })
    expect(await db.financePeriodClose.count()).toBe(3)
    const invalidated = await invalidate(dates, [december.id, january.id])
    expect(invalidated.map((period) => period.id)).toEqual([december.id, january.id])
    expect(await db.financePeriodClose.findMany()).toEqual([untouched])
    const audits = await db.costAuditLog.findMany({ orderBy: { createdAt: 'asc' } })
    expect(audits).toHaveLength(2)
    expect(audits.map((audit) => JSON.parse(audit.beforeJson!))).toEqual([
      JSON.parse(JSON.stringify(december)), JSON.parse(JSON.stringify(january)),
    ])
    expect(audits.every((audit) => audit.actorId === 'admin' && audit.action === 'finance.period.invalidate')).toBe(true)
    expect(JSON.parse(audits[0].afterJson!)).toMatchObject({
      state: 'REQUIRES_REVIEW', reason: 'invoice.approve', year: 2026, month: 12,
    })
  })

  it('does not let an earlier confirmation invalidate a period that has since been completed again', async () => {
    const earlier = await close(2026, 9)
    await invalidate([date('2026-09-01')], [earlier.id])
    const current = await close(2026, 9)
    await expect(invalidate([date('2026-09-02')], [earlier.id])).rejects.toMatchObject({
      code: 'CLOSED_PERIOD_CONFIRMATION_REQUIRED', periods: [expect.objectContaining({ id: current.id })],
    })
    expect(await db.financePeriodClose.count()).toBe(1)
    expect(await db.costAuditLog.count()).toBe(1)
  })

  it('rolls back both the period deletion and surrounding transaction when the audit fails', async () => {
    const first = await close(2026, 5)
    const second = await close(2026, 6)
    await db.$executeRawUnsafe(`CREATE TRIGGER "test_period_audit_failure"
      BEFORE INSERT ON "CostAuditLog" WHEN json_extract(NEW.beforeJson, '$.month') = 6
      BEGIN SELECT RAISE(ABORT, 'test second audit failure'); END`)
    await expect(withAiQueueMutation(db, () => new Date(), async (tx) => {
      await tx.appSetting.create({ data: { key: 'period-rollback-sentinel', value: 'must-not-persist' } })
      return invalidateClosedInvoicePeriods(tx, {
        actorId: 'admin', reason: 'invoice.edit',
        dates: [date('2026-05-10'), date('2026-06-01')], confirmedPeriodIds: [first.id, second.id],
      })
    })).rejects.toThrow()
    expect(await db.financePeriodClose.findMany({ orderBy: { month: 'asc' } })).toEqual([first, second])
    expect(await db.costAuditLog.count()).toBe(0)
    expect(await db.appSetting.findUnique({ where: { key: 'period-rollback-sentinel' } })).toBeNull()
  })

  it('rejects invalid dates without touching completion records', async () => {
    await close(2026, 5)
    await expect(invalidate([new Date('invalid')])).rejects.toThrow()
    expect(await db.financePeriodClose.count()).toBe(1)
    expect(await db.costAuditLog.count()).toBe(0)
  })
})
