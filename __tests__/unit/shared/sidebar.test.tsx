import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/shared/sidebar'

vi.mock('next/navigation', () => ({
  usePathname: () => '/finance',
}))

describe('Sidebar finance navigation', () => {
  it('shows KSeF and cost-control links to admins', () => {
    render(<Sidebar userRole="ADMIN" />)

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
    expect(screen.queryByText('Koszty')).toBeNull()
    expect(screen.queryByText('Przychody')).toBeNull()
    expect(screen.queryByText('KSeF Inbox')).toBeNull()
    expect(screen.queryByText('Zdarzenia kosztowe')).toBeNull()
    expect(screen.queryByText('Break-even')).toBeNull()
    expect(screen.queryByText('Marża obszarów')).toBeNull()
    expect(screen.queryByText('Alerty')).toBeNull()
  })
})
