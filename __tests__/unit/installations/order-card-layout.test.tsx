import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstallationOrderDetail } from '@/components/installations/order-detail'
import { ClientLinkPanel } from '@/components/installations/client-link-panel'
import { InstallationFormRevisionPanel } from '@/components/installations/form-revision-panel'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const order = {
  id: 'order-1', number: 'MON-1', status: 'DRAFT', archivedAt: null,
  client: { name: 'Jan Kowalski', email: 'jan@example.test', phone: '+48500100200' },
  addressStreet: 'Sienna', addressBuildingNumber: '10', addressApartmentNumber: null, addressPostalCode: '00-001', addressCity: 'Warszawa',
  primaryEmployeeId: 'a', backupEmployeeId: 'b',
  primaryEmployee: { firstName: 'Anna', lastName: 'Opiekun' }, backupEmployee: { firstName: 'Bartek', lastName: 'Zastępca' },
}

describe('simplified installation card', () => {
  it.each(['revoked', 'replaced'])('removes a generated URL when refresh confirms it was %s elsewhere', async (change) => {
    const user = userEvent.setup()
    const link = { id: 'link-a', expiresAt: '2030-01-01', revokedAt: null, createdAt: '2026-01-01', lastOpenedAt: null, sentAt: null, sentById: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ link, url: 'https://example.test/m/local-link' }), { status: 201 })))
    const { rerender } = render(<ClientLinkPanel orderId="order-1" canEdit initialLinks={[]} />)
    await user.click(screen.getByRole('button', { name: 'Wygeneruj link', exact: true }))
    rerender(<ClientLinkPanel orderId="order-1" canEdit initialLinks={[{ ...link, sentAt: '2026-09-07' }]} />)
    expect(screen.getByText('https://example.test/m/local-link')).not.toBeNull()
    const revoked = { ...link, revokedAt: '2026-09-08' }
    rerender(<ClientLinkPanel orderId="order-1" canEdit initialLinks={change === 'revoked' ? [revoked] : [{ ...link, id: 'link-b', createdAt: '2026-09-08' }]} />)
    expect(screen.queryByText('https://example.test/m/local-link')).toBeNull()
  })
  it('reconciles externally saved rooms and template without losing an unrelated contact draft', async () => {
    const user = userEvent.setup()
    const props = { order, employees: [], canEdit: true }
    const { rerender } = render(<InstallationOrderDetail {...props} />)
    await user.click(screen.getByRole('button', { name: 'Edytuj dane' }))
    await user.clear(screen.getByLabelText('Telefon'))
    await user.type(screen.getByLabelText('Telefon'), '555000111')
    rerender(<InstallationOrderDetail {...props} formSnapshot={{ id: 'snap', templateId: 't', templateVersion: 1, schemaJson: '{"name":"Nowe pytania","questions":[]}' }} rooms={[{ id: 'r', name: 'Nowy salon', scopes: [], measurements: [] }]} />)
    expect(screen.getByText('Nowe pytania · wersja 1')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Nowy salon' })).not.toBeNull()
    expect((screen.getByLabelText('Telefon') as HTMLInputElement).value).toBe('555000111')
  })
  it('offers latest submitted answers with older revisions collapsed', async () => {
    const user = userEvent.setup()
    const revision = { formSubmissionId: 's1', revisionNumber: 1, status: 'SUBMITTED', submittedAt: '2026-09-01', templateVersion: 1, questions: [], answers: [] }
    render(<InstallationFormRevisionPanel revisions={[revision, { ...revision, formSubmissionId: 's2', revisionNumber: 2 }]} />)
    await user.click(screen.getByRole('button', { name: 'Zobacz odpowiedzi klienta' }))
    expect(screen.getByRole('heading', { name: 'Podgląd formularza klienta · wersja 2' })).not.toBeNull()
    expect(screen.getByText('Historia odpowiedzi').closest('details')?.open).toBe(false)
  })
  it('leads with contact links and preparation, keeping editing and settings out of the way', async () => {
    const user = userEvent.setup()
    const { container } = render(<InstallationOrderDetail order={order} employees={[]} canEdit canArchive />)
    expect(screen.getByRole('link', { name: order.client.phone }).getAttribute('href')).toBe(`tel:${order.client.phone}`)
    expect(screen.getByRole('link', { name: order.client.email }).getAttribute('href')).toBe(`mailto:${order.client.email}`)
    expect(screen.queryByLabelText('Klient')).toBeNull()
    const ids = [...container.querySelectorAll('[data-card-section]')].map((node) => node.id)
    expect(ids).toEqual(['preparation', 'scope', 'client-form', 'visits', 'attachments', 'settings'])
    await user.click(screen.getByRole('button', { name: 'Edytuj dane' }))
    await user.clear(screen.getByLabelText('Klient'))
    await user.type(screen.getByLabelText('Klient'), 'Nowa nazwa')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: 'Anuluj' }))
    expect(confirm).toHaveBeenCalled()
    expect((screen.getByLabelText('Klient') as HTMLInputElement).value).toBe('Nowa nazwa')
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Anuluj' }))
    expect(screen.queryByLabelText('Klient')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Jan Kowalski', level: 1 })).not.toBeNull()
  })

  it('unlocks link generation after saving a template without a reload', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'snap', templateId: 'template', templateVersion: 1, schemaJson: JSON.stringify({ name: 'Tapety', questions: [] }) }), { status: 201 })))
    render(<InstallationOrderDetail order={order} employees={[]} canEdit publishedTemplates={[{ id: 'template', name: 'Tapety', version: 1 }]} />)
    expect((screen.getByRole('button', { name: 'Wygeneruj link', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    await user.selectOptions(screen.getByLabelText('Wersja formularza dla zlecenia'), 'template')
    await user.click(screen.getByRole('button', { name: 'Wybierz formularz', exact: true }))
    expect((screen.getByRole('button', { name: 'Wygeneruj link', exact: true }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('distinguishes outstanding fee acceptance from a missing submitted form', () => {
    render(<InstallationOrderDetail order={order} employees={[]} canEdit formSnapshot={{ id: 'snap', templateId: 'template', templateVersion: 1, schemaJson: '{"questions":[]}' }} readiness={{ isReady: false, openBlockingCount: 0, submittedCount: 1, visitFeeAcceptanceRequired: true }} />)
    const preparation = screen.getByRole('region', { name: 'Do ustalenia przed montażem' })
    expect(within(preparation).getByText(/potwierdzenie.*opłac/i)).not.toBeNull()
    expect(within(preparation).queryByText(/Czekamy na formularz/)).toBeNull()
    expect(within(preparation).queryByText('Gotowe do planowania')).toBeNull()
  })

  it('keeps the generated URL after marking sent and collapsing link management', async () => {
    const user = userEvent.setup()
    const link = { id: 'link', expiresAt: '2030-01-01', revokedAt: null, createdAt: '2026-01-01', lastOpenedAt: null, sentAt: null, sentById: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ link, url: 'https://example.test/m/one-time' }), { status: 201 })).mockResolvedValueOnce(new Response(JSON.stringify({ link: { ...link, sentAt: '2026-09-07', sentById: 'a' } }))))
    render(<ClientLinkPanel orderId="order-1" canEdit initialLinks={[]} />)
    await user.click(screen.getByRole('button', { name: 'Wygeneruj link', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Oznacz jako wysłany' }))
    expect(screen.getByText('https://example.test/m/one-time')).not.toBeNull()
    await user.click(screen.getByText('Zarządzaj linkiem'))
    await user.click(screen.getByText('Zarządzaj linkiem'))
    expect(screen.getByText('https://example.test/m/one-time')).not.toBeNull()
  })
})
