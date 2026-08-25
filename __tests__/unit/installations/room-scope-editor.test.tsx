import { createElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomScopeEditor } from '@/components/installations/room-scope-editor'

const catalog = [
  { id: 'category-wallpaper', name: 'Tapetowanie', types: [] },
  { id: 'category-trim', name: 'Sztukateria', types: [] },
]

const baseRooms = [{
  id: 'room-1', name: 'Salon', sortOrder: 0,
  scopes: [{
    id: 'scope-1', name: 'Tapetowanie', catalogCategoryId: 'category-wallpaper', sortOrder: 0,
    scopeProducts: [], measurements: [],
  }],
  measurements: [],
}]

describe('room scope editor order products and measurements UI', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('creates a scope from an active work type, not from a free-text name', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'scope-2' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => baseRooms })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(RoomScopeEditor, { orderId: 'order-1', initialRooms: baseRooms, catalog, canEdit: true }))

    await user.selectOptions(screen.getByLabelText('Rodzaj prac dla Salon'), 'category-trim')
    await user.click(screen.getByRole('button', { name: 'Dodaj zakres w Salon' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/installations/order-1/rooms/room-1/scopes')
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ catalogCategoryId: 'category-trim' })
    expect(screen.queryByLabelText('Nowy zakres w Salon')).toBeNull()
  })

  it('adds direct order-owned products with all snapshot fields and skips an empty row', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'scope-product-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => baseRooms })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(RoomScopeEditor, { orderId: 'order-1', initialRooms: baseRooms, catalog, canEdit: true }))

    const add = screen.getByRole('button', { name: 'Dodaj produkt do Tapetowanie' })
    expect(add).toHaveProperty('disabled', true)
    await user.type(screen.getByLabelText('Nazwa produktu dla Tapetowanie'), 'Tapeta na zamówienie')
    await user.type(screen.getByLabelText('Producent produktu dla Tapetowanie'), 'WallDecor')
    await user.type(screen.getByLabelText('Kod / SKU produktu dla Tapetowanie'), 'WD-01')
    await user.type(screen.getByLabelText('Kolekcja / seria produktu dla Tapetowanie'), 'Misty')
    await user.type(screen.getByLabelText('Partia produktu dla Tapetowanie'), 'PARTIA-24')
    await user.click(add)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      productNameSnapshot: 'Tapeta na zamówienie', manufacturerSnapshot: 'WallDecor', productCodeSnapshot: 'WD-01', collectionSnapshot: 'Misty', batchSnapshot: 'PARTIA-24',
    })
  })

  it('sends RECTANGLE and SINGLE measurement payloads to the owning scope', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'measurement-rectangle' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => baseRooms })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'measurement-single' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => baseRooms })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(RoomScopeEditor, { orderId: 'order-1', initialRooms: baseRooms, catalog, canEdit: true }))

    await user.type(screen.getByLabelText('Nazwa pomiaru dla Tapetowanie'), 'Ściana')
    await user.type(screen.getByLabelText('Szerokość pomiaru dla Tapetowanie'), '240')
    await user.type(screen.getByLabelText('Wysokość pomiaru dla Tapetowanie'), '260')
    await user.selectOptions(screen.getByLabelText('Jednostka pomiaru dla Tapetowanie'), 'CM')
    await user.click(screen.getByRole('button', { name: 'Dodaj pomiar do Tapetowanie' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ kind: 'RECTANGLE', elementName: 'Ściana', value: '240', secondaryValue: '260', unit: 'CM', scopeId: 'scope-1' })

    await user.click(screen.getByRole('button', { name: 'Długość / ilość' }))
    await user.type(screen.getByLabelText('Nazwa pomiaru dla Tapetowanie'), 'Listwa')
    await user.type(screen.getByLabelText('Wartość pomiaru dla Tapetowanie'), '3')
    await user.selectOptions(screen.getByLabelText('Jednostka pomiaru dla Tapetowanie'), 'MB')
    await user.click(screen.getByRole('button', { name: 'Dodaj pomiar do Tapetowanie' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(JSON.parse((fetchMock.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual({ kind: 'SINGLE', elementName: 'Listwa', value: '3', unit: 'MB', scopeId: 'scope-1' })
  })

  it('uses the selected scope when creating a measurement from the general room section', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'measurement-assigned' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => baseRooms })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(RoomScopeEditor, { orderId: 'order-1', initialRooms: baseRooms, catalog, canEdit: true }))

    await user.type(screen.getByLabelText('Nazwa pomiaru w Salon'), 'Pomiar przeniesiony')
    await user.type(screen.getByLabelText('Wartość pomiaru w Salon'), '18')
    await user.selectOptions(screen.getByLabelText('Zakres pomiaru w Salon'), 'scope-1')
    await user.click(screen.getByRole('button', { name: 'Dodaj pomiar' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ kind: 'SINGLE', elementName: 'Pomiar przeniesiony', value: '18', unit: 'CM', scopeId: 'scope-1' })
  })

  it('keeps local product edits after a 409 and sends updatedAt', async () => {
    const user = userEvent.setup()
    const product = { id: 'scope-product-1', catalogProductId: null, productNameSnapshot: 'Tapeta', productCodeSnapshot: 'WD-01', manufacturerSnapshot: 'WallDecor', collectionSnapshot: 'Misty', batchSnapshot: 'STARA', sortOrder: 0, updatedAt: '2026-08-25T10:00:00.000Z' }
    const rooms = [{ ...baseRooms[0], scopes: [{ ...baseRooms[0].scopes[0], scopeProducts: [product] }] }]
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'Konflikt', fieldErrors: { updatedAt: 'Karta została zmieniona.' } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(RoomScopeEditor, { orderId: 'order-1', initialRooms: rooms, catalog, canEdit: true }))

    await user.click(screen.getByRole('button', { name: 'Edytuj produkt Tapeta' }))
    await user.clear(screen.getByLabelText('Partia produktu Tapeta'))
    await user.type(screen.getByLabelText('Partia produktu Tapeta'), 'NOWA')
    await user.click(screen.getByRole('button', { name: 'Zapisz produkt Tapeta' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({ batchSnapshot: 'NOWA', updatedAt: '2026-08-25T10:00:00.000Z' }))
    expect((screen.getByLabelText('Partia produktu Tapeta') as HTMLInputElement).value).toBe('NOWA')
    expect(screen.getByRole('alert').textContent).toContain('Karta została zmieniona.')
  })

  it('keeps general room measurements separate and confirms deleting a non-empty scope', async () => {
    const user = userEvent.setup()
    const rooms = [{ ...baseRooms[0], measurements: [{ id: 'general-1', scopeId: null, elementName: 'Drzwi', kind: 'SINGLE', value: '90', secondaryValue: null, unit: 'CM' }], scopes: [{ ...baseRooms[0].scopes[0], scopeProducts: [{ id: 'product-1', productNameSnapshot: null, productCodeSnapshot: 'SKU-1', manufacturerSnapshot: null, collectionSnapshot: null, batchSnapshot: 'B-1', sortOrder: 0 }], measurements: [] }] }]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(createElement(RoomScopeEditor, { orderId: 'order-1', initialRooms: rooms, catalog, canEdit: true }))

    expect(screen.getByRole('heading', { name: 'Pomiary ogólne pomieszczenia' })).toBeTruthy()
    expect(screen.getByText('Drzwi: 90 CM')).toBeTruthy()
    expect(screen.getAllByText('SKU-1').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Usuń zakres Tapetowanie' }))
    expect(confirmMock).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
