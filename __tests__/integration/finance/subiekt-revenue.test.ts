// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { Session } from 'next-auth'
import { PrismaClient } from '@/generated/prisma'
import type { FetchLike } from '@/lib/finance/subiekt-bridge-client'

// Subiekt snapshots and "Zastosuj" on a FRESH database built from the real migration chain. Synthetic data only.

const state = vi.hoisted(() => ({ client: null as PrismaClient | null, session: null as Session | null }))
vi.mock('@/lib/prisma', () => ({ get prisma() { return state.client } }))
vi.mock('next-auth', () => ({ getServerSession: async () => state.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import {
  SUBIEKT_BRIDGE_KEYS, applySubiektRevenue, applySubiektRevenueMonth, getSubiektRevenueView, loadSubiektAiBlock, refreshSubiektRevenue,
} from '@/lib/finance/subiekt-revenue'
import { POST as applyRoute } from '@/app/api/finance/subiekt-revenue/apply/route'
import { POST as refreshRoute } from '@/app/api/finance/subiekt-revenue/refresh/route'

let directory = ''
let db: PrismaClient
const NOW = new Date('2026-11-02T10:00:00Z')
const env = { SUBIEKT_BRIDGE_URL: 'https://bridge.test', SUBIEKT_BRIDGE_TOKEN: 'tok' }
const config = { url: env.SUBIEKT_BRIDGE_URL, token: env.SUBIEKT_BRIDGE_TOKEN }

const row = (year: number, month: number, warehouse_symbol: string, kind: 'TOWAR' | 'USLUGA', gross_total: number, documents = 1) =>
  ({ year, month, warehouse_symbol, warehouse_name: warehouse_symbol, kind, documents, net_total: Math.round(gross_total / 1.23 * 100) / 100, gross_total })

const bridge = (rows: ReturnType<typeof row>[]): FetchLike => async (url) => {
  const params = new URL(url).searchParams
  return new Response(JSON.stringify({ from: params.get('from'), to: params.get('to'), group_by: 'month_warehouse_kind', rows }), { status: 200 })
}
const fixture = [
  row(2026, 10, 'PUŁ', 'TOWAR', 1000),
  row(2026, 10, 'PUŁ', 'USLUGA', 300, 2),
  row(2026, 10, 'MAG', 'TOWAR', -50), // net negative month (corrections exceed sales)
  row(2026, 9, 'INT', 'TOWAR', 420), // online warehouse forced to ECOMMERCE
  row(2026, 9, 'ZEW', 'USLUGA', 77), // not in the map → unmapped warning
  row(2024, 1, 'PUŁ', 'TOWAR', 999), // outside the 13-month window → ignored
]

const asAdmin = () => { state.session = { user: { id: 'admin', role: 'ADMIN', name: 'Admin', email: 'admin@test.pl' }, expires: '' } }
const request = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'walldecor-subiekt-revenue-'))
  const url = `file:${join(directory, 'subiekt.db')}`
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 60_000,
  })
  db = new PrismaClient({ datasources: { db: { url } } })
  state.client = db
  await db.costCenter.createMany({ data: [{ id: 'JAG', name: 'Jagiellońska' }, { id: 'PUL', name: 'Puławska' }, { id: 'GLOBAL', name: 'Firma' }] })
}, 90_000)

