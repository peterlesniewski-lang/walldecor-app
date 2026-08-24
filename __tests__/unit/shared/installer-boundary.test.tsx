import { NextRequest } from 'next/server'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-auth/middleware', () => ({ withAuth: (handler: unknown) => handler }))
vi.mock('next/navigation', () => ({ usePathname: () => '/installations' }))
vi.mock('@/components/shared/notification-bell', () => ({ NotificationBell: () => <span>Powiadomienia</span> }))
vi.mock('@/components/shared/global-mobile-navigation', () => ({ GlobalMobileNavigation: () => <span>Menu mobilne</span> }))
vi.mock('@/components/shared/sign-out-button', () => ({ SignOutButton: () => <button>Wyloguj</button> }))

import proxy from '@/proxy'
import { Header } from '@/components/shared/header'
import { Sidebar } from '@/components/shared/sidebar'

function installerRequest(pathname: string) {
  const request = new NextRequest(`http://test${pathname}`) as NextRequest & { nextauth: { token: Record<string, unknown> } }
  request.nextauth = { token: { id: 'installer-user', role: 'INSTALLER', employeeId: 'employee-1', mustChangePassword: false } }
  return request
}

describe('global INSTALLER boundary', () => {
  it('allows only installations pages and API, and redirects or forbids every other protected route', async () => {
    expect((await proxy(installerRequest('/installations/order-1'))).status).toBe(200)
    expect((await proxy(installerRequest('/api/installations/order-1/visits'))).status).toBe(200)

    const page = await proxy(installerRequest('/finance'))
    expect(page.status).toBe(307)
    expect(page.headers.get('location')).toBe('http://test/installations')

    const api = await proxy(installerRequest('/api/notifications'))
    expect(api.status).toBe(403)
    await expect(api.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('renders only Montaże navigation, labels the account as Instalator, and omits notifications', () => {
    render(<Sidebar userRole="INSTALLER" />)
    expect(screen.getByText('Montaże')).toBeTruthy()
    expect(screen.queryByText('Wynik teraz')).toBeNull()
    expect(screen.queryByText('Pracownicy')).toBeNull()
    expect(screen.queryByText('Centrum')).toBeNull()
    expect(screen.queryByText('Ustawienia')).toBeNull()

    render(<Header user={{ name: 'Jan Instalator', email: 'jan@example.com', role: 'INSTALLER' }} />)
    expect(screen.getByText('Instalator')).toBeTruthy()
    expect(screen.queryByText('Powiadomienia')).toBeNull()
  })
})
