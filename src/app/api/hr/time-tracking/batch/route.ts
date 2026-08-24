import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHrSettings } from '@/lib/hr/hr-settings'
import { createTimeEntryBatchHandler } from './handler'

export const POST = createTimeEntryBatchHandler({
  prisma,
  getSession: () => getServerSession(authOptions),
  getHrSettings,
})