beforeEach(async () => {
  await db.revenue.deleteMany()
  await db.subiektRevenueSnapshot.deleteMany()
  await db.appSetting.deleteMany()
  asAdmin()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterAll(async () => {
  vi.useRealTimers()
  await db?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('refreshSubiektRevenue', () => {
  it('should store one snapshot per warehouse × kind inside the 13-month window and record the read time', async () => {
    const result = await refreshSubiektRevenue(db, { config, env, now: NOW, fetchImpl: bridge(fixture) })
    expect(result).toMatchObject({ ok: true, rows: 5, unmappedWarehouses: ['ZEW'], mapProblems: [] })
    const stored = await db.subiektRevenueSnapshot.findMany({ orderBy: [{ year: 'asc' }, { month: 'asc' }, { warehouseSymbol: 'asc' }] })
    expect(stored.map((r) => [r.year, r.month, r.warehouseSymbol, r.kind, r.costCenterId, r.channel, r.grossAmount])).toEqual([
      [2026, 9, 'INT', 'TOWAR', 'PUL', 'ECOMMERCE', 420],
      [2026, 9, 'ZEW', 'USLUGA', null, null, 77],
      [2026, 10, 'MAG', 'TOWAR', 'JAG', 'SALON', -50],
      [2026, 10, 'PUŁ', 'TOWAR', 'PUL', 'SALON', 1000],
      [2026, 10, 'PUŁ', 'USLUGA', 'PUL', 'MONTAZ', 300],
    ])
    const setting = await db.appSetting.findUnique({ where: { key: SUBIEKT_BRIDGE_KEYS.lastFetchAt } })
    expect(setting?.value).toBe(NOW.toISOString())
  })

  it('should delete rows the bridge no longer returns and leave rows outside the window alone', async () => {
    await refreshSubiektRevenue(db, { config, env, now: NOW, fetchImpl: bridge(fixture) })
    await db.subiektRevenueSnapshot.create({ data: { year: 2024, month: 5, warehouseSymbol: 'PUŁ', kind: 'TOWAR', costCenterId: 'PUL', channel: 'SALON', grossAmount: 1, netAmount: 1, documentCount: 1, fetchedAt: NOW, sourceHash: 'old' } })
    const second = await refreshSubiektRevenue(db, { config, env, now: NOW, fetchImpl: bridge([row(2026, 10, 'PUŁ', 'TOWAR', 1200)]) })
    expect(second).toMatchObject({ ok: true, rows: 1 })
    const stored = await db.subiektRevenueSnapshot.findMany({ orderBy: [{ year: 'asc' }] })
    expect(stored.map((r) => [r.year, r.month, r.warehouseSymbol, r.grossAmount])).toEqual([[2024, 5, 'PUŁ', 1], [2026, 10, 'PUŁ', 1200]])
  })

  it('should keep the previous snapshot and record the error when the bridge is unavailable', async () => {
    await refreshSubiektRevenue(db, { config, env, now: NOW, fetchImpl: bridge(fixture) })
    const down: FetchLike = async () => { throw new TypeError('fetch failed') }
    const result = await refreshSubiektRevenue(db, { config, env, now: new Date('2026-11-03T06:30:00Z'), fetchImpl: down })
    expect(result).toMatchObject({ ok: false, kind: 'unavailable' })
    expect(await db.subiektRevenueSnapshot.count()).toBe(5)
    const view = await getSubiektRevenueView(db, 2026, 'PUL', env)
    expect(view.fetchedAt).toBe(NOW.toISOString())
    expect(view.lastError).toContain('niedostępny')
    expect(view.lastErrorAt).toBe('2026-11-03T06:30:00.000Z')
  })

  it('should report not_configured without touching the bridge', async () => {
    const result = await refreshSubiektRevenue(db, { env: {}, now: NOW, fetchImpl: async () => { throw new Error('must not be called') } })
    expect(result).toMatchObject({ ok: false, kind: 'not_configured' })
  })
})

describe('getSubiektRevenueView', () => {
  it('should aggregate per center and channel, scope to the chosen center and list unmapped warehouses', async () => {
    await refreshSubiektRevenue(db, { config, env, now: NOW, fetchImpl: bridge(fixture) })
    const pul = await getSubiektRevenueView(db, 2026, 'PUL', env)
    expect(pul.configured).toBe(true)
    expect(pul.cells.map((c) => [c.month, c.channel, c.grossAmount, c.documentCount])).toEqual([[9, 'ECOMMERCE', 420, 1], [10, 'MONTAZ', 300, 2], [10, 'SALON', 1000, 1]])
    expect(pul.unmapped).toEqual([{ year: 2026, month: 9, warehouseSymbol: 'ZEW', kind: 'USLUGA', grossAmount: 77, documentCount: 1 }])
    const all = await getSubiektRevenueView(db, 2026, 'GLOBAL', env)
    expect(all.cells.find((c) => c.costCenterId === 'JAG')?.grossAmount).toBe(-50)
  })

  it('should mark the integration as not configured without any bridge settings', async () => {
    const view = await getSubiektRevenueView(db, 2026, 'PUL', {})
    expect(view.configured).toBe(false)
  })
})

describe('applySubiektRevenue', () => {
  beforeEach(async () => { await refreshSubiektRevenue(db, { config, env, now: NOW, fetchImpl: bridge(fixture) }) })

  it('should write the Subiekt gross amount into Revenue with the last day of a closed month', async () => {
    const result = await applySubiektRevenue(db, { year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON' }, NOW)
    expect(result).toEqual({ ok: true, entries: [{ year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON', amount: 1000, asOfDate: '2026-10-31' }] })
    const stored = await db.revenue.findUnique({ where: { year_month_costCenterId_channel: { year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON' } } })
    expect(stored).toMatchObject({ amount: 1000, asOfDate: '2026-10-31' })
  })

  it('should replace an existing manual entry (upsert) and keep a negative correction month', async () => {
    await db.revenue.create({ data: { year: 2026, month: 10, costCenterId: 'JAG', channel: 'SALON', amount: 5000, asOfDate: '2026-10-15' } })
    const result = await applySubiektRevenue(db, { year: 2026, month: 10, costCenterId: 'JAG', channel: 'SALON' }, NOW)
    expect(result.ok).toBe(true)
    expect(await db.revenue.count({ where: { year: 2026, month: 10, costCenterId: 'JAG' } })).toBe(1)
    expect((await db.revenue.findFirst({ where: { costCenterId: 'JAG' } }))?.amount).toBe(-50)
  })

  it('should use today as the as-of date for the current month', async () => {
    await db.subiektRevenueSnapshot.create({ data: { year: 2026, month: 11, warehouseSymbol: 'PUŁ', kind: 'TOWAR', costCenterId: 'PUL', channel: 'SALON', grossAmount: 10, netAmount: 8, documentCount: 1, fetchedAt: NOW, sourceHash: 'x' } })
    const result = await applySubiektRevenue(db, { year: 2026, month: 11, costCenterId: 'PUL', channel: 'SALON' }, NOW)
    expect(result).toMatchObject({ ok: true, entries: [{ asOfDate: '2026-11-02' }] })
  })

  it('should refuse a cell without a snapshot and a channel the center does not allow', async () => {
    expect(await applySubiektRevenue(db, { year: 2026, month: 8, costCenterId: 'PUL', channel: 'SALON' }, NOW)).toMatchObject({ ok: false })
    await db.subiektRevenueSnapshot.create({ data: { year: 2026, month: 7, warehouseSymbol: 'X', kind: 'TOWAR', costCenterId: 'JAG', channel: 'ECOMMERCE', grossAmount: 10, netAmount: 8, documentCount: 1, fetchedAt: NOW, sourceHash: 'x' } })
    const result = await applySubiektRevenue(db, { year: 2026, month: 7, costCenterId: 'JAG', channel: 'ECOMMERCE' }, NOW)
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Kanał') })
    expect(await db.revenue.count()).toBe(0)
  })

  it('should apply every channel of a month at once', async () => {
    const result = await applySubiektRevenueMonth(db, { year: 2026, month: 10, costCenterId: 'PUL' }, NOW)
    expect(result.ok).toBe(true)
    expect((result.ok ? result.entries : []).map((e) => [e.channel, e.amount])).toEqual([['MONTAZ', 300], ['SALON', 1000]])
  })
})

describe('API routes', () => {
  it('should refuse refresh and apply for non-admins', async () => {
    state.session = { user: { id: 'm', role: 'MANAGER', name: 'M', email: 'm@test.pl' }, expires: '' }
    expect((await refreshRoute()).status).toBe(403)
    expect((await applyRoute(request('/api/finance/subiekt-revenue/apply', { year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON' }))).status).toBe(403)
    state.session = null
    expect((await refreshRoute()).status).toBe(401)
  })

  it('should answer 409 when the bridge is not configured', async () => {
    vi.stubEnv('SUBIEKT_BRIDGE_URL', '')
    vi.stubEnv('SUBIEKT_BRIDGE_TOKEN', '')
    const response = await refreshRoute()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('nie jest skonfigurowany') })
    vi.unstubAllEnvs()
  })

  it('should validate the apply body and write through the same path as the service', async () => {
    await refreshSubiektRevenue(db, { config, env, now: NOW, fetchImpl: bridge(fixture) })
    expect((await applyRoute(request('/api/finance/subiekt-revenue/apply', { year: 2026, month: 13, costCenterId: 'PUL' }))).status).toBe(400)
    const response = await applyRoute(request('/api/finance/subiekt-revenue/apply', { year: 2026, month: 10, costCenterId: 'PUL' }))
    expect(response.status).toBe(200)
    expect(await db.revenue.count({ where: { year: 2026, month: 10, costCenterId: 'PUL' } })).toBe(2)
    const missing = await applyRoute(request('/api/finance/subiekt-revenue/apply', { year: 2026, month: 3, costCenterId: 'PUL', channel: 'SALON' }))
    expect(missing.status).toBe(409)
  })
})

describe('loadSubiektAiBlock', () => {
  it('should pair Subiekt cells with entered revenue and compute the difference', async () => {
    await refreshSubiektRevenue(db, { config, env, now: NOW, fetchImpl: bridge(fixture) })
    await db.revenue.create({ data: { year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON', amount: 900, asOfDate: '2026-10-31' } })
    const block = await loadSubiektAiBlock(db, 2026, env)
    const salon = block?.months.find((m) => m.month === 10 && m.costCenterId === 'PUL' && m.channel === 'SALON')
    expect(salon).toMatchObject({ subiektGross: 1000, enteredAmount: 900, difference: 100 })
    expect(block?.months.find((m) => m.channel === 'MONTAZ')).toMatchObject({ enteredAmount: null, difference: null })
    expect(await loadSubiektAiBlock(db, 2026, {})).toBeNull()
  })
})
