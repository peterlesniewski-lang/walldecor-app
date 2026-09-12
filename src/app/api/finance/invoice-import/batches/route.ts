import { invoiceImportHandlers } from '@/lib/invoice-import/http-runtime'

export const runtime = 'nodejs'
export const POST = invoiceImportHandlers.batchesPOST
