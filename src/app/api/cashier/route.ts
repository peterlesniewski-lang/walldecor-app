import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createCashierHandlers } from '@/lib/cashier/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const handlers = createCashierHandlers({ db: prisma, getSession: () => getServerSession(authOptions) })
export const GET = handlers.GET
export const POST = handlers.POST
