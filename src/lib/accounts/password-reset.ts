import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { generateTemporaryPassword } from './security'
import { sendPasswordResetEmail, type PasswordResetEmailInput } from '@/lib/email/password-reset-email'

const userSelect = {
  id: true,
  email: true,
  name: true,
  username: true,
  isActive: true,
  passwordHash: true,
  mustChangePassword: true,
  passwordChangedAt: true,
}

interface ResetUser {
  id: string
  email: string
  name: string
  username: string | null
  isActive: boolean
  passwordHash: string
  mustChangePassword: boolean
  passwordChangedAt: Date | null
}

interface UsersStore {
  findUnique(args: { where: { email: string }; select: typeof userSelect }): Promise<ResetUser | null>
  update(args: {
    where: { id: string }
    data: {
      passwordHash: string
      mustChangePassword: boolean
      passwordChangedAt: Date | null
    }
  }): Promise<unknown>
}

export interface RequestPasswordResetInput {
  email: string
  appUrl: string
  users?: UsersStore
  generatePassword?: () => string
  hashPassword?: (password: string) => Promise<string>
  sendPasswordResetEmail?: (input: PasswordResetEmailInput) => Promise<void>
}

export type PasswordResetStatus = 'sent' | 'ignored'

export const PASSWORD_RESET_ACCEPTED_MESSAGE =
  'Jeśli konto z tym adresem email istnieje, wyślemy wiadomość z hasłem tymczasowym.'

export async function requestPasswordReset(input: RequestPasswordResetInput): Promise<{ status: PasswordResetStatus }> {
  const email = normalizeResetEmail(input.email)
  const users = input.users ?? prisma.user
  const user = await users.findUnique({ where: { email }, select: userSelect })

  if (!user?.isActive) {
    return { status: 'ignored' }
  }

  const generatePassword = input.generatePassword ?? generateTemporaryPassword
  const hashPassword = input.hashPassword ?? ((password: string) => bcrypt.hash(password, 12))
  const emailSender = input.sendPasswordResetEmail ?? sendPasswordResetEmail
  const temporaryPassword = generatePassword()
  const passwordHash = await hashPassword(temporaryPassword)

  await users.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: true,
      passwordChangedAt: null,
    },
  })

  try {
    await emailSender({
      to: user.email,
      name: user.name,
      username: user.username,
      temporaryPassword,
      loginUrl: buildLoginUrl(input.appUrl),
    })
  } catch (error) {
    await users.update({
      where: { id: user.id },
      data: {
        passwordHash: user.passwordHash,
        mustChangePassword: user.mustChangePassword,
        passwordChangedAt: user.passwordChangedAt,
      },
    })
    throw error
  }

  return { status: 'sent' }
}

export function normalizeResetEmail(email: string) {
  return email.trim().toLowerCase()
}

function buildLoginUrl(appUrl: string) {
  return new URL('/login', appUrl).toString()
}
