import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createManualTimeEntryHandler } from './handler'

export const POST = createManualTimeEntryHandler({
  prisma,
  getSession: () => getServerSession(authOptions),
})
