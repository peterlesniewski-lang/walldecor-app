import { NextRequest } from 'next/server'
import { aiChatHandlers } from '@/lib/ai/http-runtime'

export const runtime = 'nodejs'
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return aiChatHandlers.retryPOST((await params).id)
}
