import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const workspace = process.cwd()
const legacyMigration = '20260824100000_installer_user_employee_invariant'
const orderProductsMigration = '20260824230000_installation_order_products'
const databaseDirectory = mkdtempSync(
  path.join(tmpdir(), 'walldecor-order-products-migration-')
)
const databasePath = path.join(databaseDirectory, 'legacy-upgrade.db')
const databaseUrl = `file:${databasePath}`
const completeMigrationNames = readdirSync(
  path.join(workspace, 'prisma', 'migrations')
)
  .sort()
  .filter((name) =>
    existsSync(path.join(workspace, 'prisma', 'migrations', name, 'migration.sql'))
  )
const legacyMigrationNames = completeMigrationNames.filter(
  (name) => name <= legacyMigration
)

function runMigrate(databaseUrlValue: string, schemaPath?: string) {
  const args = [
    path.join(workspace, 'node_modules/prisma/build/index.js'),
    'migrate',
    'deploy',
  ]

  if (schemaPath) args.push('--schema', schemaPath)

  const result = spawnSync(process.execPath, args, {
    cwd: workspace,
    env: { ...process.env, DATABASE_URL: databaseUrlValue, RUST_LOG: 'debug' },
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    throw new Error(
      `migrate deploy failed (status ${result.status})\n${result.stdout}\n${result.stderr}`
    )
  }
}

function createLegacyPrismaDirectory() {
  const root = path.join(databaseDirectory, 'legacy-prisma')
  const migrations = path.join(root, 'migrations')

  mkdirSync(migrations, { recursive: true })
  cpSync(
    path.join(workspace, 'prisma', 'schema.prisma'),
    path.join(root, 'schema.prisma')
  )
  cpSync(
    path.join(workspace, 'prisma', 'migrations', 'migration_lock.toml'),
    path.join(migrations, 'migration_lock.toml')
  )

  for (const migration of legacyMigrationNames) {
    cpSync(
      path.join(workspace, 'prisma', 'migrations', migration),
      path.join(migrations, migration),
      { recursive: true }
    )
  }

  return path.join(root, 'schema.prisma')
}

async function seedLegacyRecords(db: PrismaClient) {
  const createdAt = new Date('2026-08-20T08:09:10.000Z')
  const updatedAt = new Date('2026-08-21T11:12:13.000Z')

  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({
    data: { id: 'legacy-cost-center', name: 'Legacy migration' },
  })
  const [primaryEmployee, backupEmployee] = await Promise.all([
    db.employee.create({
      data: {
        id: 'legacy-primary-employee',
        firstName: 'Anna',
        lastName: 'Historyczna',
        email: 'legacy-primary@example.test',
        position: 'Koordynatorka',
        costCenterId: 'legacy-cost-center',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    }),
    db.employee.create({
      data: {
        id: 'legacy-backup-employee',
        firstName: 'Bartek',
        lastName: 'Historyczny',
        email: 'legacy-backup@example.test',
        position: 'Koordynator',
        costCenterId: 'legacy-cost-center',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    }),
  ])
  const client = await db.installationClient.create({
    data: {
      id: 'legacy-client',
      name: 'Klient historyczny',
      email: 'legacy-client@example.test',
      phone: '+48 500 600 700',
    },
  })
  const order = await db.installationOrder.create({
    data: {
      id: 'legacy-order',
      number: 'MON-LEGACY-ORDER-PRODUCTS',
      clientId: client.id,
      addressStreet: 'Migracyjna',
      addressBuildingNumber: '24',
      addressPostalCode: '00-024',
      addressCity: 'Warszawa',
      primaryEmployeeId: primaryEmployee.id,
      backupEmployeeId: backupEmployee.id,
    },
  })
  const room = await db.installationRoom.create({
    data: {
      id: 'legacy-room',
      orderId: order.id,
      name: 'Salon historyczny',
      sortOrder: 7,
      createdAt,
      updatedAt,
    },
  })
  const scopeCategory = await db.installationCatalogCategory.create({
    data: {
      id: 'legacy-scope-category',
      name: 'Kategoria zakresu',
      nameKey: 'kategoria-zakresu',
      updatedAt,
    },
  })
  const catalogCategory = await db.installationCatalogCategory.create({
    data: {
      id: 'legacy-catalog-category',
      name: 'Kategoria katalogowa',
      nameKey: 'kategoria-katalogowa',
      updatedAt,
    },
  })
  const catalogType = await db.installationCatalogType.create({
    data: {
      id: 'legacy-catalog-type',
      categoryId: catalogCategory.id,
      name: 'Typ katalogowy',
      nameKey: 'typ-katalogowy',
      updatedAt,
    },
  })
  const catalogProduct = await db.installationCatalogProduct.create({
    data: {
      id: 'legacy-catalog-product',
      typeId: catalogType.id,
      name: 'Produkt katalogowy',
      nameKey: 'produkt-katalogowy',
      manufacturer: 'WallDecor',
      collection: 'Kolekcja',
      code: 'KAT-001',
      updatedAt,
    },
  })

  // The current client expects the new scope/product/measurement columns, so
  // these rows deliberately use the actual pre-migration table shape.
  await db.$executeRawUnsafe(
    `INSERT INTO "InstallationScope" (
      "id", "roomId", "name", "sortOrder", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    'legacy-scope',
    room.id,
    'Ściana historyczna',
    3,
    createdAt,
    updatedAt
  )
  await db.$executeRawUnsafe(
    `INSERT INTO "InstallationScopeProduct" (
      "id", "scopeId", "catalogProductId", "productNameSnapshot",
      "productCodeSnapshot", "manufacturerSnapshot", "collectionSnapshot",
      "sortOrder", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'legacy-scope-product',
    'legacy-scope',
    catalogProduct.id,
    'Nazwa ze zlecenia',
    'ZLEC-001',
    'Producent ze zlecenia',
    'Kolekcja ze zlecenia',
    5,
    createdAt,
    updatedAt
  )
  await db.$executeRawUnsafe(
    `INSERT INTO "InstallationMeasurement" (
      "id", "roomId", "scopeId", "elementName", "value", "unit", "source",
      "authorId", "authorContext", "actorUserId", "actorRole", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'legacy-measurement',
    room.id,
    'legacy-scope',
    'Szerokość ściany',
    321.5,
    'CM',
    'EMPLOYEE',
    'legacy-author',
    'HISTORY_IMPORT',
    'legacy-user',
    'ADMIN',
    createdAt,
    updatedAt
  )

  return { catalogProduct, createdAt, scopeCategory, updatedAt }
}

afterAll(() => rmSync(databaseDirectory, { recursive: true, force: true }))

describe('installation order-owned products migration', () => {
  it('upgrades a real legacy migration chain without losing scope product or measurement history', async () => {
    runMigrate(databaseUrl, createLegacyPrismaDirectory())
    let db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    const history = await seedLegacyRecords(db)

    expect(
      await db.$queryRawUnsafe<Array<{ migration_name: string }>>(
        'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name'
      )
    ).toEqual(legacyMigrationNames.map((migration_name) => ({ migration_name })))
    await db.$disconnect()

    runMigrate(databaseUrl)
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

    const [scopeCount, scopeProductCount, measurementCount, scopes, scopeProducts, measurements, migrations] =
      await Promise.all([
        db.installationScope.count(),
        db.installationScopeProduct.count(),
        db.installationMeasurement.count(),
        db.installationScope.findMany({
          select: {
            id: true,
            roomId: true,
            name: true,
            sortOrder: true,
            createdAt: true,
            updatedAt: true,
            catalogCategoryId: true,
          },
          orderBy: { id: 'asc' },
        }),
        db.installationScopeProduct.findMany({ orderBy: { id: 'asc' } }),
        db.installationMeasurement.findMany({ orderBy: { id: 'asc' } }),
        db.$queryRawUnsafe<Array<{ migration_name: string }>>(
          'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name'
        ),
      ])

    expect({ scopeCount, scopeProductCount, measurementCount }).toEqual({
      scopeCount: 1,
      scopeProductCount: 1,
      measurementCount: 1,
    })
    expect(scopes).toEqual([
      {
        id: 'legacy-scope',
        roomId: 'legacy-room',
        name: 'Ściana historyczna',
        sortOrder: 3,
        createdAt: history.createdAt,
        updatedAt: history.updatedAt,
        catalogCategoryId: null,
      },
    ])
    expect(
      scopeProducts.map((product) => ({
        id: product.id,
        scopeId: product.scopeId,
        catalogProductId: product.catalogProductId,
        productNameSnapshot: product.productNameSnapshot,
        productCodeSnapshot: product.productCodeSnapshot,
        manufacturerSnapshot: product.manufacturerSnapshot,
        collectionSnapshot: product.collectionSnapshot,
        batchSnapshot: product.batchSnapshot,
        sortOrder: product.sortOrder,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      }))
    ).toEqual([
      {
        id: 'legacy-scope-product',
        scopeId: 'legacy-scope',
        catalogProductId: history.catalogProduct.id,
        productNameSnapshot: 'Nazwa ze zlecenia',
        productCodeSnapshot: 'ZLEC-001',
        manufacturerSnapshot: 'Producent ze zlecenia',
        collectionSnapshot: 'Kolekcja ze zlecenia',
        batchSnapshot: null,
        sortOrder: 5,
        createdAt: history.createdAt.toISOString(),
        updatedAt: history.updatedAt.toISOString(),
      },
    ])
    expect(
      measurements.map((measurement) => ({
        id: measurement.id,
        roomId: measurement.roomId,
        scopeId: measurement.scopeId,
        elementName: measurement.elementName,
        kind: measurement.kind,
        value: measurement.value.toString(),
        secondaryValue: measurement.secondaryValue,
        unit: measurement.unit,
        source: measurement.source,
        authorId: measurement.authorId,
        authorContext: measurement.authorContext,
        actorUserId: measurement.actorUserId,
        actorRole: measurement.actorRole,
        createdAt: measurement.createdAt.toISOString(),
        updatedAt: measurement.updatedAt.toISOString(),
      }))
    ).toEqual([
      {
        id: 'legacy-measurement',
        roomId: 'legacy-room',
        scopeId: 'legacy-scope',
        elementName: 'Szerokość ściany',
        kind: 'SINGLE',
        value: '321.5',
        secondaryValue: null,
        unit: 'CM',
        source: 'EMPLOYEE',
        authorId: 'legacy-author',
        authorContext: 'HISTORY_IMPORT',
        actorUserId: 'legacy-user',
        actorRole: 'ADMIN',
        createdAt: history.createdAt.toISOString(),
        updatedAt: history.updatedAt.toISOString(),
      },
    ])
    expect(migrations.map((migration) => migration.migration_name)).toEqual(
      completeMigrationNames
    )
    expect(migrations.map((migration) => migration.migration_name)).toContain(
      orderProductsMigration
    )

    await db.installationScope.update({
      where: { id: 'legacy-scope' },
      data: { catalogCategoryId: history.scopeCategory.id },
    })
    await db.installationScopeProduct.create({
      data: {
        id: 'order-owned-scope-product',
        scopeId: 'legacy-scope',
        batchSnapshot: 'PARTIA-24',
      },
    })
    await db.installationCatalogCategory.delete({
      where: { id: history.scopeCategory.id },
    })

    const [scopeAfterCategoryDelete, orderOwnedProduct, scopeIndexes, scopeProductIndexes, measurementIndexes, foreignKeys, integrity] =
      await Promise.all([
        db.installationScope.findUniqueOrThrow({
          where: { id: 'legacy-scope' },
          select: { catalogCategoryId: true },
        }),
        db.installationScopeProduct.findUniqueOrThrow({
          where: { id: 'order-owned-scope-product' },
          select: {
            catalogProductId: true,
            productNameSnapshot: true,
            batchSnapshot: true,
          },
        }),
        db.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'InstallationScope' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"
        ),
        db.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'InstallationScopeProduct' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"
        ),
        db.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'InstallationMeasurement' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"
        ),
        db.$queryRawUnsafe('PRAGMA foreign_key_check'),
        db.$queryRawUnsafe<Array<{ integrity_check: string }>>(
          'PRAGMA integrity_check'
        ),
      ])

    expect(scopeAfterCategoryDelete).toEqual({ catalogCategoryId: null })
    expect(orderOwnedProduct).toEqual({
      catalogProductId: null,
      productNameSnapshot: null,
      batchSnapshot: 'PARTIA-24',
    })
    expect(scopeIndexes).toEqual([
      { name: 'InstallationScope_catalogCategoryId_idx' },
      { name: 'InstallationScope_roomId_sortOrder_idx' },
    ])
    expect(scopeProductIndexes).toEqual([
      { name: 'InstallationScopeProduct_catalogProductId_idx' },
      { name: 'InstallationScopeProduct_scopeId_sortOrder_idx' },
    ])
    expect(measurementIndexes).toEqual([
      { name: 'InstallationMeasurement_actorUserId_createdAt_idx' },
      { name: 'InstallationMeasurement_roomId_createdAt_idx' },
      { name: 'InstallationMeasurement_scopeId_createdAt_idx' },
    ])
    expect(foreignKeys).toEqual([])
    expect(integrity).toEqual([{ integrity_check: 'ok' }])

    await db.$disconnect()
  })
})
