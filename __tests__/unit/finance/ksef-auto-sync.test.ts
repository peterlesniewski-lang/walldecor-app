import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/generated/prisma'
import { isSlotPending, latestDueSlot, runScheduledKsefSync } from '@/lib/finance/ksef-auto-sync'
import { KsefSyncConfigError, KsefSyncInProgressError, withKsefSyncLock } from '@/lib/finance/ksef-sync-service'

const runKsefSyncMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/finance/ksef-sync-service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/finance/ksef-sync-service')>(),
  runKsefSync: runKsefSyncMock,
}))

describe('latestDueSlot', () => {
  it('should return the morning slot after 07:00 Warsaw time (summer, UTC+2)', () => {
    expect(latestDueSlot(new Date('2026-06-10T05:30:00Z'))).toBe('2026-06-10T07')
  })

  it('should return the afternoon slot after 15:00 Warsaw time', () => {
    expect(latestDueSlot(new Date('2026-06-10T13:00:00Z'))).toBe('2026-06-10T15')
  })

  it('should fall back to the previous day afternoon slot before 07:00', () => {
    expect(latestDueSlot(new Date('2026-06-10T04:59:00Z'))).toBe('2026-06-09T15')
  })

  it('should use winter offset (UTC+1) for the morning slot', () => {
    expect(latestDueSlot(new Date('2026-01-15T06:00:00Z'))).toBe('2026-01-15T07')
  })

  it('should cross the year boundary on 1 January before 07:00', () => {
    expect(latestDueSlot(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31T15')
  })
})

describe('isSlotPending', () => {
  it('should run when no slot has been recorded yet', () => {
    expect(isSlotPending('2026-06-10T07', null)).toBe(true)
  })

  it('should not run the same slot twice', () => {
    expect(isSlotPending('2026-06-10T07', '2026-06-10T07')).toBe(false)
  })

  it('should run a newer slot', () => {
    expect(isSlotPending('2026-06-10T15', '2026-06-10T07')).toBe(true)
  })
})

function createDb(settings: Record<string, string>, admin: { id: string } | null = { id: 'admin-1' }) {
  const store = new Map(Object.entries(settings))
  const db = {
    appSetting: {
      findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
        where.key.in.filter((key) => store.has(key)).map((key) => ({ key, value: store.get(key)! }))),
      upsert: vi.fn(({ where, update }: { where: { key: string }; update: { value: string } }) => {
        store.set(where.key, update.value)
        return Promise.resolve()
      }),
    },
    user: { findFirst: vi.fn().mockResolvedValue(admin) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  }
  return { db: db as unknown as PrismaClient, store }
}

const NOW = new Date('2026-06-10T05:30:00Z')

describe('runScheduledKsefSync', () => {
  beforeEach(() => {
    runKsefSyncMock.mockReset()
    runKsefSyncMock.mockResolvedValue({ fetched: 3, imported: 2, updated: 1, linked: 0 })
  })

  it('should skip when the KSeF integration is disabled', async () => {
    const { db } = createDb({ ksef_enabled: 'false' })
    await expect(runScheduledKsefSync(db, NOW)).resolves.toEqual({ ran: false, reason: 'DISABLED' })
  })

  it('should skip when automatic sync was turned off', async () => {
    const { db } = createDb({ ksef_enabled: 'true', ksef_auto_sync_enabled: 'false' })
    await expect(runScheduledKsefSync(db, NOW)).resolves.toEqual({ ran: false, reason: 'DISABLED' })
  })

  it('should run the sync as the first active admin and record the slot', async () => {
    const { db, store } = createDb({ ksef_enabled: 'true' })
    const outcome = await runScheduledKsefSync(db, NOW)
    expect({ outcome, actor: runKsefSyncMock.mock.calls[0]?.[1], slot: store.get('ksef_auto_sync_last_slot'), status: store.get('ksef_auto_sync_last_status') })
      .toMatchObject({ outcome: { ran: true, slot: '2026-06-10T07', status: 'OK' }, actor: 'admin-1', slot: '2026-06-10T07', status: 'OK' })
  })

  it('should not run again within the same slot', async () => {
    const { db } = createDb({ ksef_enabled: 'true', ksef_auto_sync_last_slot: '2026-06-10T07' })
    await expect(runScheduledKsefSync(db, NOW)).resolves.toEqual({ ran: false, reason: 'NOT_DUE' })
  })

  it('should record an error and keep the slot claimed when KSeF fails', async () => {
    runKsefSyncMock.mockRejectedValue(new KsefSyncConfigError('Brakuje tokena KSeF albo NIP firmy w ustawieniach.'))
    const { db, store } = createDb({ ksef_enabled: 'true' })
    await runScheduledKsefSync(db, NOW)
    expect([store.get('ksef_auto_sync_last_status'), store.get('ksef_auto_sync_last_slot')]).toEqual(['ERROR', '2026-06-10T07'])
  })

  it('should record an error when there is no active admin', async () => {
    const { db, store } = createDb({ ksef_enabled: 'true' }, null)
    await runScheduledKsefSync(db, NOW)
    expect(store.get('ksef_auto_sync_last_status')).toBe('ERROR')
  })

  it('should mark the run as skipped while a manual sync is in progress', async () => {
    const { db } = createDb({ ksef_enabled: 'true' })
    let release!: () => void
    const manual = withKsefSyncLock(() => new Promise<void>((resolve) => { release = resolve }))
    const outcome = await runScheduledKsefSync(db, NOW)
    release()
    await manual
    expect(outcome).toMatchObject({ ran: true, status: 'SKIPPED' })
  })
})

describe('withKsefSyncLock', () => {
  it('should reject a concurrent run', async () => {
    let release!: () => void
    const first = withKsefSyncLock(() => new Promise<void>((resolve) => { release = resolve }))
    const second = withKsefSyncLock(async () => undefined)
    await expect(second).rejects.toBeInstanceOf(KsefSyncInProgressError)
    release()
    await first
  })
})
