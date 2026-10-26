import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CoordinatorAcceptancePanel, type CoordinatorAcceptanceView } from '@/components/installations/coordinator-acceptance-panel'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

function protocol(overrides: Partial<CoordinatorAcceptanceView>): CoordinatorAcceptanceView {
  return {
    id: 'p', revision: 1, isLatest: true, resolvedByProtocolId: null, hasIncompleteWorks: false, invoiceTask: null,
    workType: 'Tapetowanie', visitStartsAt: '2026-09-16T11:45:00.000Z', visitId: 'visit-1', groupKey: 'category:a',
    createdAt: '2026-10-26T15:40:00.000Z', installerSignedAt: null, clientRespondedAt: null,
    status: 'DRAFT', unilateralStatus: null, failedAlerts: 0, clientNote: null, links: [],
    ...overrides,
  }
}

const protocols: CoordinatorAcceptanceView[] = [
  protocol({ id: 'draft-2', revision: 2, status: 'DRAFT' }),
  protocol({
    id: 'old-1', revision: 1, isLatest: false, status: 'ACCEPTED_WITH_REMARKS',
    installerSignedAt: '2026-10-26T16:02:00.000Z', clientRespondedAt: '2026-10-26T16:18:00.000Z',
  }),
  protocol({ id: 'other', workType: 'Sztukateria', groupKey: 'category:b', status: 'INSTALLER_SIGNED', installerSignedAt: '2026-10-26T16:02:00.000Z' }),
]

describe('CoordinatorAcceptancePanel versions', () => {
  it('should mark the latest revision as current', () => {
    render(<CoordinatorAcceptancePanel orderId="order-1" protocols={protocols} canManage />)

    expect(screen.getByText('Aktualna · wersja 2')).toBeTruthy()
  })

  it('should collect older revisions under a collapsed summary', () => {
    render(<CoordinatorAcceptancePanel orderId="order-1" protocols={protocols} canManage />)

    expect(screen.getByText('Poprzednie wersje (1)')).toBeTruthy()
  })

  it('should not offer a new revision button on an old version', () => {
    render(<CoordinatorAcceptancePanel orderId="order-1" protocols={protocols} canManage />)
    const details = screen.getByText('Poprzednie wersje (1)').closest('details')!

    expect(within(details).queryByRole('button', { name: 'Nowa wersja' })).toBeNull()
  })

  it('should show the client response moment on the old version', () => {
    render(<CoordinatorAcceptancePanel orderId="order-1" protocols={protocols} canManage />)
    const details = screen.getByText('Poprzednie wersje (1)').closest('details')!

    expect(within(details).getByText(/wersja 1 · Odebrano z uwagami · Odpowiedź klienta 26\.10\.2026, 17:18/)).toBeTruthy()
  })

  it('should render a separate article per work type group', () => {
    render(<CoordinatorAcceptancePanel orderId="order-1" protocols={protocols} canManage />)

    expect(screen.getAllByRole('article').map((article) => article.getAttribute('aria-label'))).toEqual(['Tapetowanie', 'Sztukateria'])
  })
})
