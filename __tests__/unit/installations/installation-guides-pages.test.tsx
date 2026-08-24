import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: { user: { id: 'installer-user', role: 'INSTALLER', employeeId: 'employee-installer' } },
  viewerFromSession: vi.fn(),
  listGuides: vi.fn(),
  getGuide: vi.fn(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/installations/http-access', () => ({ installationViewerFromSession: mocks.viewerFromSession }))
vi.mock('@/lib/installations/guide-service', () => ({
  listInstallationGuidesForViewer: mocks.listGuides,
  getInstallationGuideForViewer: mocks.getGuide,
}))
vi.mock('@/components/installations/installation-guide-list', () => ({
  InstallationGuideList: () => null,
}))
vi.mock('@/components/installations/installation-guide-article', () => ({
  InstallationGuideArticle: () => null,
}))

import InstallationGuidesPage from '@/app/(dashboard)/installations/instrukcje/page'
import InstallationGuidePage from '@/app/(dashboard)/installations/instrukcje/[slug]/page'

const installerViewer = { role: 'INSTALLER' as const, employeeId: 'employee-installer', employeeActive: true }
const installerGuide = { slug: 'instalator', title: 'Instalator', summary: 'Zakres', audience: 'INSTALLER', audienceLabel: 'Instalator', updatedAt: '2026-08-24', sections: [] }

describe('installation guide pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.viewerFromSession.mockResolvedValue(installerViewer)
    mocks.listGuides.mockReturnValue([installerGuide])
    mocks.getGuide.mockReturnValue(installerGuide)
    mocks.notFound.mockImplementation(() => { throw new Error('not-found') })
  })

  it('lists only the installer guide through the verified installation viewer', async () => {
    const result = await InstallationGuidesPage()

    expect(mocks.viewerFromSession).toHaveBeenCalledWith(mocks.session)
    expect(mocks.listGuides).toHaveBeenCalledWith(installerViewer)
    expect(result.props.guides).toEqual([installerGuide])
  })

  it('returns 404 for an installer who types an administrator guide slug', async () => {
    mocks.getGuide.mockReturnValue(null)

    await expect(InstallationGuidePage({ params: Promise.resolve({ slug: 'admin' }) }))
      .rejects.toThrow('not-found')

    expect(mocks.getGuide).toHaveBeenCalledWith('admin', installerViewer)
  })
})
