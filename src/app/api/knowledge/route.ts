import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getArticles, createArticle } from '@/lib/wikipedia/actions'
import { searchArticles } from '@/lib/wikipedia/search'
import { ArticleCreateSchema, ArticleQuerySchema } from '@/lib/validations/wikipedia'
import slugify from 'slugify'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Defense in depth: installers use the isolated installation guides, never
  // the general Business Wiki, even if a future proxy rule changes.
  if (session.user.role === 'INSTALLER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const parsed = ArticleQuerySchema.safeParse({
    category: searchParams.get('category') ?? undefined,
    type: searchParams.get('type') ?? undefined,
    q: q || undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const role = session.user.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

  if (q.length >= 2) {
    const results = await searchArticles(q, role, session.user.id)
    return NextResponse.json(results.filter((article) => {
      if (parsed.data.category && parsed.data.category !== 'all' && article.category !== parsed.data.category) return false
      if (parsed.data.type && parsed.data.type !== 'all' && article.type !== parsed.data.type) return false
      return true
    }))
  }

  const articles = await getArticles(parsed.data, role, session.user.id)
  return NextResponse.json(articles)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()

  // Auto-generate slug if not provided
  if (!body.slug && body.title) {
    body.slug = slugify(body.title, { lower: true, strict: true })
  }

  const parsed = ArticleCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }

  const article = await createArticle(parsed.data)
  return NextResponse.json(article, { status: 201 })
}
