import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLeaveApprovalHandler } from './handler'

export const PATCH = createLeaveApprovalHandler({
  prisma,
  getSession: () => getServerSession(authOptions),
})
