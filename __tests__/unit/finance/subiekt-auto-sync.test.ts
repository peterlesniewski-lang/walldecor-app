import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/generated/prisma'
import { isSubiektSlotPending, latestDueSubiektSlot, runScheduledSubiektSync } from '@/lib/finance/subiekt-auto-sync'

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

function createDb(settings: Record<string, string>) {
  const store = new Map(Object.entries(settings))
  const db = {
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
})
