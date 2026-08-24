import { describe, expect, it } from 'vitest'
import {
  createClientLinkSecret,
  hashClientLinkSecret,
  isWellFormedClientLinkSecret,
  publicClientLinkNotFound,
} from '@/lib/installations/client-link'

describe('installation client links', () => {
  it('creates a URL-safe random secret with at least 256 bits of entropy', () => {
    const first = createClientLinkSecret()
    const second = createClientLinkSecret()

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first).not.toBe(second)
    expect(isWellFormedClientLinkSecret(first)).toBe(true)
  })

  it('hashes the secret deterministically without retaining a plaintext representation', () => {
    const secret = createClientLinkSecret()
    const hash = hashClientLinkSecret(secret)

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).toBe(hashClientLinkSecret(secret))
    expect(hash).not.toContain(secret)
  })

  it.each(['', 'short', 'x'.repeat(44), 'a'.repeat(42), 'abc+def/ghi'])('rejects malformed secrets: %j', (secret) => {
    expect(isWellFormedClientLinkSecret(secret)).toBe(false)
  })

  it('uses one generic public 404 response for every unavailable link', async () => {
    const expired = publicClientLinkNotFound()
    const revoked = publicClientLinkNotFound()
    const random = publicClientLinkNotFound()

    const [expiredBody, revokedBody, randomBody] = await Promise.all([
      expired.text(),
      revoked.text(),
      random.text(),
    ])
    expect(expired.status).toBe(404)
    expect(expiredBody).toBe(revokedBody)
    expect(revokedBody).toBe(randomBody)
    expect(expired.headers.get('cache-control')).toBe('no-store')
  })
})
