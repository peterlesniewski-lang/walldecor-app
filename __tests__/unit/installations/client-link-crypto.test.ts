import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCipheriv } from 'node:crypto'
import * as crypto from '@/lib/installations/client-link-crypto'
import { createClientLinkSecret, hashClientLinkSecret } from '@/lib/installations/client-link'

describe('recoverable client link encryption', () => {
  beforeEach(() => vi.stubEnv('INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64')))
  afterEach(() => vi.unstubAllEnvs())
  it('round trips with randomized authenticated ciphertext', () => {
    const token = createClientLinkSecret()
    const context = { orderId: 'order-1', tokenHash: hashClientLinkSecret(token) }
    const encrypted = crypto.encryptClientLinkToken(token, context)
    expect(encrypted).toMatch(/^v1\./)
    expect(encrypted).not.toContain(token)
    expect(crypto.encryptClientLinkToken(token, context)).not.toBe(encrypted)
    expect(crypto.decryptClientLinkToken(encrypted, context)).toBe(token)
  })
  it('rejects tampering, swapped order/hash, and a different key', () => {
    const token = createClientLinkSecret()
    const context = { orderId: 'order-1', tokenHash: hashClientLinkSecret(token) }
    const encrypted = crypto.encryptClientLinkToken(token, context)
    for (const value of ['v2' + encrypted.slice(2), encrypted.slice(0, -4) + 'AAAA']) {
      expect(() => crypto.decryptClientLinkToken(value, context)).toThrow(crypto.ClientLinkDecryptionError)
    }
    expect(() => crypto.decryptClientLinkToken(encrypted, { ...context, orderId: 'other' })).toThrow(crypto.ClientLinkDecryptionError)
    expect(() => crypto.decryptClientLinkToken(encrypted, { ...context, tokenHash: 'a'.repeat(64) })).toThrow(crypto.ClientLinkDecryptionError)
    vi.stubEnv('INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY', Buffer.alloc(32, 8).toString('base64'))
    expect(() => crypto.decryptClientLinkToken(encrypted, context)).toThrow(crypto.ClientLinkDecryptionError)
  })
  it.each(['', 'bad', Buffer.alloc(31).toString('base64')])('rejects invalid dedicated key %s without fallback', (key) => {
    vi.stubEnv('INSTALLATION_CLIENT_LINK_ENCRYPTION_KEY', key)
    vi.stubEnv('NEXTAUTH_SECRET', 'not-an-encryption-key')
    expect(() => crypto.encryptClientLinkToken('a'.repeat(43), { orderId: '1', tokenHash: 'a' })).toThrow(crypto.ClientLinkEncryptionConfigurationError)
  })
  it('validates token format and hash after successful authentication/decryption', () => {
    for (const token of ['*'.repeat(43), 'a'.repeat(43)]) {
      const context = { orderId: 'order-1', tokenHash: 'f'.repeat(64) }
      const iv = Buffer.alloc(12, 1)
      const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 7), iv)
      cipher.setAAD(Buffer.from(JSON.stringify(['installation-client-link', 'v1', context.orderId, context.tokenHash])))
      const ciphertext = Buffer.concat([cipher.update(token), cipher.final()])
      const encrypted = ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
      expect(() => crypto.decryptClientLinkToken(encrypted, context)).toThrow(crypto.ClientLinkDecryptionError)
    }
  })
})
