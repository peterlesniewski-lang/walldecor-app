import { createElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogManager } from '@/components/installations/catalog-manager'

const initialCatalog = [
  { id: 'category-wallpaper', name: 'Tapetowanie', sortOrder: 0, types: [{ id: 'type-1', name: 'Winylowe', sortOrder: 0, products: [{ id: 'product-1', name: 'Misty Grey', code: 'MG-01', manufacturer: 'WallDecor', collection: 'Misty', sortOrder: 0 }] }] },
  { id: 'category-trim', name: 'Sztukateria', sortOrder: 1, types: [] },
]

describe('catalog work types UI', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('shows flat active work types without product, SKU, or nested type editors', () => {
    render(createElement(CatalogManager, { initialCatalog }))

    expect(screen.getByRole('heading', { name: 'Rodzaje prac' })).toBeTruthy()
    expect(screen.getByText('Tapetowanie')).toBeTruthy()
    expect(screen.getByText('Sztukateria')).toBeTruthy()
    expect(screen.queryByText('Winylowe')).toBeNull()
    expect(screen.queryByText('Misty Grey')).toBeNull()
    expect(screen.queryByLabelText(/Kod.*produktu/i)).toBeNull()
  })

  it('adds, renames, reorders and archives a work type through category endpoints', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'category-new' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => initialCatalog })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'category-wallpaper', name: 'Tapety' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => initialCatalog })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => initialCatalog })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'category-trim', isActive: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => initialCatalog.filter((entry) => entry.id !== 'category-trim') })
    vi.stubGlobal('fetch', fetchMock)
    render(createElement(CatalogManager, { initialCatalog }))

    await user.type(screen.getByLabelText('Nowy rodzaj pracy'), 'Malowanie')
    await user.click(screen.getByRole('button', { name: 'Dodaj rodzaj prac' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ kind: 'category', name: 'Malowanie' })

    await user.click(screen.getByRole('button', { name: 'Edytuj rodzaj prac Tapetowanie' }))
    await user.clear(screen.getByLabelText('Nowa nazwa rodzaju prac'))
    await user.type(screen.getByLabelText('Nowa nazwa rodzaju prac'), 'Tapety')
    await user.click(screen.getByRole('button', { name: 'Zapisz rodzaj prac' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/installations/catalog/category/category-wallpaper')

    await user.click(screen.getByRole('button', { name: 'Przesuń rodzaj prac Tapetowanie niżej' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/installations/catalog/category/reorder')
    expect(JSON.parse((fetchMock.mock.calls[4]?.[1] as RequestInit).body as string)).toEqual({ orderedIds: ['category-trim', 'category-wallpaper'] })

    await user.click(screen.getByRole('button', { name: 'Archiwizuj rodzaj prac Sztukateria' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8))
    expect(fetchMock.mock.calls[6]?.[0]).toBe('/api/installations/catalog/category/category-trim')
    expect((fetchMock.mock.calls[6]?.[1] as RequestInit).method).toBe('DELETE')
  })
})
