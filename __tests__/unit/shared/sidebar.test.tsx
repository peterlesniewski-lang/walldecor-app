import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NAV_SECTIONS, Sidebar } from '@/components/shared/sidebar'

vi.mock('next/navigation', () => ({
  usePathname: () => '/finance',
}))

function operationsItems() {
  const section = NAV_SECTIONS.find((candidate) => candidate.label === 'Operacje')
  if (!section) throw new Error('Operacje section is missing')
  return section.items
}

describe('Sidebar operations navigation', () => {
  it('should link Zamknięcie miesiąca to the runs list', () => {
    const entry = operationsItems().find((item) => item.label === 'Zamknięcie miesiąca')

    expect(entry?.href).toBe('/operations/runs')
  })

  it('should link Procedury to the procedures list', () => {
    const entry = operationsItems().find((item) => item.label === 'Procedury')

    expect(entry?.href).toBe('/operations/procedures')
  })

  it('should list Zamknięcie miesiąca before Procedury', () => {
    const labels = operationsItems().map((item) => item.label)

    expect(labels.indexOf('Zamknięcie miesiąca')).toBeLessThan(labels.indexOf('Procedury'))
  })

  it('should not contain a Centrum entry', () => {
    expect(operationsItems().map((item) => item.label)).not.toContain('Centrum')
  })

  it('should not contain a Wykonania entry', () => {
    expect(operationsItems().map((item) => item.label)).not.toContain('Wykonania')
  })

  it('should not link to the old /operations hub', () => {
    expect(operationsItems().map((item) => item.href)).not.toContain('/operations')
  })

  it('should keep Kasa salonu and Montaże in the section', () => {
    const labels = operationsItems().map((item) => item.label)

    expect(labels).toEqual(expect.arrayContaining(['Kasa salonu', 'Montaże']))
  })

  it('should render Zamknięcie miesiąca as a link to the runs list for managers', () => {
    render(<Sidebar userRole="MANAGER" />)

    expect(screen.getByRole('link', { name: 'Zamknięcie miesiąca' }).getAttribute('href')).toBe('/operations/runs')
  })

  it('should not render a sidebar link named Centrum', () => {
    render(<Sidebar userRole="ADMIN" />)

    expect(screen.queryByRole('link', { name: 'Centrum' })).toBeNull()
  })
})

describe('Sidebar finance navigation', () => {
  it('shows KSeF and cost-control links to admins', () => {
    render(<Sidebar userRole="ADMIN" />)

    expect(screen.getByText('Dashboard')).toBeTruthy()
    expect(screen.getByText('Koszty')).toBeTruthy()
    expect(screen.getByText('Przychody')).toBeTruthy()
    expect(screen.getByText('KSeF Inbox')).toBeTruthy()
    expect(screen.getByText('Zdarzenia kosztowe')).toBeTruthy()
    expect(screen.getByText('Break-even')).toBeTruthy()
    expect(screen.getByText('Marża obszarów')).toBeTruthy()
  })

  it('shows only the aggregated finance view to managers', () => {
    render(<Sidebar userRole="MANAGER" />)

    expect(screen.getByText('Wynik teraz')).toBeTruthy()
    expect(screen.queryByText('Dashboard')).toBeNull()
    expect(screen.queryByText('Koszty')).toBeNull()
    expect(screen.queryByText('Przychody')).toBeNull()
    expect(screen.queryByText('KSeF Inbox')).toBeNull()
    expect(screen.queryByText('Zdarzenia kosztowe')).toBeNull()
    expect(screen.queryByText('Break-even')).toBeNull()
    expect(screen.queryByText('Marża obszarów')).toBeNull()
    expect(screen.queryByText('Alerty')).toBeNull()
  })

  it('shows only the aggregated finance view to employees', () => {
    render(<Sidebar userRole="EMPLOYEE" />)

    expect(screen.getByText('Wynik teraz')).toBeTruthy()
    expect(screen.queryByText('Dashboard')).toBeNull()
    expect(screen.queryByText('Koszty')).toBeNull()
    expect(screen.queryByText('Przychody')).toBeNull()
    expect(screen.queryByText('KSeF Inbox')).toBeNull()
    expect(screen.queryByText('Zdarzenia kosztowe')).toBeNull()
    expect(screen.queryByText('Break-even')).toBeNull()
    expect(screen.queryByText('Marża obszarów')).toBeNull()
    expect(screen.queryByText('Alerty')).toBeNull()
  })
})
