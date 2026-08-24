import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InstallationOrderList } from '@/components/installations/order-list'
import { InstallationOrderDetail } from '@/components/installations/order-detail'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const order = {
  id: 'order-1', number: 'MON-20260824-0001', status: 'SCHEDULED', archivedAt: null,
  client: { name: 'Jan Kowalski', email: 'jan@example.test', phone: '+48 500 000 000' },
  addressStreet: 'Sienna', addressBuildingNumber: '10', addressApartmentNumber: null, addressPostalCode: '00-001', addressCity: 'Warszawa',
  primaryEmployee: { firstName: 'Anna', lastName: 'Opiekun' }, backupEmployee: { firstName: 'Bartek', lastName: 'Zastępca' },
}

describe('installation guide contextual links', () => {
  it('offers the real guide index both from the order list and an open card', () => {
    const { unmount } = render(createElement(InstallationOrderList, {
      orders: [{
        ...order,
        clientFormStatus: { code: 'WAITING', label: 'Czeka na klienta', requiresClarification: false },
        calendarSummary: { nextVisitAt: null, visitStatus: 'NONE', syncStatus: 'NOT_REQUESTED' },
      }],
    } as never))

    expect(screen.getByRole('link', { name: 'Instrukcje montaży' }).getAttribute('href')).toBe('/installations/instrukcje')
    unmount()

    render(createElement(InstallationOrderDetail, {
      order, employees: [], rooms: [], catalog: [], visits: [], scopeAssignments: [],
    } as never))

    expect(screen.getByRole('link', { name: 'Instrukcje montaży' }).getAttribute('href')).toBe('/installations/instrukcje')
  })

  it('offers the catalog shortcut on the list only to catalog managers without nesting links', () => {
    const { container, rerender } = render(createElement(InstallationOrderList, {
      orders: [{
        ...order,
        clientFormStatus: { code: 'WAITING', label: 'Czeka na klienta', requiresClarification: false },
        calendarSummary: { nextVisitAt: null, visitStatus: 'NONE', syncStatus: 'NOT_REQUESTED' },
      }],
      canManageCatalog: true,
    } as never))

    expect(screen.getByRole('link', { name: 'Katalog i formularze' }).getAttribute('href')).toBe('/installations/catalog')
    expect(container.querySelector('a a')).toBeNull()

    rerender(createElement(InstallationOrderList, {
      orders: [{
        ...order,
        clientFormStatus: { code: 'WAITING', label: 'Czeka na klienta', requiresClarification: false },
        calendarSummary: { nextVisitAt: null, visitStatus: 'NONE', syncStatus: 'NOT_REQUESTED' },
      }],
      canManageCatalog: false,
    } as never))

    expect(screen.queryByRole('link', { name: 'Katalog i formularze' })).toBeNull()
  })
})
