import { describe, expect, it, vi } from 'vitest'

vi.mock('next-auth/middleware', () => ({ withAuth: (handler: unknown) => handler }))

import { config } from '@/proxy'

const matcher = new RegExp(`^${config.matcher[0]}$`)

describe('public installation proxy boundary', () => {
  it.each(['/m/a'.repeat(43), '/m/token', '/api/public/installations/token', '/api/public/installations/token/autosave', '/api/public/mobile-upload/code/redeem', '/api/public/mobile-upload/session/files'])('does not require dashboard authentication for %s', (pathname) => {
    expect(matcher.test(pathname)).toBe(false)
  })

  it.each(['/dashboard', '/installations/order-1', '/api/installations', '/api/installations/order-1', '/api/public/anything-else'])('keeps all other application routes protected: %s', (pathname) => {
    expect(matcher.test(pathname)).toBe(true)
  })
})
