import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InstallationGuideList } from '@/components/installations/installation-guide-list'
import { InstallationGuideArticle } from '@/components/installations/installation-guide-article'
import type { InstallationGuide } from '@/lib/installations/guide-catalog'

const guide: InstallationGuide = {
  slug: 'instalator', title: 'Instalator', summary: 'Zakres', audience: 'INSTALLER', audienceLabel: 'Instalator', updatedAt: '2026-08-24', sections: [],
}

describe('installation guide back navigation', () => {
  it('should link the guide list back to installations', () => {
    render(<InstallationGuideList guides={[guide]} />)

    expect(screen.getByRole('link', { name: /Wróć do montaży/ }).getAttribute('href')).toBe('/installations')
  })

  it('should link the guide article to the guide list', () => {
    render(<InstallationGuideArticle guide={guide} />)

    expect(screen.getByRole('link', { name: /Wszystkie instrukcje montaży/ }).getAttribute('href')).toBe('/installations/instrukcje')
  })

  it('should link the guide article to installations', () => {
    render(<InstallationGuideArticle guide={guide} />)

    expect(screen.getByRole('link', { name: 'Montaże' }).getAttribute('href')).toBe('/installations')
  })
})
