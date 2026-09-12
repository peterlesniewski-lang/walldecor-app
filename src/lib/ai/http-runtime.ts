import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createAiChatHandlers } from './chat-http'

export const aiChatHandlers = createAiChatHandlers({ db: prisma, getSession: () => getServerSession(authOptions) })
