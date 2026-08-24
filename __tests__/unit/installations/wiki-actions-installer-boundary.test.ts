import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  articleFindMany: vi.fn(),
  articleFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    article: {
      findMany: mocks.articleFindMany,
      findUnique: mocks.articleFindUnique,
    },
  },
}))

import { getArticle, getArticles } from '@/lib/wikipedia/actions'

describe('Business Wiki installer boundary', () => {
  it('returns no Wiki articles to an installer without querying the database', async () => {
    await expect(getArticles({}, 'INSTALLER')).resolves.toEqual([])
    await expect(getArticle('procedura-wycieku', 'INSTALLER')).resolves.toBeNull()

    expect(mocks.articleFindMany).not.toHaveBeenCalled()
    expect(mocks.articleFindUnique).not.toHaveBeenCalled()
  })
})
