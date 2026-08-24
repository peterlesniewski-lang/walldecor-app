import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'employee-installer' } },
  getArticles: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/wikipedia/actions', () => ({ getArticles: mocks.getArticles }))
vi.mock('@/components/wikipedia/ArticleList', () => ({ ArticleList: () => null }))

import KnowledgePage from '@/app/(dashboard)/knowledge/page'

describe('Business Wiki page installer boundary', () => {
  it('does not render the general Wiki shell for an installer', async () => {
    mocks.notFound.mockImplementation(() => { throw new Error('not-found') })

    await expect(KnowledgePage()).rejects.toThrow('not-found')
    expect(mocks.getArticles).not.toHaveBeenCalled()
  })
})
