import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/shared/sidebar'

vi.mock('next/navigation', () => ({
  usePathname: () => '/finance',
}))

describe('Sidebar finance navigation', () => {
  it('shows KSeF and cost-control links to admins', () => {
    render(<Sidebar userRole="ADMIN" />)

    expect(screen.getByText('KSeF Inbox')).toBeTruthy()
    expect(screen.getByText('Zdarzenia kosztowe')).toBeTruthy()
    expect(screen.getByText('Break-even')).toBeTruthy()
  })

  it('hides KSeF but keeps reporting links for managers', () => {
    render(<Sidebar userRole="MANAGER" />)

    expect(screen.queryByText('KSeF Inbox')).toBeNull()
    expect(screen.getByText('Zdarzenia kosztowe')).toBeTruthy()
    expect(screen.getByText('Break-even')).toBeTruthy()
  })

  it('hides cost-control links from employees', () => {
    render(<Sidebar userRole="EMPLOYEE" />)

    expect(screen.queryByText('KSeF Inbox')).toBeNull()
    expect(screen.queryByText('Zdarzenia kosztowe')).toBeNull()
    expect(screen.queryByText('Break-even')).toBeNull()
  })
})
