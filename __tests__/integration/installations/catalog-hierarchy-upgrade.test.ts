import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createInstallationOrder } from '@/lib/installations/order-service'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-hierarchy-upgrade-'))
const databasePath = path.join(databaseDirectory, 'legacy-upgrade.db')
const databaseUrl = `file:${databasePath}`
const freshDatabasePath = path.join(databaseDirectory, 'fresh-full-chain.db')
const freshDatabaseUrl = `file:${freshDatabasePath}`

function runMigrate(databaseUrlValue: string, schemaPath?: string) {
  const args = [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy']
  if (schemaPath) args.push('--schema', schemaPath)
  const result = spawnSync(process.execPath, args, { cwd: workspace, env: { ...process.env, DATABASE_URL: databaseUrlValue, RUST_LOG: 'debug' }, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
}

function createTwentyMigrationPrismaDirectory() {
  const root = path.join(databaseDirectory, 'twenty-migration-prisma')
  const migrations = path.join(root, 'migrations')
  mkdirSync(migrations, { recursive: true })
  cpSync(path.join(workspace, 'prisma', 'schema.prisma'), path.join(root, 'schema.prisma'))
  cpSync(path.join(workspace, 'prisma', 'migrations', 'migration_lock.toml'), path.join(migrations, 'migration_lock.toml'))
  for (const migration of readdirSync(path.join(workspace, 'prisma', 'migrations')).sort().filter((name) => name <= '20260822020100_installation_measurement_provenance')) {
    const source = path.join(workspace, 'prisma', 'migrations', migration)
    if (existsSync(path.join(source, 'migration.sql'))) cpSync(source, path.join(migrations, migration), { recursive: true })
  }
  return path.join(root, 'schema.prisma')
}

async function seedLegacyInconsistentHierarchy(db: PrismaClient) {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  const legacyUpdatedAt = new Date('2026-08-01T00:00:00.000Z')
  const legacyProductArchivedAt = new Date('2026-08-02T00:00:00.000Z')
  const inactiveCategory = await db.installationCatalogCategory.create({ data: { id: 'legacy-inactive-category', name: 'Legacy inactive category', nameKey: 'legacy-inactive-category', sortOrder: 0, isActive: false, archivedAt: new Date('2026-08-01T00:00:00.000Z') } })
  const activeTypeUnderInactiveCategory = await db.installationCatalogType.create({ data: { id: 'legacy-active-type-under-inactive-category', categoryId: inactiveCategory.id, name: 'Legacy active type', nameKey: 'legacy-active-type', sortOrder: 0, isActive: true, updatedAt: legacyUpdatedAt } })
  const productUnderInactiveCategory = await db.installationCatalogProduct.create({ data: { id: 'legacy-product-under-inactive-category', typeId: activeTypeUnderInactiveCategory.id, name: 'Legacy category product', nameKey: 'legacy-category-product', sortOrder: 0, isActive: true, archivedAt: legacyProductArchivedAt, updatedAt: legacyUpdatedAt } })

  const activeCategory = await db.installationCatalogCategory.create({ data: { id: 'legacy-active-category', name: 'Legacy active category', nameKey: 'legacy-active-category', sortOrder: 1 } })
  const inactiveType = await db.installationCatalogType.create({ data: { id: 'legacy-inactive-type', categoryId: activeCategory.id, name: 'Legacy inactive type', nameKey: 'legacy-inactive-type', sortOrder: 0, isActive: false, archivedAt: new Date('2026-08-01T00:00:00.000Z') } })
  const productUnderInactiveType = await db.installationCatalogProduct.create({ data: { id: 'legacy-product-under-inactive-type', typeId: inactiveType.id, name: 'Legacy type product', nameKey: 'legacy-type-product', sortOrder: 0, isActive: true, updatedAt: legacyUpdatedAt } })

  await db.costCenter.create({ data: { id: 'LGC', name: 'Legacy upgrade' } })
  const [primary, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Legacy', email: 'legacy.primary@example.test', position: 'Koordynatorka', costCenterId: 'LGC', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Legacy', email: 'legacy.backup@example.test', position: 'Koordynator', costCenterId: 'LGC', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
  ])
  const order = await createInstallationOrder(db, {
    client: { name: 'Legacy history', email: 'legacy.history@example.test', phone: '+48 501 000 001' },
    address: { street: 'Dobra', buildingNumber: '1', postalCode: '00-001', city: 'Warszawa' },
    primaryEmployeeId: primary.id, backupEmployeeId: backup.id,
  }, 'legacy-migration')
  const template = await db.installationFormTemplate.create({ data: { id: 'legacy-template', familyId: 'legacy-family', name: 'Legacy form', nameKey: 'legacy-form', version: 1, status: 'PUBLISHED', publishedAt: new Date('2026-08-01T00:00:00.000Z') } })
  const snapshot = await db.installationOrderFormSnapshot.create({ data: { id: 'legacy-snapshot', orderId: order.id, templateId: template.id, templateVersion: 1, schemaJson: '{"name":"Legacy form","version":1,"questions":[]}', createdById: 'legacy-migration' } })
  const room = await db.installationRoom.create({ data: { orderId: order.id, name: 'Legacy room', sortOrder: 0 } })
  const scope = await db.installationScope.create({ data: { roomId: room.id, name: 'Legacy scope', sortOrder: 0 } })
  const scopeProduct = await db.installationScopeProduct.create({ data: { scopeId: scope.id, catalogProductId: productUnderInactiveCategory.id, productNameSnapshot: 'Legacy category product', productCodeSnapshot: 'LEG-001', manufacturerSnapshot: 'Legacy maker', collectionSnapshot: 'Legacy collection', sortOrder: 0 } })
  return { productUnderInactiveCategory, productUnderInactiveType, activeTypeUnderInactiveCategory, snapshot, scopeProduct, legacyUpdatedAt, legacyProductArchivedAt }
}

async function assertRecoveredDatabase(db: PrismaClient, history: Awaited<ReturnType<typeof seedLegacyInconsistentHierarchy>>) {
  const [invalidTypes, invalidProductsUnderType, invalidProductsUnderCategory, repairedProducts, repairedType, snapshot, scopeProduct, triggers, foreignKeys, integrity] = await Promise.all([
    db.installationCatalogType.count({ where: { isActive: true, category: { isActive: false } } }),
    db.installationCatalogProduct.count({ where: { isActive: true, type: { isActive: false } } }),
    db.installationCatalogProduct.count({ where: { isActive: true, type: { category: { isActive: false } } } }),
    db.installationCatalogProduct.findMany({ where: { id: { in: [history.productUnderInactiveCategory.id, history.productUnderInactiveType.id] } } }),
    db.installationCatalogType.findUniqueOrThrow({ where: { id: history.activeTypeUnderInactiveCategory.id } }),
    db.installationOrderFormSnapshot.findUniqueOrThrow({ where: { id: history.snapshot.id } }),
    db.installationScopeProduct.findUniqueOrThrow({ where: { id: history.scopeProduct.id } }),
    db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'InstallationCatalog%' ORDER BY name"),
    db.$queryRawUnsafe('PRAGMA foreign_key_check'), db.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check'),
  ])
  expect({ invalidTypes, invalidProductsUnderType, invalidProductsUnderCategory }).toEqual({ invalidTypes: 0, invalidProductsUnderType: 0, invalidProductsUnderCategory: 0 })
  const repairedCategoryProduct = repairedProducts.find((product) => product.id === history.productUnderInactiveCategory.id)
  const repairedTypeProduct = repairedProducts.find((product) => product.id === history.productUnderInactiveType.id)
  expect(repairedCategoryProduct).toMatchObject({ isActive: false, archivedAt: history.legacyProductArchivedAt })
  expect(repairedTypeProduct).toMatchObject({ isActive: false, archivedAt: expect.any(Date) })
  expect(repairedCategoryProduct?.updatedAt.getTime()).toBeGreaterThan(history.legacyUpdatedAt.getTime())
  expect(repairedTypeProduct?.updatedAt.getTime()).toBeGreaterThan(history.legacyUpdatedAt.getTime())
  expect(repairedType).toMatchObject({ isActive: false, archivedAt: expect.any(Date) })
  expect(repairedType.updatedAt.getTime()).toBeGreaterThan(history.legacyUpdatedAt.getTime())
  expect(snapshot).toMatchObject({ id: history.snapshot.id, schemaJson: history.snapshot.schemaJson, templateVersion: 1 })
  expect(scopeProduct).toMatchObject({ id: history.scopeProduct.id, productNameSnapshot: 'Legacy category product', productCodeSnapshot: 'LEG-001', manufacturerSnapshot: 'Legacy maker', collectionSnapshot: 'Legacy collection', catalogProductId: history.productUnderInactiveCategory.id })
  expect(triggers).toHaveLength(6)
  expect(foreignKeys).toEqual([])
  expect(integrity[0]?.integrity_check).toBe('ok')
}

afterAll(() => rmSync(databaseDirectory, { recursive: true, force: true }))

describe('installation catalog hierarchy migration upgrade', () => {
  it('repairs a 20-migration legacy database through real deploy without touching snapshots or scope history, then stays stable on a second deploy', async () => {
    runMigrate(databaseUrl, createTwentyMigrationPrismaDirectory())
    let db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    const history = await seedLegacyInconsistentHierarchy(db)
    expect(await db.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name')).toHaveLength(20)
    await db.$disconnect()

    runMigrate(databaseUrl)
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    await assertRecoveredDatabase(db, history)
    const firstRepair = await db.installationCatalogProduct.findMany({ where: { id: { in: [history.productUnderInactiveCategory.id, history.productUnderInactiveType.id] } }, orderBy: { id: 'asc' } })
    await db.$disconnect()

    runMigrate(databaseUrl)
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    await assertRecoveredDatabase(db, history)
    expect(await db.installationCatalogProduct.findMany({ where: { id: { in: [history.productUnderInactiveCategory.id, history.productUnderInactiveType.id] } }, orderBy: { id: 'asc' } })).toEqual(firstRepair)
    await db.$disconnect()
  })

  it('applies the complete fresh chain, including client-form migration, with healthy SQLite integrity', async () => {
    runMigrate(freshDatabaseUrl)
    const db = new PrismaClient({ datasources: { db: { url: freshDatabaseUrl } } })
    const [migrations, triggers, clientFormTriggers, foreignKeys, integrity] = await Promise.all([
      db.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name'),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'InstallationCatalog%' ORDER BY name"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'InstallationAnswer_submitted_%' ORDER BY name"),
      db.$queryRawUnsafe('PRAGMA foreign_key_check'), db.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check'),
    ])
    expect(migrations).toHaveLength(24)
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260822030000_installation_client_form')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260822030100_installation_submitted_answer_insert_guard')
    expect(triggers).toHaveLength(6)
    expect(clientFormTriggers).toEqual([
      { name: 'InstallationAnswer_submitted_delete_guard' },
      { name: 'InstallationAnswer_submitted_insert_guard' },
      { name: 'InstallationAnswer_submitted_update_guard' },
    ])
    expect(foreignKeys).toEqual([])
    expect(integrity[0]?.integrity_check).toBe('ok')
    await db.$disconnect()
  })
})
