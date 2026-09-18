import { NextRequest } from 'next/server'
import { invoiceImportHandlers } from '@/lib/invoice-import/http-runtime'

export const runtime = 'nodejs'
type Context = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Context) {
  const { id } = await params
  return invoiceImportHandlers.draftGET(id)
}

export async function PATCH(req: NextRequest, { params }: Context) {
  const { id } = await params
  return invoiceImportHandlers.draftPATCH(req, id)
}
