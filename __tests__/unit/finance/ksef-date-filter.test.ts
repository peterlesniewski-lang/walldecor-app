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
const directory = mkdtempSync(join(tmpdir(), 'ksef-date-test-'))
const databaseUrl = `file:${join(directory, 'test.db')}`
const request = (query: string) => GET(new NextRequest(`http://localhost/api/finance/ksef/invoices?${query}`))

beforeAll(async () => {
  execFileSync('sqlite3', [join(directory, 'test.db'), 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe',
  })
  state.db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  const dates = [
    '2026-08-31T23:59:59.999Z', '2026-10-01T00:00:00.000Z', '2024-02-29T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z',
    ...Array(50).fill('2026-09-15T00:00:00.000Z'),
  ]
  for (const [index, date] of dates.entries()) {
    await state.db.ksefInvoice.create({ data: {
      id: `invoice-${index}`, invoiceNumber: `FV/${index}`, supplierName: 'Test',
      issueDate: new Date(date), grossAmount: 10, paymentStatus: 'UNPAID',
    } })
  }
}, 60_000)
afterAll(async () => {
  await state.db?.$disconnect()
  rmSync(directory, { recursive: true, force: true })
})

describe('invoice issue date filtering on real SQLite', () => {
  it('includes both whole boundary days and filters before pagination and sums', async () => {
    const query = 'issueDateFrom=2026-09-01&issueDateTo=2026-09-30'
    const body = await (await request(query)).json()
    expect(body).toMatchObject({ total: 52, totalPages: 2, grossAmountTotal: 520, unpaidAmountTotal: 520 })
    expect(body.invoices).toHaveLength(50)
    expect(body.invoices[0].id).toBe('invoice-4')
    const page2 = await (await request(`${query}&page=2`)).json()
    expect(page2.invoices).toHaveLength(2)
    expect(page2.invoices.at(-1).id).toBe('invoice-3')
    expect(page2.grossAmountTotal).toBe(520)
  })

  it('supports one-sided bounds and a real leap day', async () => {
    expect((await (await request('issueDateFrom=2026-10-01')).json()).total).toBe(1)
    expect((await (await request('issueDateTo=2026-08-31')).json()).total).toBe(2)
    const leap = await (await request('issueDateFrom=2024-02-29&issueDateTo=2024-02-29')).json()
    expect(leap.invoices.map((row: { id: string }) => row.id)).toEqual(['invoice-2'])
  })

  it.each([
    'issueDateFrom=2026-02-29', 'issueDateTo=2026-09-31', 'issueDateFrom=not-a-date',
    'issueDateFrom=2026-10-01&issueDateTo=2026-09-30',
  ])('rejects invalid bounds: %s', async (query) => {
    expect((await request(query)).status).toBe(400)
  })

  it('combines date bounds with other filters and accepts clearing them', async () => {
    expect((await (await request('issueDateFrom=2026-09-01&issueDateTo=2026-09-30&paymentStatus=PAID')).json()).total).toBe(0)
    expect((await (await request('issueDateFrom=&issueDateTo=')).json()).total).toBe(55)
  })
})
