import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClientAcceptancePage } from '@/components/installations/client-acceptance-page'
import type { publicAcceptanceProjection } from '@/lib/installations/acceptance-client'

type Projection = Awaited<ReturnType<typeof publicAcceptanceProjection>>

function projection(overrides: Partial<Projection>): Projection {
  return {
    protocolId: 'protocol-1',
    orderId: 'order-42',
    channel: 'ONSITE',
    revision: 1,
    isLatest: true,
    status: 'ACCEPTED',
    snapshot: {
      orderNumber: 'MON-1', clientName: 'Klient', address: 'Warszawa', visitId: 'visit-1', visitStartsAt: null, visitEndsAt: null,
      workType: 'Tapetowanie', installerName: 'Instalator', items: [],
    },
    results: [],
    contentHash: 'hash',
    clientDecision: 'ACCEPTED',
    clientFirstName: 'Jan',
    clientLastName: 'Kowalski',
    clientRelationship: 'klient',
    clientNote: '',
    clientRespondedAt: '2026-10-26T16:18:00.000Z',
    unilateral: null,
    photos: [],
    ...overrides,
  }
}

describe('client acceptance page return path', () => {
  it('should link the installer back to the installation card after an on-site response', () => {
    render(<ClientAcceptancePage token="token" protocol={projection({ channel: 'ONSITE' })} />)

    expect(screen.getByRole('link', { name: 'Wróć do karty montażu' }).getAttribute('href')).toBe('/installations/order-42#acceptance')
  })

  it('should not show a back link to the app for an e-mailed client link', () => {
    render(<ClientAcceptancePage token="token" protocol={projection({ channel: 'EMAIL' })} />)

    expect(screen.queryByRole('link', { name: 'Wróć do karty montażu' })).toBeNull()
  })

  it('should tell the e-mail client they can close the page', () => {
    render(<ClientAcceptancePage token="token" protocol={projection({ channel: 'EMAIL' })} />)

    expect(screen.getByText('Możesz zamknąć tę stronę.')).toBeTruthy()
  })
})
