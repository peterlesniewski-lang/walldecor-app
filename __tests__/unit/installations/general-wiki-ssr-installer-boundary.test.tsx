import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'employee-installer' } },
  getArticles: vi.fn(),
  getArticle: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/wikipedia/actions', () => ({
  getArticles: mocks.getArticles,
  getArticle: mocks.getArticle,
  getReadingTime: vi.fn(() => 1),
  parseTags: vi.fn(() => []),
}))
vi.mock('@/components/wikipedia/ArticleList', () => ({ ArticleList: () => null }))
vi.mock('@/components/wikipedia/ArticleViewer', () => ({ ArticleViewer: () => null }))
vi.mock('@/components/wikipedia/VisibilityBadge', () => ({ VisibilityBadge: () => null }))

import OperationProceduresPage from '@/app/(dashboard)/operations/procedures/page'
import OperationProcedurePage from '@/app/(dashboard)/operations/procedures/[slug]/page'
import ArticlePage from '@/app/(dashboard)/knowledge/[slug]/page'

const sentinelArticle = {
  id: 'sentinel-article',
  slug: 'sentinel-procedure',
  title: 'SENTINEL SECRET TITLE',
  content: 'SENTINEL SECRET CONTENT',
  category: 'processes',
  visibility: 'public',
  type: 'procedure',
  tags: '[]',
  updatedAt: new Date('2026-08-24T00:00:00.000Z'),
  authorNote: null,
}

describe('general Wiki SSR installer boundary without proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.notFound.mockImplementation(() => { throw new Error('not-found') })
    mocks.getArticles.mockResolvedValue([sentinelArticle])
    mocks.getArticle.mockResolvedValue(sentinelArticle)
  })

  it('blocks the operational procedure index before any article payload is loaded', async () => {
    await expect(OperationProceduresPage()).rejects.toThrow('not-found')

    expect(mocks.getArticles).not.toHaveBeenCalled()
  })

  it('blocks both general Wiki detail routes before loading a sentinel article', async () => {
    await expect(OperationProcedurePage({ params: Promise.resolve({ slug: sentinelArticle.slug }) }))
      .rejects.toThrow('not-found')
    await expect(ArticlePage({ params: Promise.resolve({ slug: sentinelArticle.slug }) }))
      .rejects.toThrow('not-found')

    expect(mocks.getArticle).not.toHaveBeenCalled()
  })
})
