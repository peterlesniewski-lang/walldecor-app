import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallationOrderDetail } from '@/components/installations/order-detail'
import { RoomScopeEditor } from '@/components/installations/room-scope-editor'
import { TemplateBuilder } from '@/components/installations/template-builder'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const archivedOrder = {
  id: 'archived-order', number: 'MON-ARCHIVED', status: 'ARCHIVED', archivedAt: '2026-08-22T12:00:00.000Z',
  client: { name: 'Archiwalny klient', email: 'archived@example.test', phone: '+48 501 000 000' },
  addressStreet: 'Dobra', addressBuildingNumber: '1', addressApartmentNumber: null, addressPostalCode: '00-001', addressCity: 'Warszawa',
  primaryEmployee: { firstName: 'Anna', lastName: 'Opiekun' }, backupEmployee: { firstName: 'Bartek', lastName: 'Zastępca' },
}

const rooms = [{ id: 'room-1', name: 'Salon', sortOrder: 0, measurements: [], scopes: [{ id: 'scope-1', name: 'Ściana', sortOrder: 0, measurements: [], scopeProducts: [] }] }]
const catalog = [{ id: 'category-1', name: 'Tapety', types: [{ id: 'type-1', name: 'Winylowe', products: [{ id: 'product-1', name: 'Ciepły len', code: null }] }] }]

describe('Task 2 corrective UI invariants', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('renders an archived order as read-only even if a stale canEdit prop is true', () => {
    render(createElement(InstallationOrderDetail, {
      order: archivedOrder, employees: [], canEdit: true, canArchive: true, rooms, catalog,
    } as never))

    expect(screen.getByText('Karta jest zarchiwizowana. Historia i odpowiedzialność pozostają zachowane.')).toBeTruthy()
    expect(screen.queryByLabelText('Nazwa pomieszczenia')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edytuj pokój Salon' })).toBeNull()
    expect(screen.queryByLabelText('Produkt dla Ściana')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archiwizuj zlecenie' })).toBeNull()
  })

  it('does not put measurement provenance fields into the browser request', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'measurement-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => rooms })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(RoomScopeEditor, { orderId: 'order-1', initialRooms: rooms, catalog, canEdit: true }))

    await user.type(screen.getByLabelText('Nazwa pomiaru w Salon'), 'Szerokość glifu')
    await user.type(screen.getByLabelText('Wartość pomiaru w Salon'), '12.5')
    await user.click(screen.getByRole('button', { name: 'Dodaj pomiar' }))

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(request.body as string)
    expect(body).not.toHaveProperty('source')
    expect(body).not.toHaveProperty('authorId')
    expect(body).not.toHaveProperty('authorContext')
  })

  it('lets an administrator select and edit the older of two existing drafts', async () => {
    const user = userEvent.setup()
    const older = { id: 'draft-old', familyId: 'family-old', name: 'Starszy szkic', version: 1, status: 'DRAFT', questionDefinitions: [] }
    const newer = { id: 'draft-new', familyId: 'family-new', name: 'Nowszy szkic', version: 1, status: 'DRAFT', questionDefinitions: [] }
    render(createElement(TemplateBuilder, { initialTemplates: [newer, older] } as never))

    const picker = screen.getByLabelText('Wybierz szkic do edycji')
    await user.selectOptions(picker, older.id)

    expect(screen.getByRole('heading', { name: 'Starszy szkic' })).toBeTruthy()
  })
})
