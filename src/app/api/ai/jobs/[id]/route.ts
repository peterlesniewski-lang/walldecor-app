import { NextRequest } from 'next/server'
import { aiChatHandlers } from '@/lib/ai/http-runtime'

export const runtime = 'nodejs'
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return aiChatHandlers.jobGET((await params).id)
}
