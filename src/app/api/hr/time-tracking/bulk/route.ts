import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createBulkTimeEntryHandler } from './handler'

export const POST = createBulkTimeEntryHandler({
  prisma,
  getSession: () => getServerSession(authOptions),
})
