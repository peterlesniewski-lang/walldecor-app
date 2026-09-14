import { invoiceImportHandlers } from '@/lib/invoice-import/http-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const GET = invoiceImportHandlers.exchangeRateGET
