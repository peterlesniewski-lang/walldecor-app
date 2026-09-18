// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'
import { PrismaClient } from '@/generated/prisma'
import Papa from 'papaparse'

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, session: null as Session | null }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client } }))
vi.mock('next-auth', () => ({ getServerSession: async () => state.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { GET, POST } from '@/app/api/revenue/route'
import { POST as importRevenue } from '@/app/api/import/revenue/route'
import { GET as exportRevenue } from '@/app/api/export/revenue/route'
import { POST as savePlan } from '@/app/api/revenue-budget/route'

let directory = ''
let db: PrismaClient
const entry = { year: 2026, month: 9, costCenterId: 'JAG', channel: 'SALON', amount: 100, asOfDate: '2026-09-09' }
const csvRow = { rok: '2026', miesiac: '9', centrum_kosztow: 'JAG', kanal: 'SALON', kwota: '100', stan_na_dzien: '2026-09-09' }
const request = (path: string, body?: unknown, headers?: Record<string, string>) => new NextRequest(`http://localhost${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'walldecor-revenue-actuals-'))
  const url = `file:${join(directory, 'actuals.db')}`
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: url, RUST_LOG: 'debug' }, stdio: 'pipe', timeout: 30_000,
  })
  db = new PrismaClient({ datasources: { db: { url } } })
  state.client = db
  await db.costCenter.createMany({ data: [{ id: 'JAG', name: 'Jagiellońska' }, { id: 'PUL', name: 'Puławska' }, { id: 'GLOBAL', name: 'Firma' }] })
}, 40_000)

beforeEach(async () => {
  await db.revenue.deleteMany()
  await db.revenueBudget.deleteMany()
  state.session = { user: { id: 'admin', role: 'ADMIN', name: 'Admin', email: 'admin@test.pl' }, expires: '' }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'))
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
afterAll(async () => {
  await db?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('monthly actual revenue through API and SQLite', () => {
  it('replaces 100 → 150 → 120 and persists amount and as-of date on a fresh read', async () => {
    for (const amount of [100, 150, 120]) {
      const response = await POST(request('/api/revenue', { ...entry, amount }))
      expect(response.status).toBe(200)
    }
    await db.$disconnect()
    const response = await GET(request('/api/revenue?year=2026&costCenterId=JAG'))
    expect(await response.json()).toEqual([expect.objectContaining({ amount: 120, asOfDate: '2026-09-09' })])
    expect(await db.revenue.count()).toBe(1)
  })

  it('persists explicit zero, while an unwritten month remains absent', async () => {
    expect((await POST(request('/api/revenue', { ...entry, amount: 0, asOfDate: null }))).status).toBe(200)
    const rows = await (await GET(request('/api/revenue?year=2026&costCenterId=JAG'))).json()
    expect(rows).toEqual([expect.objectContaining({ month: 9, amount: 0, asOfDate: null })])
    expect(rows.find((row: { month: number }) => row.month === 8)).toBeUndefined()
  })

  it('accepts a negative corrected monthly total', async () => {
    expect((await POST(request('/api/revenue', { ...entry, amount: -120.45 }))).status).toBe(200)
    expect((await db.revenue.findFirstOrThrow()).amount).toBe(-120.45)
  })

  it.each(['', null, '120', 'bad'])('rejects invalid amount %s instead of recording zero', async (amount) => {
    expect((await POST(request('/api/revenue', { ...entry, amount }))).status).toBe(400)
    expect(await db.revenue.count()).toBe(0)
  })

  it.each(['2026-09-11', '2026-08-31', '2026-09-31', '09.09.2026', '2026-09-09T00:00:00Z'])('rejects invalid or out-of-period as-of date %s', async (asOfDate) => {
    expect((await POST(request('/api/revenue', { ...entry, asOfDate }))).status).toBe(400)
    expect(await db.revenue.count()).toBe(0)
  })

  it('uses the Warsaw day across UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-09-09T22:30:00.000Z'))
    expect((await POST(request('/api/revenue', { ...entry, asOfDate: '2026-09-10' }))).status).toBe(200)
    expect((await db.revenue.findFirstOrThrow()).asOfDate).toBe('2026-09-10')
  })

  it.each([{ costCenterId: 'GLOBAL' }, { channel: 'ECOMMERCE' }])('rejects a noneditable center/channel combination %j', async (change) => {
    expect((await POST(request('/api/revenue', { ...entry, ...change }))).status).toBe(400)
    expect(await db.revenue.count()).toBe(0)
  })

  it.each(['MANAGER', 'EMPLOYEE', 'INSTALLER'])('does not grant %s revenue access', async (role) => {
    state.session!.user.role = role as Session['user']['role']
    expect((await POST(request('/api/revenue', entry))).status).toBe(403)
    expect((await GET(request('/api/revenue?year=2026&costCenterId=JAG'))).status).toBe(403)
    expect((await exportRevenue(request('/api/export/revenue'))).status).toBe(403)
    expect((await importRevenue(request('/api/import/revenue', { type: 'actuals', rows: [csvRow] }))).status).toBeGreaterThanOrEqual(400)
    expect(await db.revenue.count()).toBe(0)
  })

  it('blocks unauthenticated reads and writes', async () => {
    state.session = null
    expect((await POST(request('/api/revenue', entry))).status).toBe(401)
    expect((await GET(request('/api/revenue?year=2026&costCenterId=JAG'))).status).toBe(401)
  })
})

describe('actual revenue CSV and retired sales plan', () => {
  it('imports a signed corrected amount with date, and clears that date on old CSV replacement', async () => {
    const first = await importRevenue(request('/api/import/revenue', { type: 'actuals', rows: [{ ...csvRow, kwota: '-123,45' }] }))
    expect(await first.json()).toEqual({ imported: 1, errors: [] })
    expect(await db.revenue.findFirstOrThrow()).toMatchObject({ amount: -123.45, asOfDate: '2026-09-09' })
    const oldRow = { ...csvRow, stan_na_dzien: undefined }
    const second = await importRevenue(request('/api/import/revenue', { type: 'actuals', rows: [{ ...oldRow, kwota: '120' }] }))
    expect(await second.json()).toEqual({ imported: 1, errors: [] })
    expect(await db.revenue.findFirstOrThrow()).toMatchObject({ amount: 120, asOfDate: null })
  })

  it('returns invalid date and empty amount errors without overwriting saved data', async () => {
    await POST(request('/api/revenue', entry))
    const response = await importRevenue(request('/api/import/revenue', { type: 'actuals', rows: [{ ...csvRow, stan_na_dzien: '2026-09-11' }, { ...csvRow, kwota: '' }] }))
    expect(await response.json()).toMatchObject({ imported: 0, errors: [{ row: 2 }, { row: 3 }] })
    expect((await db.revenue.findFirstOrThrow()).amount).toBe(100)
  })

  it('keeps the existing integration-key import without granting ordinary anonymous access', async () => {
    state.session = null
    vi.stubEnv('IMPORT_API_KEY', 'revenue-test-key')
    const body = { type: 'actuals', rows: [csvRow] }
    expect((await importRevenue(request('/api/import/revenue', body))).status).toBe(401)
    expect((await importRevenue(request('/api/import/revenue', body, { 'X-Api-Key': 'wrong' }))).status).toBe(401)
    const valid = await importRevenue(request('/api/import/revenue', body, { 'X-Api-Key': 'revenue-test-key' }))
    expect(await valid.json()).toEqual({ imported: 1, errors: [] })
  })

  it('defaults export to actuals, carries the date and never substitutes historical plan', async () => {
    await db.revenueBudget.create({ data: { year: 2026, month: 9, costCenterId: 'JAG', channel: 'SALON', amount: 999999 } })
    await POST(request('/api/revenue', { ...entry, amount: 120 }))
    const response = await exportRevenue(request('/api/export/revenue?year=2026'))
    expect(response.status).toBe(200)
    const csv = await response.text()
    expect(csv).toContain('rok,miesiac,centrum_kosztow,kanal,kwota,stan_na_dzien')
    expect(csv).toContain('2026,9,JAG,SALON,120.00,2026-09-09')
    expect(csv).not.toContain('999999')
  })

  it('rejects every sales-plan write/export explicitly and preserves the stored plan', async () => {
    await db.revenueBudget.create({ data: { year: 2026, month: 9, costCenterId: 'JAG', channel: 'SALON', amount: 999 } })
    expect((await importRevenue(request('/api/import/revenue', { type: 'plan', rows: [csvRow] }))).status).toBeGreaterThanOrEqual(400)
    expect((await savePlan()).status).toBeGreaterThanOrEqual(400)
    expect((await exportRevenue(request('/api/export/revenue?type=plan'))).status).toBeGreaterThanOrEqual(400)
    expect(await db.revenue.count()).toBe(0)
    expect((await db.revenueBudget.findFirstOrThrow()).amount).toBe(999)
  })

  it('rejects a plan payload addressed directly to the actual-revenue endpoint', async () => {
    expect((await POST(request('/api/revenue', { ...entry, type: 'plan' }))).status).toBe(410)
    expect(await db.revenue.count()).toBe(0)
  })

  it('rejects a malformed export year instead of silently using its numeric prefix', async () => {
    expect((await exportRevenue(request('/api/export/revenue?year=2026wrong'))).status).toBe(400)
  })

  it('round-trips signed amounts and unknown dates through real export and CSV import', async () => {
    await POST(request('/api/revenue', { ...entry, amount: -123.45, asOfDate: null }))
    await POST(request('/api/revenue', { ...entry, costCenterId: 'PUL', channel: 'MONTAZ', amount: 0, asOfDate: '2026-09-10' }))
    const before = await db.revenue.findMany({ orderBy: { costCenterId: 'asc' } })
    const csv = await (await exportRevenue(request('/api/export/revenue?year=2026'))).text()
    const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data
    await db.revenue.deleteMany()
    expect(await (await importRevenue(request('/api/import/revenue', { rows }))).json()).toEqual({ imported: 2, errors: [] })
    const after = await db.revenue.findMany({ orderBy: { costCenterId: 'asc' } })
    const amounts = (rows: typeof before) => rows.map((row) => ({ year: row.year, month: row.month, costCenterId: row.costCenterId, channel: row.channel, amount: row.amount, asOfDate: row.asOfDate }))
    expect(amounts(after)).toEqual(amounts(before))
  })
})
