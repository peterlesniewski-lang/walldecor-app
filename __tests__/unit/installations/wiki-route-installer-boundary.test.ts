import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string } },
  getArticles: vi.fn(),
  searchArticles: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/wikipedia/actions', () => ({
  getArticles: mocks.getArticles,
  createArticle: vi.fn(),
}))
vi.mock('@/lib/wikipedia/search', () => ({ searchArticles: mocks.searchArticles }))

import { GET } from '@/app/api/knowledge/route'

describe('Business Wiki API installer boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = { user: { id: 'installer-user', role: 'INSTALLER' } }
  })

  it('returns 403 before searching or listing articles for an installer', async () => {
    const response = await GET(new NextRequest('http://test/api/knowledge?q=haslo'))

    expect(response.status).toBe(403)
    expect(mocks.getArticles).not.toHaveBeenCalled()
    expect(mocks.searchArticles).not.toHaveBeenCalled()
  })
})
