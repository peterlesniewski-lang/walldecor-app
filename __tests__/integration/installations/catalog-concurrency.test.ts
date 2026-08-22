import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { archiveCatalogCategory, archiveCatalogType } from '@/lib/installations/catalog-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installations-catalog-concurrency-'))
const databasePath = path.join(databaseDirectory, 'catalog-concurrency.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let writer: PrismaClient

function applyMigrations(databaseFile: string) {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationSqlPath of readdirSync(migrationRoot).sort().map((directory) => path.join(migrationRoot, directory, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databaseFile], { cwd: process.cwd(), input: readFileSync(migrationSqlPath, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

async function createActiveBranch(prefix: string) {
  const category = await db.installationCatalogCategory.create({ data: { name: `${prefix} category`, nameKey: `${prefix}-category`, sortOrder: 0 } })
  const type = await db.installationCatalogType.create({ data: { categoryId: category.id, name: `${prefix} type`, nameKey: `${prefix}-type`, sortOrder: 0 } })
  return { category, type }
}

async function assertNoActiveChildUnderInactiveParent() {
  const [types, productsUnderType, productsUnderCategory] = await Promise.all([
    db.installationCatalogType.count({ where: { isActive: true, category: { isActive: false } } }),
    db.installationCatalogProduct.count({ where: { isActive: true, type: { isActive: false } } }),
    db.installationCatalogProduct.count({ where: { isActive: true, type: { category: { isActive: false } } } }),
  ])
  expect({ types, productsUnderType, productsUnderCategory }).toEqual({ types: 0, productsUnderType: 0, productsUnderCategory: 0 })
}

function assertOnlyExpectedInvariantRejections(results: PromiseSettledResult<unknown>[]) {
  for (const result of results) {
    if (result.status === 'rejected') expect(['P2003', 'P2004']).toContain((result.reason as { code?: string }).code)
  }
}

beforeAll(async () => {
  applyMigrations(databasePath)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  writer = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await Promise.all([db.$executeRawUnsafe('PRAGMA foreign_keys = ON'), writer.$executeRawUnsafe('PRAGMA foreign_keys = ON')])
})

afterAll(async () => {
  await Promise.all([db?.$disconnect(), writer?.$disconnect()])
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('catalog active-parent invariant uses the database as the concurrency boundary', () => {
  it('rejects direct active children, reactivation, reassignment and direct parent archive that would violate the hierarchy', async () => {
    const inactiveCategory = await db.installationCatalogCategory.create({ data: { name: 'Inactive category', nameKey: 'inactive-category', sortOrder: 0, isActive: false, archivedAt: new Date() } })
    await expect(writer.installationCatalogType.create({ data: { categoryId: inactiveCategory.id, name: 'Forbidden type', nameKey: 'forbidden-type', sortOrder: 0 } })).rejects.toBeTruthy()

    const { category, type } = await createActiveBranch('direct-invariant')
    const product = await db.installationCatalogProduct.create({ data: { typeId: type.id, name: 'Direct product', nameKey: 'direct-product', sortOrder: 0 } })
    const inactiveType = await db.installationCatalogType.create({ data: { categoryId: category.id, name: 'Inactive type', nameKey: 'inactive-type', sortOrder: 1, isActive: false, archivedAt: new Date() } })
    await expect(writer.installationCatalogType.update({ where: { id: type.id }, data: { categoryId: inactiveCategory.id } })).rejects.toBeTruthy()
    await expect(writer.installationCatalogProduct.update({ where: { id: product.id }, data: { typeId: inactiveType.id } })).rejects.toBeTruthy()
    await expect(writer.installationCatalogCategory.update({ where: { id: category.id }, data: { isActive: false, archivedAt: new Date() } })).rejects.toBeTruthy()
    await expect(writer.installationCatalogType.update({ where: { id: type.id }, data: { isActive: false, archivedAt: new Date() } })).rejects.toBeTruthy()

    await db.installationCatalogProduct.update({ where: { id: product.id }, data: { isActive: false, archivedAt: new Date() } })
    await db.installationCatalogType.update({ where: { id: type.id }, data: { isActive: false, archivedAt: new Date() } })
    await db.installationCatalogCategory.update({ where: { id: category.id }, data: { isActive: false, archivedAt: new Date() } })
    await expect(writer.installationCatalogType.update({ where: { id: type.id }, data: { isActive: true, archivedAt: null } })).rejects.toBeTruthy()
    await expect(writer.installationCatalogProduct.update({ where: { id: product.id }, data: { isActive: true, archivedAt: null } })).rejects.toBeTruthy()
    await assertNoActiveChildUnderInactiveParent()
  })

  it('keeps the hierarchy valid in 40 archive-versus-direct-writer rounds in both start orders', async () => {
    for (let round = 0; round < 40; round += 1) {
      const prefix = `race-${round}`
      const { category, type } = await createActiveBranch(prefix)
      const inactiveProduct = await db.installationCatalogProduct.create({ data: { typeId: type.id, name: `${prefix} inactive`, nameKey: `${prefix}-inactive`, sortOrder: 0, isActive: false, archivedAt: new Date() } })
      const archiveCategory = () => archiveCatalogCategory(db, category.id)
      const archiveType = () => archiveCatalogType(db, type.id)
      const createType = () => writer.installationCatalogType.create({ data: { categoryId: category.id, name: `${prefix} child type`, nameKey: `${prefix}-child-type`, sortOrder: 1 } })
      const createProduct = () => writer.installationCatalogProduct.create({ data: { typeId: type.id, name: `${prefix} child product`, nameKey: `${prefix}-child-product`, sortOrder: 1 } })
      const reactivateProduct = () => writer.installationCatalogProduct.update({ where: { id: inactiveProduct.id }, data: { isActive: true, archivedAt: null } })
      const operations = round % 4 === 0
        ? [archiveCategory(), createType()]
        : round % 4 === 1
          ? [createProduct(), archiveCategory()]
          : round % 4 === 2
            ? [archiveType(), createProduct()]
            : [reactivateProduct(), archiveType()]
      const results = await Promise.allSettled(operations)
      assertOnlyExpectedInvariantRejections(results)
      await assertNoActiveChildUnderInactiveParent()
    }
  })
})
