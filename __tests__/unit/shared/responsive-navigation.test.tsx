import type { AnchorHTMLAttributes } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HrMobileNavigation, HrSidebar } from '@/components/hr/hr-sidebar'
import { GlobalMobileNavigation } from '@/components/shared/global-mobile-navigation'
import { Header } from '@/components/shared/header'
import { Sidebar } from '@/components/shared/sidebar'

vi.mock('next/navigation', () => ({
  usePathname: () => '/hr/time-tracking',
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
    >
      {children}
    </a>
  ),
}))

vi.mock('@/components/shared/notification-bell', () => ({
  NotificationBell: () => null,
}))

vi.mock('@/components/shared/sign-out-button', () => ({
  SignOutButton: () => <button type="button">Wyloguj</button>,
}))

const adminUser = {
  name: 'Anna Admin',
  email: 'anna@example.com',
  role: 'ADMIN' as const,
}

describe('responsive dashboard navigation', () => {
  it('keeps desktop sidebars at their existing widths and hides them below their breakpoints', () => {
    render(
      <>
        <Sidebar userRole="ADMIN" />
        <HrSidebar userRole="ADMIN" />
      </>
    )

    const globalSidebar = screen.getByRole('complementary', {
      name: 'Nawigacja główna',
    })
    const hrSidebar = screen.getByRole('complementary', {
      name: 'Nawigacja HR',
    })

    expect(globalSidebar.className).toContain('hidden')
    expect(globalSidebar.className).toContain('lg:flex')
    expect(globalSidebar.className).toContain('w-64')
    expect(hrSidebar.className).toContain('hidden')
    expect(hrSidebar.className).toContain('xl:flex')
    expect(hrSidebar.className).toContain('w-52')
  })

  it('renders the global mobile menu in Header and preserves admin destinations', async () => {
    const user = userEvent.setup()
    render(<Header user={adminUser} />)

    const trigger = screen.getByRole('button', { name: 'Otwórz menu główne' })
    expect(trigger.className).toContain('lg:hidden')
    expect(trigger.className).toContain('h-11')
    expect(trigger.className).toContain('w-11')

    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'WallDecor' })
    expect(within(dialog).getAllByRole('link')).toHaveLength(17)
    expect(within(dialog).getByRole('link', { name: 'KSeF Inbox' })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Czas pracy' })).toBeTruthy()

    await user.click(within(dialog).getByRole('link', { name: 'Pracownicy' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'WallDecor' })).toBeNull())
  })

  it('applies the same global role visibility in the employee mobile menu', async () => {
    const user = userEvent.setup()
    render(<GlobalMobileNavigation userRole="EMPLOYEE" />)

    await user.click(screen.getByRole('button', { name: 'Otwórz menu główne' }))
    const dialog = screen.getByRole('dialog', { name: 'WallDecor' })

    expect(within(dialog).getAllByRole('link')).toHaveLength(9)
    expect(within(dialog).getByRole('link', { name: 'Wynik teraz' })).toBeTruthy()
    expect(within(dialog).queryByRole('link', { name: 'KSeF Inbox' })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: 'Dashboard' })).toBeNull()
  })

  it('provides every allowed HR destination without exposing restricted links', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<HrMobileNavigation userRole="EMPLOYEE" />)

    const trigger = screen.getByRole('button', { name: 'Otwórz menu HR' })
    expect(trigger.className).toContain('xl:hidden')
    expect(trigger.className).toContain('h-11')
    expect(trigger.className).toContain('w-11')

    await user.click(trigger)
    let dialog = screen.getByRole('dialog', { name: 'Menu HR' })
    await user.click(within(dialog).getByRole('button', { name: 'Urlopy' }))

    expect(within(dialog).getAllByRole('link')).toHaveLength(9)
    expect(within(dialog).getByRole('link', { name: 'Rejestracja' })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Wnioski' })).toBeTruthy()
    expect(within(dialog).queryByRole('link', { name: 'Okresy' })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: 'Typy' })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: 'Salda' })).toBeNull()
    expect(within(dialog).queryByRole('link', { name: 'Akceptacja' })).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu HR' })).toBeNull())

    rerender(<HrMobileNavigation userRole="ADMIN" />)
    await user.click(screen.getByRole('button', { name: 'Otwórz menu HR' }))
    dialog = screen.getByRole('dialog', { name: 'Menu HR' })
    await user.click(within(dialog).getByRole('button', { name: 'Urlopy' }))

    expect(within(dialog).getAllByRole('link')).toHaveLength(13)
    expect(within(dialog).getByRole('link', { name: 'Okresy' })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Typy' })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Salda' })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Akceptacja' })).toBeTruthy()
  })
})
