// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { SUBIEKT_BRIDGE_KEYS } from '@/lib/finance/subiekt-revenue'
import { runSubiektAutoSyncTick } from '@/lib/finance/subiekt-auto-sync'
import { startSubiektBridgeMock, type SubiektBridgeMock } from '../../../e2e/subiekt-bridge-mock'

// One real scheduler tick: fresh SQLite from the migration chain, the HTTP mock bridge from the
// Playwright suite (test fixture only), configuration read from process.env exactly as in production.

let directory = ''
let db: PrismaClient
let mock: SubiektBridgeMock
const saved: Record<string, string | undefined> = {}
const ENV_KEYS = ['SUBIEKT_BRIDGE_URL', 'SUBIEKT_BRIDGE_TOKEN', 'SUBIEKT_BRIDGE_WAREHOUSE_MAP'] as const

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'walldecor-subiekt-scheduler-'))
  // Prisma 5 on Windows may fail to create a new SQLite file in migrate deploy.
  await writeFile(join(directory, 'scheduler.db'), '', { flag: 'wx' })
  const url = `file:${join(directory, 'scheduler.db')}`
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', timeout: 60_000,
  })
  db = new PrismaClient({ datasources: { db: { url } } })
  await db.costCenter.createMany({ data: [{ id: 'JAG', name: 'Jagiellońska' }, { id: 'PUL', name: 'Puławska' }] })
  mock = await startSubiektBridgeMock({ port: 0, token: 'scheduler-token', rows: [
    { year: 2026, month: 10, warehouse_symbol: 'PUŁ', kind: 'TOWAR', documents: 7, net_total: 10036.32, gross_total: 12345.67 },
    { year: 2026, month: 10, warehouse_symbol: 'MAG', kind: 'USLUGA', documents: 2, net_total: 1869.92, gross_total: 2300 },
  ] })
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  process.env.SUBIEKT_BRIDGE_URL = mock.url
  process.env.SUBIEKT_BRIDGE_TOKEN = 'scheduler-token'
  process.env.SUBIEKT_BRIDGE_WAREHOUSE_MAP = 'PUŁ:PUL,MAG:JAG,INT:PUL:ECOMMERCE'
}, 120_000)

afterAll(async () => {
  for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] }
  await mock?.close()
  await db?.$disconnect()
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('Subiekt auto-sync scheduler tick (SQLite + HTTP mock bridge)', () => {
  it('should run the due slot once, store snapshots with fetchedAt and log a single SUBIEKT_AUTO_SYNC line', async () => {
    // Slot already claimed for yesterday → today's 07:30 slot is due at 08:00 Europe/Warsaw (06:00Z in November).
    await db.appSetting.create({ data: { key: SUBIEKT_BRIDGE_KEYS.autoSyncSlot, value: '2026-11-01' } })
    const now = new Date('2026-11-02T07:00:00Z')
    const log = { info: vi.fn(), error: vi.fn() }

    const outcome = await runSubiektAutoSyncTick(db, now, log)
    expect(outcome).toMatchObject({ ran: true, slot: '2026-11-02', status: 'OK' })
    expect(log.error).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledTimes(1)
    const line = log.info.mock.calls[0][0] as string
    expect(JSON.parse(line)).toMatchObject({ event: 'SUBIEKT_AUTO_SYNC', ran: true, slot: '2026-11-02', status: 'OK', message: 'Odczytano 2 wierszy z Subiekta.' })

    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].authorization).toBe('Bearer scheduler-token')
    expect(mock.calls[0].path).toContain('/api/sales/summary?from=2025-11-01&to=2026-11-02&group_by=month_warehouse_kind')

    const snapshots = await db.subiektRevenueSnapshot.findMany({ orderBy: { warehouseSymbol: 'asc' } })
    expect(snapshots.map((s) => [s.warehouseSymbol, s.costCenterId, s.channel, s.grossAmount])).toEqual([['MAG', 'JAG', 'MONTAZ', 2300], ['PUŁ', 'PUL', 'SALON', 12345.67]])
    expect(snapshots.every((s) => s.fetchedAt.getTime() === now.getTime())).toBe(true)
    const settings = Object.fromEntries((await db.appSetting.findMany()).map((s) => [s.key, s.value]))
    expect(settings[SUBIEKT_BRIDGE_KEYS.lastFetchAt]).toBe(now.toISOString())
    expect(settings[SUBIEKT_BRIDGE_KEYS.autoSyncSlot]).toBe('2026-11-02')
    expect(settings[SUBIEKT_BRIDGE_KEYS.autoSyncStatus]).toBe('OK')
    expect(await db.revenue.count()).toBe(0) // the scheduler never applies

    // Evidence for the proof document.
    process.stdout.write(`SCHEDULER-PROOF log: ${line}\nSCHEDULER-PROOF fetchedAt: ${snapshots[0].fetchedAt.toISOString()} last_fetch_at: ${settings[SUBIEKT_BRIDGE_KEYS.lastFetchAt]}\n`)

    // Second tick five minutes later: the slot is taken, nothing runs, no second bridge call.
    expect(await runSubiektAutoSyncTick(db, new Date('2026-11-02T07:05:00Z'), log)).toEqual({ ran: false, reason: 'NOT_DUE' })
    expect(mock.calls).toHaveLength(1)
    expect(log.info).toHaveBeenCalledTimes(1)
  })
})
