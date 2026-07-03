import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/account/request-password-reset/route'
import { requestPasswordReset, PASSWORD_RESET_ACCEPTED_MESSAGE } from '@/lib/accounts/password-reset'
import { isEmailDeliveryConfigured } from '@/lib/email/outbound-email'

vi.mock('@/lib/accounts/password-reset', async () => {
  const actual = await vi.importActual<typeof import('@/lib/accounts/password-reset')>(
    '@/lib/accounts/password-reset'
  )
  return {
    ...actual,
    requestPasswordReset: vi.fn(),
  }
})

vi.mock('@/lib/email/outbound-email', () => ({
  isEmailDeliveryConfigured: vi.fn(),
}))

const mockRequestPasswordReset = vi.mocked(requestPasswordReset)
const mockIsEmailDeliveryConfigured = vi.mocked(isEmailDeliveryConfigured)

function postRequest(body: unknown) {
  return new NextRequest('https://app.walldecor.pl/api/account/request-password-reset', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsEmailDeliveryConfigured.mockReturnValue(true)
  mockRequestPasswordReset.mockResolvedValue({ status: 'sent' })
})

describe('/api/account/request-password-reset', () => {
  it('accepts a reset request without revealing whether the account exists', async () => {
    const response = await POST(postRequest({ email: ' JAN.KOWALSKI@WALLDECOR.PL ' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ message: PASSWORD_RESET_ACCEPTED_MESSAGE })
    expect(mockRequestPasswordReset).toHaveBeenCalledWith({
      email: 'jan.kowalski@walldecor.pl',
      appUrl: 'https://app.walldecor.pl',
    })
  })

  it('rejects malformed email input', async () => {
    const response = await POST(postRequest({ email: 'nie-email' }))

    expect(response.status).toBe(400)
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })

  it('reports missing email delivery configuration before looking up the account', async () => {
    mockIsEmailDeliveryConfigured.mockReturnValue(false)

    const response = await POST(postRequest({ email: 'jan.kowalski@walldecor.pl' }))

    expect(response.status).toBe(503)
    expect(mockRequestPasswordReset).not.toHaveBeenCalled()
  })
})
