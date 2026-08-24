import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { LoginSchema } from '@/lib/validations/auth'
import { normalizeEmailLocalPart } from '@/lib/accounts/policy'

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours — one work day
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Login', type: 'text' },
        password: { label: 'Hasło', type: 'password' },
      },
      async authorize(credentials) {
        const result = LoginSchema.safeParse(credentials)
        if (!result.success) return null

        let user = await prisma.user.findUnique({
          where: { username: result.data.username },
        })

        if (!user) {
          const legacyUsers = await prisma.user.findMany({
            where: { username: null },
          })
          user = legacyUsers.find(
            (legacyUser) => normalizeEmailLocalPart(legacyUser.email) === result.data.username
          ) ?? null
        }

        if (!user) return null

        if (!user.isActive) {
          throw new Error('Konto zostało zablokowane. Skontaktuj się z administratorem.')
        }

        const passwordMatch = await bcrypt.compare(
          result.data.password,
          user.passwordHash
        )

        if (!passwordMatch) return null

        if (!user.username) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { username: result.data.username },
          })
        }

        return {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'INSTALLER',
          employeeId: user.employeeId,
          mustChangePassword: user.mustChangePassword,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.username = user.username
        token.role = user.role
        token.employeeId = user.employeeId
        token.mustChangePassword = user.mustChangePassword
      }

      if (token.id && (!user || trigger === 'update')) {
        const currentUser = await prisma.user.findUnique({
          where: { id: String(token.id) },
          select: {
            username: true,
            role: true,
            employeeId: true,
            mustChangePassword: true,
            isActive: true,
          },
        })

        if (currentUser) {
          token.username = currentUser.username
          token.role = currentUser.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'INSTALLER'
          token.employeeId = currentUser.employeeId
          token.mustChangePassword = currentUser.mustChangePassword || !currentUser.isActive
        }
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.id
      session.user.username = token.username
      session.user.role = token.role
      session.user.employeeId = token.employeeId
      session.user.mustChangePassword = token.mustChangePassword
      return session
    },
  },
}
