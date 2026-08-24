import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const MIGRATION_PATH =
  'prisma/migrations/20260824230000_installation_order_products/migration.sql'

let tempDir = ''
let prisma: PrismaClient

function splitSqlStatements(sql: string) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

async function executeSql(sql: string) {
  for (const statement of splitSqlStatements(sql)) {
    await prisma.$executeRawUnsafe(statement)
  }
}

async function createPreMigrationFixture() {
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "InstallationCatalogCategory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "nameKey" TEXT NOT NULL UNIQUE,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "archivedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "InstallationCatalogType" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "categoryId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "nameKey" TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "archivedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "InstallationCatalogType_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "InstallationCatalogCategory" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "InstallationCatalogProduct" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "typeId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "nameKey" TEXT NOT NULL,
      "manufacturer" TEXT,
      "collection" TEXT,
      "code" TEXT,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "archivedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "InstallationCatalogProduct_typeId_fkey"
        FOREIGN KEY ("typeId") REFERENCES "InstallationCatalogType" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "InstallationRoom" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "InstallationScope" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "roomId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "InstallationScope_roomId_fkey"
        FOREIGN KEY ("roomId") REFERENCES "InstallationRoom" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "InstallationScopeProduct" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "scopeId" TEXT NOT NULL,
      "catalogProductId" TEXT NOT NULL,
      "productNameSnapshot" TEXT NOT NULL,
      "productCodeSnapshot" TEXT,
      "manufacturerSnapshot" TEXT,
      "collectionSnapshot" TEXT,
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "InstallationScopeProduct_scopeId_fkey"
        FOREIGN KEY ("scopeId") REFERENCES "InstallationScope" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "InstallationScopeProduct_catalogProductId_fkey"
        FOREIGN KEY ("catalogProductId") REFERENCES "InstallationCatalogProduct" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "InstallationMeasurement" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "roomId" TEXT NOT NULL,
      "scopeId" TEXT,
      "elementName" TEXT NOT NULL,
      "value" DECIMAL NOT NULL,
      "unit" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "authorId" TEXT,
      "authorContext" TEXT,
      "actorUserId" TEXT,
      "actorRole" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "InstallationMeasurement_roomId_fkey"
        FOREIGN KEY ("roomId") REFERENCES "InstallationRoom" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "InstallationMeasurement_scopeId_fkey"
        FOREIGN KEY ("scopeId") REFERENCES "InstallationScope" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "InstallationCatalogCategory" ("id", "name", "nameKey", "updatedAt")
    VALUES
      ('scope-category', 'Tapeta', 'tapeta', '2026-08-24T00:00:00.000Z'),
      ('catalog-category', 'Katalog', 'katalog', '2026-08-24T00:00:00.000Z')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "InstallationCatalogType" ("id", "categoryId", "name", "nameKey", "updatedAt")
    VALUES ('catalog-type', 'catalog-category', 'Typ katalogowy', 'typ-katalogowy', '2026-08-24T00:00:00.000Z')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "InstallationCatalogProduct" ("id", "typeId", "name", "nameKey", "updatedAt")
    VALUES ('catalog-product', 'catalog-type', 'Produkt katalogowy', 'produkt-katalogowy', '2026-08-24T00:00:00.000Z')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "InstallationRoom" ("id", "name") VALUES ('room-1', 'Salon')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "InstallationScope" ("id", "roomId", "name", "updatedAt")
    VALUES ('scope-1', 'room-1', 'Ściana A', '2026-08-24T00:00:00.000Z')
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "InstallationScopeProduct" (
      "id", "scopeId", "catalogProductId", "productNameSnapshot",
      "productCodeSnapshot", "manufacturerSnapshot", "collectionSnapshot", "updatedAt"
    ) VALUES (
      'scope-product-legacy', 'scope-1', 'catalog-product', 'Produkt historyczny',
      'HIST-01', 'WallDecor', 'Historia', '2026-08-24T00:00:00.000Z'
    )
  `)
  await prisma.$executeRawUnsafe(`
    INSERT INTO "InstallationMeasurement" (
      "id", "roomId", "scopeId", "elementName", "value", "unit", "source",
      "authorId", "authorContext", "actorUserId", "actorRole", "updatedAt"
    ) VALUES (
      'measurement-legacy', 'room-1', 'scope-1', 'Szerokość', 250.5, 'CM', 'EMPLOYEE',
      'employee-1', 'internal', 'user-1', 'ADMIN', '2026-08-24T00:00:00.000Z'
    )
  `)
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'walldecor-order-products-migration-'))
  prisma = new PrismaClient({
    datasources: {
      db: { url: `file:${join(tempDir, 'migration.db')}` },
    },
  })
  await createPreMigrationFixture()
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('installation order-owned products migration', () => {
  it('preserves historical catalogue products and measurements while enabling order-owned products', async () => {
    const migration = await readFile(MIGRATION_PATH, 'utf8')

    await executeSql(migration)

    const [legacyProduct] = await prisma.$queryRawUnsafe<
      Array<{
        catalogProductId: string | null
        productNameSnapshot: string | null
        productCodeSnapshot: string | null
        manufacturerSnapshot: string | null
        collectionSnapshot: string | null
        batchSnapshot: string | null
      }>
    >(`
      SELECT
        "catalogProductId", "productNameSnapshot", "productCodeSnapshot",
        "manufacturerSnapshot", "collectionSnapshot", "batchSnapshot"
      FROM "InstallationScopeProduct"
      WHERE "id" = 'scope-product-legacy'
    `)
    const [legacyMeasurement] = await prisma.$queryRawUnsafe<
      Array<{ kind: string; secondaryValue: number | null; actorUserId: string | null }>
    >(`
      SELECT "kind", "secondaryValue", "actorUserId"
      FROM "InstallationMeasurement"
      WHERE "id" = 'measurement-legacy'
    `)

    expect(legacyProduct).toEqual({
      catalogProductId: 'catalog-product',
      productNameSnapshot: 'Produkt historyczny',
      productCodeSnapshot: 'HIST-01',
      manufacturerSnapshot: 'WallDecor',
      collectionSnapshot: 'Historia',
      batchSnapshot: null,
    })
    expect(legacyMeasurement).toEqual({
      kind: 'SINGLE',
      secondaryValue: null,
      actorUserId: 'user-1',
    })

    await prisma.$executeRawUnsafe(`
      UPDATE "InstallationScope"
      SET "catalogCategoryId" = 'scope-category'
      WHERE "id" = 'scope-1'
    `)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "InstallationScopeProduct" (
        "id", "scopeId", "catalogProductId", "productNameSnapshot", "batchSnapshot", "updatedAt"
      ) VALUES (
        'scope-product-order-owned', 'scope-1', NULL, NULL, 'PARTIA-24', '2026-08-24T00:00:00.000Z'
      )
    `)
    await prisma.$executeRawUnsafe(
      'DELETE FROM "InstallationCatalogCategory" WHERE "id" = \'scope-category\''
    )

    const [scope] = await prisma.$queryRawUnsafe<
      Array<{ catalogCategoryId: string | null }>
    >('SELECT "catalogCategoryId" FROM "InstallationScope" WHERE "id" = \'scope-1\'')
    const [orderOwnedProduct] = await prisma.$queryRawUnsafe<
      Array<{
        catalogProductId: string | null
        productNameSnapshot: string | null
        batchSnapshot: string | null
      }>
    >(`
      SELECT "catalogProductId", "productNameSnapshot", "batchSnapshot"
      FROM "InstallationScopeProduct"
      WHERE "id" = 'scope-product-order-owned'
    `)
    const integrity = await prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>(
      'PRAGMA integrity_check'
    )
    const foreignKeyViolations = await prisma.$queryRawUnsafe<Array<unknown>>(
      'PRAGMA foreign_key_check'
    )
    const scopeIndexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'SELECT "name" FROM sqlite_master WHERE "type" = \'index\' AND "name" = \'InstallationScope_catalogCategoryId_idx\''
    )

    expect(scope).toEqual({ catalogCategoryId: null })
    expect(orderOwnedProduct).toEqual({
      catalogProductId: null,
      productNameSnapshot: null,
      batchSnapshot: 'PARTIA-24',
    })
    expect(integrity).toEqual([{ integrity_check: 'ok' }])
    expect(foreignKeyViolations).toEqual([])
    expect(scopeIndexes).toEqual([
      { name: 'InstallationScope_catalogCategoryId_idx' },
    ])
  })
})
