import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InstallationOrderList } from '@/components/installations/order-list'
import { listInstallationOrders } from '@/lib/installations/order-service'

const baseOrder = {
  id: 'order-1',
  number: 'MON-20260914-0001',
  status: 'SCHEDULED',
  addressStreet: 'Puławska 17',
  addressCity: 'Warszawa',
  client: { name: 'Jan Kowalski' },
  primaryEmployee: { firstName: 'Anna', lastName: 'Opiekun' },
  backupEmployee: { firstName: 'Marek', lastName: 'Zastępca' },
  clientFormStatus: { code: 'WAITING' as const, label: 'Wysłany · czeka na klienta', requiresClarification: false },
}

describe('installation order list calendar summary', () => {
  it('projects the nearest non-cancelled visit and its calendar synchronization state without exposing visit details', async () => {
    const findMany = vi.fn().mockResolvedValue([{
      ...baseOrder,
      delegations: [],
      installerAssignments: [],
      scopeAssignments: [],
      formSnapshots: [],
      clientLinks: [],
      formSubmissions: [],
      clarifications: [],
      visits: [{
        startsAt: new Date('2026-09-14T06:00:00.000Z'),
        status: 'CONFIRMED',
        syncStates: [{ status: 'SYNCED' }],
      }],
    }])

    const [order] = await listInstallationOrders({ installationOrder: { findMany } } as never)

    expect(order).toMatchObject({
      id: 'order-1',
      calendarSummary: {
        nextVisitAt: '2026-09-14T06:00:00.000Z',
        visitStatus: 'CONFIRMED',
        syncStatus: 'SYNCED',
      },
    })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        visits: expect.objectContaining({
          where: { status: { in: ['DRAFT', 'CONFIRMED'] } },
          orderBy: [
            { startsAt: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
            { id: 'asc' },
          ],
          take: 1,
        }),
      }),
    }))
    expect(order).not.toHaveProperty('visits')
  })

  it('does not surface a completed visit or its historic synchronized state on the card', async () => {
    const findMany = vi.fn().mockResolvedValue([{
      ...baseOrder,
      delegations: [],
      installerAssignments: [],
      scopeAssignments: [],
      formSnapshots: [],
      clientLinks: [],
      formSubmissions: [],
      clarifications: [],
      visits: [{
        startsAt: new Date('2026-09-13T06:00:00.000Z'),
        status: 'COMPLETED',
        syncStates: [{ status: 'SYNCED' }],
      }],
    }])

    const [order] = await listInstallationOrders({ installationOrder: { findMany } } as never)
    render(createElement(InstallationOrderList, { orders: [order] }))

    expect(order.calendarSummary).toEqual({
      nextVisitAt: null,
      visitStatus: 'NONE',
      syncStatus: 'NOT_REQUESTED',
    })
    expect(screen.getByText('Termin nieustalony')).not.toBeNull()
    expect(screen.getByText('Nie wysłano')).not.toBeNull()
  })

  it('renders separately accessible detail and visit links with the next visit calendar state', () => {
    const { container } = render(createElement(InstallationOrderList, {
      orders: [{
        ...baseOrder,
        calendarSummary: {
          nextVisitAt: '2026-09-14T06:00:00.000Z',
          visitStatus: 'CONFIRMED' as const,
          syncStatus: 'SYNCED' as const,
        },
      }],
    }))

    expect(screen.getByRole('link', { name: 'Otwórz kartę Jan Kowalski' }).getAttribute('href')).toBe('/installations/order-1')
    expect(screen.getByRole('link', { name: 'Wizyty i terminy' }).getAttribute('href')).toBe('/installations/order-1#visits')
    expect(screen.getByText('14.09.2026, 08:00')).not.toBeNull()
    expect(screen.getByText('Zsynchronizowano')).not.toBeNull()
    expect(container.querySelector('a a')).toBeNull()
  })

  it('shows the clear fallback state when no visit has been created', () => {
    render(createElement(InstallationOrderList, {
      orders: [{
        ...baseOrder,
        calendarSummary: {
          nextVisitAt: null,
          visitStatus: 'NONE' as const,
          syncStatus: 'NOT_REQUESTED' as const,
        },
      }],
    }))

    expect(screen.getByText('Termin nieustalony')).not.toBeNull()
    expect(screen.getByText('Nie wysłano')).not.toBeNull()
  })
})
