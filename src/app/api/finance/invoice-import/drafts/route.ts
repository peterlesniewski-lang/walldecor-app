import { invoiceImportHandlers } from '@/lib/invoice-import/http-runtime'

export const runtime = 'nodejs'
export const GET = invoiceImportHandlers.draftsGET
export const POST = invoiceImportHandlers.draftsPOST
