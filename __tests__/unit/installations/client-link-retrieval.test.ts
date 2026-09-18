import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import * as links from '@/lib/installations/client-link'
import { ClientLinkEncryptionConfigurationError, encryptClientLinkToken } from '@/lib/installations/client-link-crypto'

describe('persistent client links', () => {
  beforeEach(() => vi.stubEnv('INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64')))
  afterEach(() => vi.unstubAllEnvs())
  it('encrypts before touching/revoking the previous link', async () => {
    vi.stubEnv('INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY', '')
    const transaction = vi.fn()
    await expect(links.createClientLink({ $transaction: transaction } as unknown as PrismaClient, {
      orderId: 'order-1', createdById: 'user-1', expiresAt: new Date(Date.now() + 60000),
    })).rejects.toBeInstanceOf(ClientLinkEncryptionConfigurationError)
    expect(transaction).not.toHaveBeenCalled()
  })
  it('retrieves only the current active link and keeps legacy rows without regenerating', async () => {
    const token = links.createClientLinkSecret()
    const context = { orderId: 'order-1', tokenHash: links.hashClientLinkSecret(token) }
    const row = { id: 'link-1', ...context, tokenCiphertext: encryptClientLinkToken(token, context) }
    const findFirst = vi.fn().mockResolvedValue(row)
    const db = { installationClientLink: { findFirst } } as unknown as PrismaClient
    expect(await links.retrieveCurrentClientLink(db, 'order-1')).toMatchObject({ token, reason: null })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orderId: 'order-1', revokedAt: null, expiresAt: { gt: expect.any(Date) } }) }))
    findFirst.mockResolvedValue({ ...row, tokenCiphertext: null })
    expect(await links.retrieveCurrentClientLink(db, 'order-1')).toMatchObject({ token: null, reason: 'LEGACY_HASH_ONLY' })
    findFirst.mockResolvedValue(null)
    expect(await links.retrieveCurrentClientLink(db, 'order-1')).toEqual({ link: null, token: null, reason: 'NO_ACTIVE_LINK' })
  })
})
