import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as { user: { id: string; role: string } } | null,
  readiness: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/installations/calendar-server-config', () => ({ getInstallationCalendarReadiness: mocks.readiness }))

import { GET } from '@/app/api/settings/installation-calendar/route'

describe('installation Calendar settings route', () => {
  beforeEach(() => {
    mocks.session = { user: { id: 'admin-1', role: 'ADMIN' } }
    mocks.readiness.mockReset().mockReturnValue({
      enabled: true,
      adapter: 'google',
      credentialsConfigured: true,
      calendarConfigured: true,
      impersonationConfigured: true,
      ready: true,
    })
  })

  it('returns only safe readiness flags to an administrator', async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      enabled: true,
      adapter: 'google',
      credentialsConfigured: true,
      calendarConfigured: true,
      impersonationConfigured: true,
      ready: true,
    })
    expect(JSON.stringify(body)).not.toContain('private_key')
    expect(JSON.stringify(body)).not.toContain('test-calendar@')
  })

  it('refuses callers without the administrator role', async () => {
    mocks.session = null
    expect((await GET()).status).toBe(401)

    mocks.session = { user: { id: 'manager-1', role: 'MANAGER' } }
    expect((await GET()).status).toBe(403)
    expect(mocks.readiness).not.toHaveBeenCalled()
  })
})
