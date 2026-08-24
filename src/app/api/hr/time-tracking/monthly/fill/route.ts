import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getHrSettings } from '@/lib/hr/hr-settings'
import { prisma } from '@/lib/prisma'
import { createTimeEntryFillHandler } from './handler'

export const POST = createTimeEntryFillHandler({
  prisma,
  getSession: () => getServerSession(authOptions),
  getHrSettings,
})
