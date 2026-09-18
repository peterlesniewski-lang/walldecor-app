import { prisma } from '@/lib/prisma'
import { createAiWorkerHandler } from '@/lib/ai/worker-http'
import { createInvoiceFileEnvironment } from '@/lib/invoice-import/files-runtime'

export const runtime = 'nodejs'
export const POST = createAiWorkerHandler({
  db: prisma,
  secret: () => process.env.AI_WORKER_SECRET,
  files: () => createInvoiceFileEnvironment(),
})
