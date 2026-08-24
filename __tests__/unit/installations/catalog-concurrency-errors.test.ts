import { describe, expect, it, vi } from 'vitest'
import { createCatalogProduct, createCatalogType, InstallationCatalogValidationError } from '@/lib/installations/catalog-service'

const triggerRaceError = { code: 'P2003', message: 'Foreign key constraint violated after parent archive.' }
const triggerRaceP2004Error = { code: 'P2004', message: 'Constraint failed after parent archive.' }

describe('catalog hierarchy constraint error mapping', () => {
  it('maps an archived category race during type creation to a 409 domain error', async () => {
    const db = {
      installationCatalogCategory: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ isActive: true })
          .mockResolvedValueOnce({ isActive: false }),
      },
      installationCatalogType: { create: vi.fn().mockRejectedValue(triggerRaceError) },
    }

    await expect(createCatalogType(db as never, { categoryId: 'category-1', name: 'Winylowe', sortOrder: 0 }))
      .rejects.toMatchObject({ name: 'InstallationCatalogValidationError', status: 409, fieldErrors: { categoryId: expect.stringMatching(/Rodzic został zarchiwizowany/) } })
  })

  it('maps an archived type/category race during product creation but preserves unrelated database errors', async () => {
    const archivedDb = {
      installationCatalogType: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ isActive: true, category: { isActive: true } })
          .mockResolvedValueOnce({ isActive: false, category: { isActive: true } }),
      },
      installationCatalogProduct: { create: vi.fn().mockRejectedValue(triggerRaceP2004Error) },
    }
    await expect(createCatalogProduct(archivedDb as never, { typeId: 'type-1', name: 'Misty Grey', sortOrder: 0 }))
      .rejects.toMatchObject({ name: 'InstallationCatalogValidationError', status: 409, fieldErrors: { typeId: expect.stringMatching(/Rodzic został zarchiwizowany/) } })

    const unrelatedError = { code: 'P2003', message: 'Foreign key constraint violated: missing parent.' }
    const unrelatedDb = {
      installationCatalogCategory: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
      installationCatalogType: { create: vi.fn().mockRejectedValue(unrelatedError) },
    }
    await expect(createCatalogType(unrelatedDb as never, { categoryId: 'category-1', name: 'Inny typ', sortOrder: 0 })).rejects.toBe(unrelatedError)
    expect(InstallationCatalogValidationError).toBeDefined()
  })
})
