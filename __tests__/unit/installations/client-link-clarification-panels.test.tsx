import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientLinkPanel } from '@/components/installations/client-link-panel'
import { InstallationClarificationPanel } from '@/components/installations/installation-clarification-panel'

afterEach(() => vi.unstubAllGlobals())

describe('installation detail client-link and clarification panels', () => {
  it('shows a one-time URL only after the editor really generates it', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      link: { id: 'link-2', expiresAt: '2027-01-01T00:00:00.000Z', revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: null },
      url: 'https://app.example.test/m/secret-once',
    }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientLinkPanel orderId="order-1" canEdit initialLinks={[{ id: 'link-1', expiresAt: '2026-12-01T00:00:00.000Z', revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: null }]} />)

    expect(screen.queryByText('https://app.example.test/m/secret-once')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Wygeneruj/ }))
    expect(fetchMock).toHaveBeenCalledWith('/api/installations/order-1/client-link', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByText('https://app.example.test/m/secret-once')).not.toBeNull()
  })

  it('extends an active link by fourteen days without rendering its token again', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      link: { id: 'link-1', expiresAt: '2027-01-15T00:00:00.000Z', revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: null },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientLinkPanel orderId="order-1" canEdit initialLinks={[{ id: 'link-1', expiresAt: '2027-01-01T00:00:00.000Z', revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: null }]} />)

    await user.click(screen.getByRole('button', { name: 'Przedłuż o 14 dni' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/installations/order-1/client-link', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ action: 'EXTEND', linkId: 'link-1' })
    expect(screen.queryByText(/\/m\//)).toBeNull()
  })

  it('requires an actual resolution/note form instead of prompt before closing an open clarification', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ clarification: { id: 'clarification-1', status: 'RESOLVED' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<InstallationClarificationPanel orderId="order-1" canEdit readiness={{ isReady: false, openBlockingCount: 1, submittedCount: 1 }} clarifications={[{
      id: 'clarification-1', status: 'OPEN', isBlocking: true, questionKey: 'glify', reason: 'Klient wskazał odpowiedź „Nie wiem”.',
      revisionNumber: 1, answer: 'UNKNOWN', createdAt: '2026-08-22T00:00:00.000Z', resolution: null, resolutionNote: null, evidenceReference: null,
    }]} />)

    expect(screen.getByText('Wymaga ustalenia przed terminem montażu')).not.toBeNull()
    await user.type(screen.getByLabelText('Ustalenie dla glify'), 'Glif ma 12 cm')
    await user.type(screen.getByLabelText('Notatka dla glify'), 'Potwierdzone telefonicznie')
    await user.click(screen.getByRole('button', { name: 'Oznacz jako ustalone' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/installations/order-1/clarifications/clarification-1', expect.objectContaining({ method: 'PATCH' }))
  })
})
