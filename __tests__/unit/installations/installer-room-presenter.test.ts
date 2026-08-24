import { describe, expect, it, vi } from 'vitest'
import { getInstallerInstallationOrderRooms } from '@/lib/installations/catalog-service'
import { presentInstallerInstallationRooms } from '@/lib/installations/installer-room-presenter'

describe('installer room presenter', () => {
  it('keeps only the work fields and removes measurement provenance', () => {
    const payload = presentInstallerInstallationRooms([{
      id: 'room-1', name: 'Salon', sortOrder: 0,
      scopes: [{
        id: 'scope-own', name: 'Tapeta', sortOrder: 0,
        scopeProducts: [{ id: 'product-own', productNameSnapshot: 'Produkt własny', productCodeSnapshot: 'P-1', manufacturerSnapshot: 'Producent', collectionSnapshot: 'Kolekcja', batchSnapshot: 'PARTIA-24', sortOrder: 0, catalogProductId: 'SENTINEL-CATALOG-ID' }],
        measurements: [{ id: 'measurement-own', elementName: 'Szerokość', kind: 'RECTANGLE', value: '500', secondaryValue: '250', unit: 'CM', source: 'CLIENT', authorId: 'SENTINEL-AUTHOR', authorContext: 'SENTINEL-CONTEXT', actorUserId: 'SENTINEL-USER', actorRole: 'ADMIN' }],
      }],
    }])
    const serialized = JSON.stringify(payload)

    expect(payload).toEqual([{
      id: 'room-1', name: 'Salon', sortOrder: 0, measurements: [], scopes: [{
        id: 'scope-own', name: 'Tapeta', sortOrder: 0,
        scopeProducts: [{ id: 'product-own', productNameSnapshot: 'Produkt własny', productCodeSnapshot: 'P-1', manufacturerSnapshot: 'Producent', collectionSnapshot: 'Kolekcja', batchSnapshot: 'PARTIA-24', sortOrder: 0 }],
        measurements: [{ id: 'measurement-own', elementName: 'Szerokość', kind: 'RECTANGLE', value: '500', secondaryValue: '250', unit: 'CM' }],
      }],
    }])
    for (const sentinel of ['SENTINEL-CATALOG-ID', 'SENTINEL-AUTHOR', 'SENTINEL-CONTEXT', 'SENTINEL-USER', 'source', 'author', 'actor']) {
      expect(serialized).not.toContain(sentinel)
    }
  })

  it('filters the database query by the current employee scope assignment before selecting fields', async () => {
    const findMany = vi.fn().mockResolvedValue([])

    await getInstallerInstallationOrderRooms({ installationRoom: { findMany } } as never, 'order-1', 'installer-1')

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        orderId: 'order-1',
        scopes: { some: { assignments: { some: { employeeId: 'installer-1' } } } },
      },
      select: expect.objectContaining({
        scopes: expect.objectContaining({
          where: { assignments: { some: { employeeId: 'installer-1' } } },
        }),
      }),
    }))
  })
})
