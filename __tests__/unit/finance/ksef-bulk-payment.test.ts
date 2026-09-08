// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@/generated/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '@/app/api/finance/ksef/invoices/bulk-payment/route'
import { requireFinanceAdmin } from '@/lib/finance/finance-access'

const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
vi.mock('@/lib/finance/finance-access', () => ({ requireFinanceAdmin: vi.fn() }))

const directory = mkdtempSync(join(tmpdir(), 'ksef-bulk-test-'))
const databaseUrl = `file:${join(directory, 'test.db')}`
const dueDate = new Date('2026-09-15T00:00:00Z')
const originalPaidAt = new Date('2026-08-20T12:00:00Z')

function request(invoiceIds: string[], paidDate = '2026-09-08') {
  return new NextRequest('http://localhost/api/finance/ksef/invoices/bulk-payment', {
    method: 'POST', body: JSON.stringify({ invoiceIds, paidDate }),
  })
}
beforeAll(() => {
  execFileSync('sqlite3', [join(directory, 'test.db'), 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  })
  state.db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
}, 60_000)
beforeEach(async () => {
  vi.mocked(requireFinanceAdmin).mockResolvedValue({ session: { user: { id: 'test-admin', role: 'ADMIN' } } } as never)
  await state.db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_audit')
  await state.db.costAuditLog.deleteMany()
  await state.db.ksefInvoice.deleteMany()
  for (const [id, paymentStatus] of [['a', 'UNPAID'], ['b', 'UNPAID'], ['c', 'PAID'], ['d', 'UNPAID']]) {
    await state.db.ksefInvoice.create({ data: {
      id, supplierName: 'Test', invoiceNumber: id, issueDate: new Date('2026-09-01'),
      grossAmount: 123.45, dueDate, paymentStatus,
      paidAt: paymentStatus === 'PAID' ? originalPaidAt : null,
      status: 'APPROVED', documentStatus: id === 'd' ? 'CANCELLED' : 'ACTIVE',
    } })
  }
})
afterAll(async () => {
  await state.db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('bulk payments against a real isolated SQLite database', () => {
  it('persists payment and audit, preserves due dates and prior paid dates, and supports retry', async () => {
    const response = await POST(request(['a', 'a', 'c']))
    expect(await response.json()).toMatchObject({ results: [
      { id: 'a', outcome: 'paid' }, { id: 'c', outcome: 'already_paid' },
    ] })
    await state.db.$disconnect()
    await state.db.$connect()
    expect(await state.db.ksefInvoice.findUnique({ where: { id: 'a' } })).toMatchObject({
      paymentStatus: 'PAID', paidAt: new Date('2026-09-08T10:00:00Z'), dueDate, status: 'APPROVED',
    })
    expect(await state.db.ksefInvoice.findUnique({ where: { id: 'c' } })).toMatchObject({ paidAt: originalPaidAt, dueDate })
    expect(await state.db.ksefInvoice.findUnique({ where: { id: 'b' } })).toMatchObject({ paymentStatus: 'UNPAID' })
    const audit = await state.db.costAuditLog.findFirstOrThrow()
    expect(audit).toMatchObject({ invoiceId: 'a', actorId: 'test-admin', action: 'payment.bulk-paid' })
    expect(JSON.parse(audit.beforeJson!)).toEqual({ paymentStatus: 'UNPAID', paidAt: null })
    await POST(request(['a'], '2026-09-09'))
    expect(await state.db.costAuditLog.count()).toBe(1)
    expect((await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: 'a' } })).paidAt).toEqual(new Date('2026-09-08T10:00:00Z'))
  })

  it('rolls back a failed audit and completes other invoices without changing cancelled documents', async () => {
    await state.db.$executeRawUnsafe("CREATE TRIGGER fail_audit BEFORE INSERT ON CostAuditLog WHEN NEW.invoiceId = 'a' BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    const result = await (await POST(request(['a', 'b', 'd', 'missing']))).json()
    expect(result.results.map((item: { outcome: string }) => item.outcome)).toEqual(['failed', 'paid', 'failed', 'failed'])
    expect((await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: 'a' } })).paymentStatus).toBe('UNPAID')
    expect((await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: 'b' } })).paymentStatus).toBe('PAID')
    expect((await state.db.ksefInvoice.findUniqueOrThrow({ where: { id: 'd' } })).paymentStatus).toBe('UNPAID')
    expect(await state.db.costAuditLog.count()).toBe(1)
  })

  it('rejects unauthorized callers, malformed dates, empty or oversized batches', async () => {
    for (const status of [401, 403]) {
      vi.mocked(requireFinanceAdmin).mockResolvedValueOnce({ error: NextResponse.json({ error: 'denied' }, { status }) })
      expect((await POST(request(['a']))).status).toBe(status)
    }
    for (const [ids, date] of [[[], '2026-09-08'], [['a'], '2026-02-30'], [Array(201).fill('a'), '2026-09-08']] as [string[], string][]) {
      expect((await POST(request(ids, date))).status).toBe(400)
    }
    expect((await POST(new NextRequest('http://localhost/test', { method: 'POST', body: '{' }))).status).toBe(400)
    expect(await state.db.costAuditLog.count()).toBe(0)
  })
})
