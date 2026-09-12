import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createInvoiceImportHandlers } from './http'
import { createInvoiceFileEnvironment } from './files-runtime'

export const invoiceImportHandlers = createInvoiceImportHandlers({
  db: prisma,
  getSession: () => getServerSession(authOptions),
  files: () => createInvoiceFileEnvironment(),
})
