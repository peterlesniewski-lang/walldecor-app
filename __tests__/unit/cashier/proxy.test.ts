import { describe, expect, it } from 'vitest'
import { requiresProxySession } from '@/proxy'

describe('cashier session transport', () => {
  it('delegates only the exact API to its database-backed 401 handler', () => {
    expect(requiresProxySession('/api/cashier')).toBe(false)
    expect(requiresProxySession('/api/import/revenue')).toBe(false)
    for (const pathname of ['/cashier', '/api/cashier-other', '/api/import/revenue-other', '/api/users', '/dashboard']) expect(requiresProxySession(pathname)).toBe(true)
  })
})
