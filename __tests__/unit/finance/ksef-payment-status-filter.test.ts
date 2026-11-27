// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@/generated/prisma'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/finance/ksef/invoices/route'

const state = vi.hoisted(() => ({ db: null as unknown as PrismaClient }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.db } }))
vi.mock('@/lib/finance/finance-access', () => ({
  requireFinanceAdmin: vi.fn(async () => ({ session: { user: { id: 'test-admin', role: 'ADMIN' } } })),
}))
const directory = mkdtempSync(join(tmpdir(), 'ksef-payment-filter-test-'))
const databaseUrl = `file:${join(directory, 'test.db')}`
const request = (query: string) => GET(new NextRequest(`http://localhost/api/finance/ksef/invoices?${query}`))
const numbers = async (query: string) =>
  ((await (await request(query)).json()).invoices as Array<{ invoiceNumber: string }>).map((row) => row.invoiceNumber).sort()

beforeAll(async () => {
  execFileSync('sqlite3', [join(directory, 'test.db'), 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  })
  state.db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  for (const status of ['PAID', 'UNPAID', 'PARTIAL', 'UNKNOWN']) {
    await state.db.ksefInvoice.create({ data: {
      id: `invoice-${status}`, invoiceNumber: status, supplierName: 'Test',
      issueDate: new Date('2026-09-15T00:00:00.000Z'), grossAmount: 10, paymentStatus: status,
    } })
  }
}, 60_000)
afterAll(async () => {
  await state.db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('KSeF payment status filter on real SQLite', () => {
  it('should return every invoice that is not fully paid for the "to pay" filter', async () => {
    expect(await numbers('paymentStatus=UNPAID')).toEqual(['PARTIAL', 'UNKNOWN', 'UNPAID'])
  })

  it('should return only fully paid invoices for the paid filter', async () => {
    expect(await numbers('paymentStatus=PAID')).toEqual(['PAID'])
  })

  it('should return only partially paid invoices for the partial filter', async () => {
    expect(await numbers('paymentStatus=PARTIAL')).toEqual(['PARTIAL'])
  })

  it('should return only invoices with undetermined payment for the unknown filter', async () => {
    expect(await numbers('paymentStatus=UNKNOWN')).toEqual(['UNKNOWN'])
  })

  it('should reject an unsupported payment status', async () => {
    expect((await request('paymentStatus=BOGUS')).status).toBe(400)
  })
})
