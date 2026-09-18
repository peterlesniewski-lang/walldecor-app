import { NextRequest } from 'next/server'
import { invoiceImportHandlers } from '@/lib/invoice-import/http-runtime'

export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Context) {
  const { id } = await params
  return invoiceImportHandlers.actionsPOST(req, id)
}
