import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestPasswordReset } from '@/lib/accounts/password-reset'

const mockFindUnique = vi.fn()
const mockUpdate = vi.fn()
const mockSendEmail = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requestPasswordReset', () => {
  it('sets a temporary password, requires password change, and emails the login link', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'jan.kowalski@walldecor.pl',
      name: 'Jan Kowalski',
      username: 'jankowalski',
      isActive: true,
      passwordHash: 'old-hash',
      mustChangePassword: false,
      passwordChangedAt: new Date('2026-01-02T00:00:00.000Z'),
    })
    mockUpdate.mockResolvedValue({})

    const result = await requestPasswordReset({
      email: ' JAN.KOWALSKI@WALLDECOR.PL ',
      appUrl: 'https://app.walldecor.pl',
      users: { findUnique: mockFindUnique, update: mockUpdate },
      generatePassword: () => 'TempPass1!',
      hashPassword: async (password) => `hashed:${password}`,
      sendPasswordResetEmail: mockSendEmail,
    })

    expect(result.status).toBe('sent')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { email: 'jan.kowalski@walldecor.pl' },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        isActive: true,
        passwordHash: true,
        mustChangePassword: true,
        passwordChangedAt: true,
      },
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordHash: 'hashed:TempPass1!',
        mustChangePassword: true,
        passwordChangedAt: null,
      },
    })
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'jan.kowalski@walldecor.pl',
      name: 'Jan Kowalski',
      username: 'jankowalski',
      temporaryPassword: 'TempPass1!',
      loginUrl: 'https://app.walldecor.pl/login',
    })
  })

  it('does not reveal whether an email has no active user account', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await requestPasswordReset({
      email: 'missing@walldecor.pl',
      appUrl: 'https://app.walldecor.pl',
      users: { findUnique: mockFindUnique, update: mockUpdate },
      generatePassword: () => 'TempPass1!',
      hashPassword: async (password) => `hashed:${password}`,
      sendPasswordResetEmail: mockSendEmail,
    })

    expect(result.status).toBe('ignored')
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rolls back the temporary password when email delivery fails', async () => {
    const oldPasswordChangedAt = new Date('2026-01-02T00:00:00.000Z')
    mockFindUnique.mockResolvedValue({
      id: 'user-1',
      email: 'jan.kowalski@walldecor.pl',
      name: 'Jan Kowalski',
      username: 'jankowalski',
      isActive: true,
      passwordHash: 'old-hash',
      mustChangePassword: false,
      passwordChangedAt: oldPasswordChangedAt,
    })
    mockUpdate.mockResolvedValue({})
    mockSendEmail.mockRejectedValue(new Error('SMTP unavailable'))

    await expect(
      requestPasswordReset({
        email: 'jan.kowalski@walldecor.pl',
        appUrl: 'https://app.walldecor.pl',
        users: { findUnique: mockFindUnique, update: mockUpdate },
        generatePassword: () => 'TempPass1!',
        hashPassword: async (password) => `hashed:${password}`,
        sendPasswordResetEmail: mockSendEmail,
      })
    ).rejects.toThrow('SMTP unavailable')

    expect(mockUpdate).toHaveBeenLastCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordHash: 'old-hash',
        mustChangePassword: false,
        passwordChangedAt: oldPasswordChangedAt,
      },
    })
  })
})
