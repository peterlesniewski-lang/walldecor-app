import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/generated/prisma'
import { isSubiektSlotPending, latestDueSubiektSlot, runScheduledSubiektSync, runSubiektAutoSyncTick } from '@/lib/finance/subiekt-auto-sync'

const refreshMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/finance/subiekt-revenue', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/finance/subiekt-revenue')>(),
  refreshSubiektRevenue: refreshMock,
}))

describe('latestDueSubiektSlot', () => {
  it('should be today after 07:30 Warsaw time in summer (UTC+2)', () => {
    expect(latestDueSubiektSlot(new Date('2026-06-10T05:30:00Z'))).toBe('2026-06-10')
  })

  it('should be yesterday at 07:29 Warsaw time', () => {
    expect(latestDueSubiektSlot(new Date('2026-06-10T05:29:00Z'))).toBe('2026-06-09')
  })

  it('should respect the winter offset (UTC+1)', () => {
    expect(latestDueSubiektSlot(new Date('2026-01-15T06:30:00Z'))).toBe('2026-01-15')
    expect(latestDueSubiektSlot(new Date('2026-01-15T06:29:00Z'))).toBe('2026-01-14')
  })

  it('should cross the year boundary before 07:30 on 1 January', () => {
    expect(latestDueSubiektSlot(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31')
  })
})

describe('isSubiektSlotPending', () => {
  it('should run once per slot and catch up a newer one', () => {
    expect(isSubiektSlotPending('2026-06-10', null)).toBe(true)
    expect(isSubiektSlotPending('2026-06-10', '2026-06-10')).toBe(false)
    expect(isSubiektSlotPending('2026-06-11', '2026-06-10')).toBe(true)
  })
})

function createDb(settings: Record<string, string>, options: { admin?: string | null } = {}) {
  const store = new Map(Object.entries(settings))
  const db = {
    user: { findFirst: vi.fn(async () => (options.admin === null ? null : { id: options.admin ?? 'admin-1' })) },
    appSetting: {
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((key) => store.has(key)).map((key) => ({ key, value: store.get(key)! }))),
      upsert: vi.fn(({ where, update }: { where: { key: string }; update: { value: string } }) => { store.set(where.key, update.value); return Promise.resolve() }),
    },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  }
  return { db: db as unknown as PrismaClient, store }
}

const NOW = new Date('2026-06-10T05:45:00Z')

describe('runScheduledSubiektSync', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    refreshMock.mockResolvedValue({ ok: true, fetchedAt: NOW.toISOString(), rows: 4, unmappedWarehouses: [], mapProblems: [] })
  })

  it('should skip when the slot already ran', async () => {
    const { db } = createDb({ 'subiekt_bridge.auto_sync_slot': '2026-06-10' })
    await expect(runScheduledSubiektSync(db, NOW)).resolves.toEqual({ ran: false, reason: 'NOT_DUE' })
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('should claim the slot, refresh and record OK', async () => {
    const { db, store } = createDb({})
    const outcome = await runScheduledSubiektSync(db, NOW)
    expect(outcome).toMatchObject({ ran: true, slot: '2026-06-10', status: 'OK' })
    expect(store.get('subiekt_bridge.auto_sync_slot')).toBe('2026-06-10')
    expect(store.get('subiekt_bridge.auto_sync_status')).toBe('OK')
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('should record ERROR with the Polish message when the bridge is down and not retry the same slot', async () => {
    refreshMock.mockResolvedValue({ ok: false, kind: 'unavailable', error: 'Mostek Subiekt jest niedostępny.' })
    const { db, store } = createDb({})
    const first = await runScheduledSubiektSync(db, NOW)
    expect(first).toMatchObject({ ran: true, status: 'ERROR', message: 'Mostek Subiekt jest niedostępny.' })
    expect(store.get('subiekt_bridge.auto_sync_message')).toBe('Mostek Subiekt jest niedostępny.')
    await expect(runScheduledSubiektSync(db, NOW)).resolves.toEqual({ ran: false, reason: 'NOT_DUE' })
  })

  it('should release the slot and record a generic ERROR when the refresh throws, so the next tick retries', async () => {
    refreshMock.mockRejectedValueOnce(new Error('SQLITE_BUSY: database is locked'))
    const { db, store } = createDb({ 'subiekt_bridge.auto_sync_slot': '2026-06-09' })
    const first = await runScheduledSubiektSync(db, NOW)
    expect(first).toMatchObject({ ran: true, slot: '2026-06-10', status: 'ERROR' })
    expect(first.ran && first.message).not.toContain('SQLITE')
    expect(store.get('subiekt_bridge.auto_sync_slot')).toBe('2026-06-09')
    expect(store.get('subiekt_bridge.auto_sync_status')).toBe('ERROR')
    const second = await runScheduledSubiektSync(db, NOW)
    expect(second).toMatchObject({ ran: true, status: 'OK' })
    expect(store.get('subiekt_bridge.auto_sync_slot')).toBe('2026-06-10')
  })

  it('should log one JSON line per run from the scheduler tick', async () => {
    const { db } = createDb({})
    const log = { info: vi.fn(), error: vi.fn() }
    await runSubiektAutoSyncTick(db, NOW, log)
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(JSON.parse(log.info.mock.calls[0][0] as string)).toMatchObject({ event: 'SUBIEKT_AUTO_SYNC', ran: true, slot: '2026-06-10', status: 'OK' })
    await runSubiektAutoSyncTick(db, NOW, log)
    expect(log.info).toHaveBeenCalledTimes(1)
  })
})

describe('runScheduledSubiektSync purchases import', () => {
  const importMock = vi.fn()
  const IMPORT_ERROR_MESSAGE = 'subiekt_purchases.last_import_message'
  beforeEach(() => {
    vi.stubEnv('SUBIEKT_PURCHASES_AUTO_IMPORT', 'on')
    refreshMock.mockReset()
    refreshMock.mockResolvedValue({ ok: true, fetchedAt: NOW.toISOString(), rows: 4, unmappedWarehouses: [], mapProblems: [] })
    importMock.mockReset()
    importMock.mockResolvedValue({ ok: true, created: 2 })
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('should import with the oldest active admin after the sales refresh when enabled', async () => {
    const { db } = createDb({})
    await runScheduledSubiektSync(db, NOW, { importPurchases: importMock })
    expect(importMock).toHaveBeenCalledWith(db, { actorId: 'admin-1', now: NOW })
    const findFirst = (db as unknown as { user: { findFirst: ReturnType<typeof vi.fn> } }).user.findFirst
    expect(findFirst).toHaveBeenCalledWith({
      where: { role: 'ADMIN', isActive: true, mustChangePassword: false }, select: { id: true }, orderBy: { createdAt: 'asc' },
    })
  })

  it('should not import when the variable is off or unset', async () => {
    vi.stubEnv('SUBIEKT_PURCHASES_AUTO_IMPORT', 'off')
    await runScheduledSubiektSync(createDb({}).db, NOW, { importPurchases: importMock })
    vi.unstubAllEnvs()
    await runScheduledSubiektSync(createDb({}).db, NOW, { importPurchases: importMock })
    expect(importMock).not.toHaveBeenCalled()
  })

  it('should write a Polish error and skip the import when there is no active admin', async () => {
    const { db, store } = createDb({}, { admin: null })
    await runScheduledSubiektSync(db, NOW, { importPurchases: importMock })
    expect(importMock).not.toHaveBeenCalled()
    expect(store.get(IMPORT_ERROR_MESSAGE)).toBe('Błąd: Brak aktywnego administratora do automatycznego importu faktur UE.')
  })

  it('should keep the sales status OK and write an error message when the import throws', async () => {
    importMock.mockRejectedValue(new Error('SQLITE_BUSY'))
    const { db, store } = createDb({})
    const outcome = await runScheduledSubiektSync(db, NOW, { importPurchases: importMock })
    expect(outcome).toMatchObject({ ran: true, status: 'OK' })
    expect(store.get('subiekt_bridge.auto_sync_status')).toBe('OK')
    expect(store.get('subiekt_bridge.auto_sync_slot')).toBe('2026-06-10')
    expect(store.get(IMPORT_ERROR_MESSAGE)).toBe('Błąd: Automatyczny import faktur UE przerwany błędem aplikacji.')
  })

  it('should still import when the sales refresh failed and keep the sales status ERROR', async () => {
    refreshMock.mockResolvedValue({ ok: false, kind: 'unavailable', error: 'Mostek Subiekt jest niedostępny.' })
    const { db, store } = createDb({})
    const outcome = await runScheduledSubiektSync(db, NOW, { importPurchases: importMock })
    expect(importMock).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ ran: true, status: 'ERROR', message: 'Mostek Subiekt jest niedostępny.' })
    expect(store.get('subiekt_bridge.auto_sync_status')).toBe('ERROR')
  })

  it('should leave the sales status OK when the import reports a failure', async () => {
    importMock.mockResolvedValue({ ok: false, kind: 'unavailable', error: 'Mostek niedostępny.' })
    const { db, store } = createDb({})
    const outcome = await runScheduledSubiektSync(db, NOW, { importPurchases: importMock })
    expect(outcome).toMatchObject({ status: 'OK' })
    expect(store.get('subiekt_bridge.auto_sync_status')).toBe('OK')
  })

  it('should log the import outcome as one JSON line without amounts or supplier data', async () => {
    const { db } = createDb({})
    const log = { info: vi.fn(), error: vi.fn() }
    await runSubiektAutoSyncTick(db, NOW, log, { importPurchases: importMock })
    const lines = log.info.mock.calls.map((call) => JSON.parse(call[0] as string))
    expect(lines).toContainEqual({ event: 'SUBIEKT_PURCHASES_AUTO_IMPORT', ok: true, created: 2 })
  })
})
