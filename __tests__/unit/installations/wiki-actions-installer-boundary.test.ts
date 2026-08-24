import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  articleFindMany: vi.fn(),
  articleFindUnique: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    article: {
      findMany: mocks.articleFindMany,
      findUnique: mocks.articleFindUnique,
    },
    $queryRaw: mocks.queryRaw,
  },
}))

import { getArticle, getArticles } from '@/lib/wikipedia/actions'
import { searchArticles } from '@/lib/wikipedia/search'

describe('Business Wiki installer boundary', () => {
  it('returns no Wiki articles to an installer without querying the database', async () => {
    await expect(getArticles({}, 'INSTALLER')).resolves.toEqual([])
    await expect(getArticle('procedura-wycieku', 'INSTALLER')).resolves.toBeNull()

    expect(mocks.articleFindMany).not.toHaveBeenCalled()
    expect(mocks.articleFindUnique).not.toHaveBeenCalled()
  })

  it('does not execute raw Wiki search for an installer', async () => {
    await expect(searchArticles('sekret', 'INSTALLER')).resolves.toEqual([])

    expect(mocks.queryRaw).not.toHaveBeenCalled()
  })
})
