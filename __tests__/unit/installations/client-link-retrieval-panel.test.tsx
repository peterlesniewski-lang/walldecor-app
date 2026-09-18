import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientLinkPanel } from '@/components/installations/client-link-panel'

const link = { id: 'link-1', expiresAt: '2035-01-01', revokedAt: null, createdAt: '2026-01-01', lastOpenedAt: null, sentAt: null, sentById: null }
const url = 'https://example.test/m/saved-secret'
const result = () => new Response(JSON.stringify({ link, url, reason: null }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('recoverable client URL panel', () => {
  it('loads an existing URL on revisit with uncached fetch and copy/open actions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(result())
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    expect(await screen.findByText(url)).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/installations/order-1/client-link', expect.objectContaining({ method: 'GET', cache: 'no-store' }))
    expect(screen.getByRole('button', { name: 'Kopiuj link' })).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Otwórz formularz' }).getAttribute('href')).toBe(url)
  })
  it.each(['permission', 'order', 'revoked'] as const)('discards late retrieval after %s changes', async (change) => {
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done })))
    const view = render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    const finishOld = resolve
    view.rerender(<ClientLinkPanel orderId={change === 'order' ? 'order-2' : 'order-1'} initialLinks={change === 'revoked' ? [{ ...link, revokedAt: '2026-09-18' }] : [link]} canEdit={change !== 'permission'} />)
    await act(async () => finishOld(result()))
    expect(screen.queryByText(url)).toBeNull()
  })
  it('does not let an older GET resurrect a revoked URL', async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => options.method === 'GET'
      ? new Promise<Response>((done) => { resolve = done })
      : Promise.resolve(new Response(JSON.stringify({ link: { ...link, revokedAt: '2026-09-18' } })))))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    const user = userEvent.setup()
    await user.click(screen.getByText('Zarządzaj linkiem'))
    await user.click(screen.getByRole('button', { name: 'Cofnij link' }))
    await act(async () => resolve(result()))
    expect(screen.queryByText(url)).toBeNull()
    expect(screen.getByText('Brak aktywnego linku klienta.')).not.toBeNull()
  })
  it('keeps the newly rotated URL when an older GET finishes last', async () => {
    let resolve!: (value: Response) => void
    const newUrl = 'https://example.test/m/new-secret'
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => options.method === 'GET'
      ? new Promise<Response>((done) => { resolve = done })
      : Promise.resolve(new Response(JSON.stringify({ link: { ...link, id: 'link-2', createdAt: '2026-09-18' }, url: newUrl })))))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    const user = userEvent.setup()
    await user.click(screen.getByText('Zarządzaj linkiem'))
    await user.click(screen.getByRole('button', { name: 'Wygeneruj nowy link' }))
    await act(async () => resolve(result()))
    expect(screen.queryByText(url)).toBeNull()
    expect(screen.getByText(newUrl)).not.toBeNull()
  })
  it('explains old hash-only links without automatic regeneration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ link, url: null, reason: 'LEGACY_HASH_ONLY' })))
    vi.stubGlobal('fetch', fetchMock)
    render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    expect(await screen.findByText(/starszego linku nie można ponownie odczytać/i)).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('clears an already loaded secret if a later mutation reports lost permissions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => Promise.resolve(options.method === 'GET' ? result() : new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }))))
    render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    expect(await screen.findByText(url)).not.toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Oznacz jako wysłany' }))
    expect(screen.queryByText(url)).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Forbidden')
  })
  it('settles a mutation even when an RSC refresh changes initialLinks while it is pending', async () => {
    let finishMutation!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => options.method === 'GET' ? Promise.resolve(result()) : new Promise<Response>((done) => { finishMutation = done })))
    const view = render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    await screen.findByText(url)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Oznacz jako wysłany' }))
    view.rerender(<ClientLinkPanel orderId="order-1" initialLinks={[{ ...link }]} canEdit />)
    await act(async () => finishMutation(new Response(JSON.stringify({ link: { ...link, sentAt: '2026-09-18' } }))))
    expect(screen.queryByRole('button', { name: 'Oznacz jako wysłany' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cofnij link', hidden: true }).hasAttribute('disabled')).toBe(false)
  })
  it('reconciles a newer current link from GET when initial status props are stale', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(result())
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    await screen.findByText(url)
    const newerUrl = 'https://example.test/m/rotated-elsewhere'
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ link: { ...link, id: 'newer', createdAt: '2026-09-18' }, url: newerUrl })))
    view.rerender(<ClientLinkPanel orderId="order-1" initialLinks={[{ ...link }]} canEdit />)
    await screen.findByText(newerUrl)
    expect(screen.queryByText(url)).toBeNull()
  })
  it('accepts authoritative rotation after a completed local mutation even when creation times tie', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, options) => Promise.resolve(options.method === 'GET' ? result() : new Response(JSON.stringify({ link: { ...link, sentAt: '2026-09-18' } }))))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<ClientLinkPanel orderId="order-1" initialLinks={[link]} canEdit />)
    await screen.findByText(url)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Oznacz jako wysłany' }))
    const newerUrl = 'https://example.test/m/authoritative-secret'
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ link: { ...link, id: 'newer' }, url: newerUrl })))
    view.rerender(<ClientLinkPanel orderId="order-1" initialLinks={[{ ...link }]} canEdit />)
    await screen.findByText(newerUrl)
    expect(screen.queryByText(url)).toBeNull()
  })
})
