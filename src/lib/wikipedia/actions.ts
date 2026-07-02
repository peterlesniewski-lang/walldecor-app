import { prisma } from '@/lib/prisma'
import type { ArticleCreateInput, ArticleUpdateInput, ArticleQuery } from '@/lib/validations/wikipedia'
import { getGrantedResourceIds, hasOperationGrant } from '@/lib/operations/visibility'

type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

async function visibilityFilter(role: Role, viewerId?: string) {
  if (role !== 'EMPLOYEE') return {}

  const grantedProcedureIds = viewerId
    ? await getGrantedResourceIds({ id: viewerId, role }, 'procedure')
    : []

  return {
    OR: [
      { visibility: 'public' },
      { type: 'procedure', id: { in: grantedProcedureIds ?? [] } },
    ],
  }
}

async function canEmployeeViewArticle(article: { id: string; visibility: string; type: string }, viewerId?: string) {
  if (article.visibility === 'public') return true
  if (article.type !== 'procedure' || !viewerId) return false
  return hasOperationGrant({ id: viewerId, role: 'EMPLOYEE' }, 'procedure', article.id)
}

export async function getArticles(filters: ArticleQuery, role: Role, viewerId?: string) {
  const where: Record<string, unknown> = { ...(await visibilityFilter(role, viewerId)) }

  if (filters.category && filters.category !== 'all') {
    where.category = filters.category
  }
  if (filters.type && filters.type !== 'all') {
    where.type = filters.type
  }

  return prisma.article.findMany({
    where,
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
    select: {
      id: true,
      title: true,
      slug: true,
      category: true,
      visibility: true,
      type: true,
      tags: true,
      updatedAt: true,
      content: true,
    },
  })
}

export async function getArticle(slug: string, role: Role, viewerId?: string) {
  const article = await prisma.article.findUnique({ where: { slug } })
  if (!article) return null
  if (role === 'EMPLOYEE' && !(await canEmployeeViewArticle(article, viewerId))) return null
  return article
}

export async function createArticle(data: ArticleCreateInput) {
  return prisma.article.create({
    data: {
      ...data,
      tags: JSON.stringify(data.tags ?? []),
    },
  })
}

export async function updateArticle(id: string, data: ArticleUpdateInput) {
  const updateData: Record<string, unknown> = { ...data }
  if (data.tags !== undefined) {
    updateData.tags = JSON.stringify(data.tags)
  }
  return prisma.article.update({ where: { id }, data: updateData })
}

export async function deleteArticle(id: string) {
  return prisma.article.delete({ where: { id } })
}

export async function updateAuthorNote(id: string, note: string) {
  return prisma.article.update({ where: { id }, data: { authorNote: note } })
}

export async function toggleVisibility(id: string) {
  const article = await prisma.article.findUnique({ where: { id }, select: { visibility: true } })
  if (!article) throw new Error('Article not found')
  const next = article.visibility === 'manager' ? 'public' : 'manager'
  return prisma.article.update({ where: { id }, data: { visibility: next } })
}

export function getReadingTime(content: string): number {
  const words = content.trim().split(/\s+/).length
  return Math.max(1, Math.ceil(words / 200))
}

export function parseTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
