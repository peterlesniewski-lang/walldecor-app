import { describe, expect, it } from 'vitest'
import {
  getInstallationGuideForViewer,
  listInstallationGuidesForViewer,
} from '@/lib/installations/guide-service'

describe('installation guide access', () => {
  it('shows an active linked installer only the installer guide', () => {
    const guides = listInstallationGuidesForViewer({
      role: 'INSTALLER',
      employeeId: 'employee-installer',
      employeeActive: true,
    })

    expect(guides.map((guide) => guide.slug)).toEqual(['instalator'])
    expect(getInstallationGuideForViewer('admin', {
      role: 'INSTALLER',
      employeeId: 'employee-installer',
      employeeActive: true,
    })).toBeNull()
  })

  it('fails closed for an installer without an active linked employee', () => {
    const viewer = { role: 'INSTALLER' as const, employeeId: 'employee-installer', employeeActive: false }

    expect(listInstallationGuidesForViewer(viewer)).toEqual([])
    expect(getInstallationGuideForViewer('instalator', viewer)).toBeNull()
  })

  it('shows coordinators three role-relevant guides and admin all four', () => {
    expect(listInstallationGuidesForViewer({ role: 'EMPLOYEE', employeeId: 'employee-1', employeeActive: true })
      .map((guide) => guide.slug))
      .toEqual(['opiekun-karty', 'zastepca-przejecie-karty', 'instalator'])

    expect(listInstallationGuidesForViewer({ role: 'MANAGER', employeeId: null })
      .map((guide) => guide.slug))
      .toEqual(['opiekun-karty', 'zastepca-przejecie-karty', 'instalator'])

    expect(listInstallationGuidesForViewer({ role: 'ADMIN', employeeId: null })
      .map((guide) => guide.slug))
      .toEqual(['opiekun-karty', 'zastepca-przejecie-karty', 'instalator', 'admin'])
  })
})
