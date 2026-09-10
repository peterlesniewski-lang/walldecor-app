import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RootPage from '@/app/(dashboard)/page'
import DashboardPage from '@/app/(dashboard)/dashboard/page'

const state = vi.hoisted(() => ({ role: 'ADMIN', authenticated: true, load: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: async () => state.authenticated ? { user: { id: 'admin', role: state.role, name: 'Piotr' } } : null }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/finance/actual-dashboard-data', () => ({ loadActualDashboardData: state.load }))
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))
beforeEach(() => { state.role = 'ADMIN'; state.authenticated = true; state.load.mockReset() })

describe('dashboard routes', () => {
  it('uses exactly one page implementation for both public route names', () => {
    expect(DashboardPage).toBe(RootPage)
  })
  it('rejects an invalid period before querying any finance data', async () => {
    render(await RootPage({ searchParams: Promise.resolve({ year: '2026junk', month: '13' }) }))
    expect(screen.getByRole('alert').textContent).toContain('Wybierz rok')
    expect(state.load).not.toHaveBeenCalled()
  })
  it('passes the validated selected period to the common actuals loader', async () => {
    state.load.mockResolvedValue({ model: { period: { year: 2025, month: 2 } } })
    await RootPage({ searchParams: Promise.resolve({ year: '2025', month: '02' }) })
    expect(state.load).toHaveBeenCalledWith({ year: 2025, month: 2 }, 'admin')
  })
  it('preserves the employee finance redirect', async () => {
    state.role = 'EMPLOYEE'
    await expect(RootPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/finance')
    expect(state.load).not.toHaveBeenCalled()
  })
  it('redirects unauthenticated visitors to login', async () => {
    state.authenticated = false
    await expect(RootPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('redirect:/login')
  })
})
