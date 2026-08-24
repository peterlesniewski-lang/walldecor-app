import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createClockInHandler } from './handler'

export const POST = createClockInHandler({
  prisma,
  getSession: () => getServerSession(authOptions),
})
