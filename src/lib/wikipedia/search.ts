import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma'

type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

interface SearchResult {
  id: string
  title: string
  slug: string
  category: string
  visibility: string
  type: string
  tags: string
  updatedAt: Date
  content: string
}

export async function searchArticles(query: string, role: Role): Promise<SearchResult[]> {
  const visibilityCondition = role === 'EMPLOYEE' ? Prisma.sql`AND a.visibility = 'public'` : Prisma.empty

  if (query.length < 2) {
    return prisma.$queryRaw<SearchResult[]>`
      SELECT a.id, a.title, a.slug, a.category, a.visibility, a.type, a.tags, a.updatedAt, a.content
      FROM Article a
      WHERE 1=1 ${visibilityCondition}
      ORDER BY a.category ASC, a.title ASC
      LIMIT 50
    `
  }

  try {
    const results = await prisma.$queryRaw<SearchResult[]>`
      SELECT a.id, a.title, a.slug, a.category, a.visibility, a.type, a.tags, a.updatedAt, a.content
      FROM Article a
      JOIN article_fts f ON a.rowid = f.rowid
      WHERE article_fts MATCH ${query + '*'}
      ${visibilityCondition}
      ORDER BY rank
      LIMIT 30
    `
    return results
  } catch {
    // Fallback to LIKE search if FTS fails
    return prisma.$queryRaw<SearchResult[]>`
      SELECT a.id, a.title, a.slug, a.category, a.visibility, a.type, a.tags, a.updatedAt, a.content
      FROM Article a
      WHERE (a.title LIKE ${'%' + query + '%'} OR a.content LIKE ${'%' + query + '%'})
      ${visibilityCondition}
      ORDER BY a.category ASC, a.title ASC
      LIMIT 30
    `
  }
}
