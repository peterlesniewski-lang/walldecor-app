import { describe, expect, it } from 'vitest'
import {
  getInstallationGuideForViewer,
  listInstallationGuidesForViewer,
} from '@/lib/installations/guide-service'
import { INSTALLATION_GUIDES } from '@/lib/installations/guide-catalog'

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

  it('describes only the installer capabilities that are implemented in this release', () => {
    const allGuideText = INSTALLATION_GUIDES.flatMap((guide) => guide.sections.flatMap((section) => [
      section.title,
      section.introduction ?? '',
      ...section.steps,
      section.attention ?? '',
    ])).join(' ')
    const installer = INSTALLATION_GUIDES.find((guide) => guide.slug === 'instalator')
    const installerText = installer?.sections.flatMap((section) => [
      section.title,
      section.introduction ?? '',
      ...section.steps,
      section.attention ?? '',
    ]).join(' ') ?? ''

    expect(installerText).toMatch(/tylko do odczytu/i)
    expect(installerText).toMatch(/poza aplikacją/i)
    expect(installerText).toMatch(/link.*Google Calendar/i)
    expect(allGuideText).not.toMatch(/odnotuj na karcie przekazanie towaru/i)
    expect(allGuideText).not.toMatch(/instalator sporządza raport/i)
    expect(allGuideText).not.toMatch(/uzupełnij raport wizyty/i)
    expect(allGuideText).not.toMatch(/przygotuj protokół odbioru/i)
    expect(allGuideText).not.toMatch(/dodaj wyłącznie potrzebne zdjęcia/i)
    expect(allGuideText).not.toMatch(/protokół jest gotowy/i)
  })
})
