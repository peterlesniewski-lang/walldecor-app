import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { getWikiAnswer } from '@/lib/wikipedia/ai'

const ChatSchema = z.object({
  question: z.string().min(1).max(500).trim(),
  articleTitle: z.string().optional(),
  articleCategory: z.string().optional(),
  articleContent: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = ChatSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { question, articleTitle, articleCategory, articleContent } = parsed.data

  const answer = await getWikiAnswer(question, articleTitle, articleCategory, articleContent)
  return NextResponse.json({ answer })
}
