import type { PrismaClient } from '@/generated/prisma'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallationClientLinkNotFoundError, markClientLinkSent } from '@/lib/installations/client-link'

afterEach(() => vi.useRealTimers())

describe('markClientLinkSent', () => {
  it('checks expiry when the transaction executes, not when it is requested', async () => {
    vi.useFakeTimers()
    const expiresAt = new Date('2026-08-23T08:00:00.000Z')
    vi.setSystemTime(new Date('2026-08-23T07:59:00.000Z'))
    const link = { id: 'link-1', orderId: 'order-1', expiresAt, revokedAt: null }
    const transaction = {
      installationClientLink: {
        findUnique: vi.fn().mockResolvedValue(link),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      installationAuditEvent: { create: vi.fn() },
    }
    const db = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => {
        vi.setSystemTime(new Date('2026-08-23T08:01:00.000Z'))
        return callback(transaction)
      }),
    } as unknown as PrismaClient

    await expect(markClientLinkSent(db, 'link-1', 'owner-user', 'order-1')).rejects.toBeInstanceOf(InstallationClientLinkNotFoundError)
    expect(transaction.installationClientLink.updateMany).not.toHaveBeenCalled()
    expect(transaction.installationAuditEvent.create).not.toHaveBeenCalled()
  })
})
