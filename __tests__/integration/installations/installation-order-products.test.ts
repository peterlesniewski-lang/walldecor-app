import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { createInstallationOrder } from '@/lib/installations/order-service'
import {
  addInstallationMeasurement,
  addInstallationScopeProduct,
  archiveCatalogCategory,
  createCatalogCategory,
  createCatalogProduct,
  createCatalogType,
  createInstallationFormTemplate,
  createInstallationOrderFormSnapshot,
  createInstallationRoom,
  createInstallationScope,
  InstallationCatalogValidationError,
  publishInstallationFormTemplate,
  updateInstallationMeasurement,
  updateInstallationScopeProduct,
} from '@/lib/installations/catalog-service'
import { createClientLink, loadPublicInstallationProjection } from '@/lib/installations/client-link'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-order-products-'))
const databasePath = path.join(databaseDirectory, 'order-products.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let orderId: string
let primaryEmployeeId: string

function applyMigrations(databaseFile: string) {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationSqlPath of readdirSync(migrationRoot).sort().map((directory) => path.join(migrationRoot, directory, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databaseFile], {
      cwd: process.cwd(), input: readFileSync(migrationSqlPath, 'utf8'), encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

beforeAll(async () => {
  applyMigrations(databasePath)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'ORDER_PRODUCTS', name: 'Produkty zlecenia' } })
  const [primary, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Produkt', email: 'order-products.primary@example.test', position: 'Koordynatorka', costCenterId: 'ORDER_PRODUCTS', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Produkt', email: 'order-products.backup@example.test', position: 'Koordynator', costCenterId: 'ORDER_PRODUCTS', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
  ])
  primaryEmployeeId = primary.id
  const order = await createInstallationOrder(db, {
    client: { name: 'Klient produktów', email: 'order-products.client@example.test', phone: '+48 501 222 333' },
    address: { street: 'Produktowa', buildingNumber: '2', postalCode: '00-002', city: 'Warszawa' },
    primaryEmployeeId: primary.id,
    backupEmployeeId: backup.id,
  }, 'order-products-admin')
  orderId = order.id
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

const employeeActor = () => ({ userId: 'employee-user', role: 'EMPLOYEE' as const, employeeId: primaryEmployeeId })

describe('installation order-owned categories and products', () => {
  it('snapshots an active catalog category on a scope while preserving legacy names and rejecting archived categories', async () => {
    const room = await createInstallationRoom(db, orderId, { name: 'Kategorie zakresów' }, 'order-products-admin')
    const activeCategory = await createCatalogCategory(db, { name: '  Tapety obiektowe  ' })
    const catalogScope = await createInstallationScope(db, room.id, { catalogCategoryId: activeCategory.id }, 'order-products-admin')
    const legacyScope = await createInstallationScope(db, room.id, { name: '  Zakres historyczny  ' }, 'order-products-admin')

    expect(catalogScope).toMatchObject({ catalogCategoryId: activeCategory.id, name: 'Tapety obiektowe' })
    expect(legacyScope).toMatchObject({ catalogCategoryId: null, name: 'Zakres historyczny' })

    await archiveCatalogCategory(db, activeCategory.id)
    await expect(createInstallationScope(db, room.id, { catalogCategoryId: activeCategory.id }, 'order-products-admin'))
      .rejects.toMatchObject({ fieldErrors: { catalogCategoryId: expect.any(String) } })
  })

  it('accepts catalog and order-owned products but does not create an empty order-owned record or audit', async () => {
    const room = await createInstallationRoom(db, orderId, { name: 'Produkty zakresów' }, 'order-products-admin')
    const scope = await createInstallationScope(db, room.id, { name: 'Ściana produktowa' }, 'order-products-admin')
    const category = await createCatalogCategory(db, { name: 'Katalog produktów zlecenia' })
    const type = await createCatalogType(db, { categoryId: category.id, name: 'Tapeta' })
    const catalogProduct = await createCatalogProduct(db, { typeId: type.id, name: 'Katalogowy produkt', code: 'KAT-01', manufacturer: 'WallDecor', collection: 'Kolekcja katalogowa' })

    const catalogOwned = await addInstallationScopeProduct(db, scope.id, { catalogProductId: catalogProduct.id }, 'order-products-admin')
    const orderOwned = await addInstallationScopeProduct(db, scope.id, {
      productNameSnapshot: '  Produkt własny  ', productCodeSnapshot: '  WŁ-01 ', manufacturerSnapshot: '  Producent własny ', collectionSnapshot: '  Kolekcja własna ', batchSnapshot: '  PARTIA-24 ',
    }, 'order-products-admin')
    const auditsBefore = await db.installationAuditEvent.count({ where: { orderId } })
    const productsBefore = await db.installationScopeProduct.count({ where: { scopeId: scope.id } })

    await expect(addInstallationScopeProduct(db, scope.id, {
      productNameSnapshot: ' ', productCodeSnapshot: ' ', manufacturerSnapshot: ' ', collectionSnapshot: ' ', batchSnapshot: ' ',
    }, 'order-products-admin')).resolves.toBeNull()

    expect(catalogOwned).toMatchObject({ catalogProductId: catalogProduct.id, productNameSnapshot: 'Katalogowy produkt', productCodeSnapshot: 'KAT-01' })
    expect(orderOwned).toMatchObject({
      catalogProductId: null, productNameSnapshot: 'Produkt własny', productCodeSnapshot: 'WŁ-01', manufacturerSnapshot: 'Producent własny', collectionSnapshot: 'Kolekcja własna', batchSnapshot: 'PARTIA-24',
    })
    expect(await db.installationScopeProduct.count({ where: { scopeId: scope.id } })).toBe(productsBefore)
    expect(await db.installationAuditEvent.count({ where: { orderId } })).toBe(auditsBefore)
  })

  it('updates snapshot fields atomically, retains the legacy catalog-name invariant, and rejects stale writes', async () => {
    const room = await createInstallationRoom(db, orderId, { name: 'Aktualizacja produktów' }, 'order-products-admin')
    const scope = await createInstallationScope(db, room.id, { name: 'Ściana aktualizowana' }, 'order-products-admin')
    const orderOwned = await addInstallationScopeProduct(db, scope.id, { productCodeSnapshot: 'START-01' }, 'order-products-admin')
    const updated = await updateInstallationScopeProduct(db, orderOwned.id, {
      productNameSnapshot: '  Nazwa po korekcie ', productCodeSnapshot: '  KOR-01 ', manufacturerSnapshot: '', collectionSnapshot: '  Kolekcja ', batchSnapshot: '  BATCH-02 ', updatedAt: orderOwned.updatedAt.toISOString(),
    }, 'order-products-admin')

    expect(updated).toMatchObject({ productNameSnapshot: 'Nazwa po korekcie', productCodeSnapshot: 'KOR-01', manufacturerSnapshot: null, collectionSnapshot: 'Kolekcja', batchSnapshot: 'BATCH-02' })
    const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { orderId, action: 'INSTALLATION_SCOPE_PRODUCT_UPDATED' }, orderBy: { createdAt: 'desc' } })
    expect(JSON.parse(audit.beforeJson!)).toMatchObject({ productCodeSnapshot: 'START-01' })
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ productNameSnapshot: 'Nazwa po korekcie', batchSnapshot: 'BATCH-02' })

    const category = await createCatalogCategory(db, { name: 'Katalog aktualizacji' })
    const type = await createCatalogType(db, { categoryId: category.id, name: 'Typ aktualizacji' })
    const catalogProduct = await createCatalogProduct(db, { typeId: type.id, name: 'Nazwa wymagana przez CHECK' })
    const legacy = await addInstallationScopeProduct(db, scope.id, { catalogProductId: catalogProduct.id }, 'order-products-admin')
    await expect(updateInstallationScopeProduct(db, legacy.id, { productNameSnapshot: '', updatedAt: legacy.updatedAt.toISOString() }, 'order-products-admin'))
      .rejects.toMatchObject({ fieldErrors: { productNameSnapshot: expect.any(String) } })

    await db.installationScopeProduct.update({ where: { id: updated.id }, data: { batchSnapshot: 'BATCH-WYŚCIG', updatedAt: new Date('2026-08-24T12:00:00.000Z') } })
    await expect(updateInstallationScopeProduct(db, updated.id, { batchSnapshot: 'BATCH-PRZETERMINOWANY', updatedAt: updated.updatedAt.toISOString() }, 'order-products-admin'))
      .rejects.toMatchObject({ status: 409, message: 'Karta została zmieniona. Odśwież dane i spróbuj ponownie.' })
  })
})

describe('installation measurements use final-record validation', () => {
  it('persists only valid positive dimensional values and clears a SINGLE secondary value', async () => {
    const room = await createInstallationRoom(db, orderId, { name: 'Pomiary finalne' }, 'order-products-admin')
    const scope = await createInstallationScope(db, room.id, { name: 'Ściana pomiarowa' }, 'order-products-admin')
    const single = await addInstallationMeasurement(db, room.id, {
      scopeId: scope.id, elementName: 'Ilość listew', value: '2.5', secondaryValue: '9', unit: 'SZT',
    }, employeeActor())
    const rectangle = await addInstallationMeasurement(db, room.id, {
      scopeId: scope.id, elementName: 'Wymiar ściany', kind: 'RECTANGLE', value: '250.5', secondaryValue: '120', unit: 'CM',
    }, employeeActor())

    expect(single).toMatchObject({ kind: 'SINGLE', value: expect.objectContaining({ toString: expect.any(Function) }), secondaryValue: null, unit: 'SZT' })
    expect(single.value.toString()).toBe('2.5')
    expect(rectangle).toMatchObject({ kind: 'RECTANGLE', unit: 'CM' })
    expect(rectangle.value.toString()).toBe('250.5')
    expect(rectangle.secondaryValue?.toString()).toBe('120')

    for (const input of [
      { elementName: 'Zero', value: '0', unit: 'CM' },
      { elementName: 'Notacja', value: '1e2', unit: 'CM' },
      { elementName: 'Pole prostokąta', kind: 'RECTANGLE', value: '10', secondaryValue: '10', unit: 'M2' },
      { elementName: 'Brak boku', kind: 'RECTANGLE', value: '10', unit: 'CM' },
    ]) await expect(addInstallationMeasurement(db, room.id, input, employeeActor())).rejects.toBeInstanceOf(InstallationCatalogValidationError)

    await expect(updateInstallationMeasurement(db, single.id, { kind: 'RECTANGLE' }, employeeActor())).rejects.toBeInstanceOf(InstallationCatalogValidationError)
    const rectangular = await updateInstallationMeasurement(db, single.id, { kind: 'RECTANGLE', secondaryValue: '33', unit: 'MM' }, employeeActor())
    const corrected = await updateInstallationMeasurement(db, rectangular.id, { kind: 'SINGLE', unit: 'MB' }, employeeActor())
    expect(corrected).toMatchObject({ kind: 'SINGLE', unit: 'MB', secondaryValue: null })
    const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { orderId, action: 'INSTALLATION_MEASUREMENT_UPDATED' }, orderBy: { createdAt: 'desc' } })
    expect(JSON.parse(audit.afterJson!)).toMatchObject({ kind: 'SINGLE', secondaryValue: null })

    const anotherRoom = await createInstallationRoom(db, orderId, { name: 'Inne pomieszczenie' }, 'order-products-admin')
    const foreignScope = await createInstallationScope(db, anotherRoom.id, { name: 'Obcy zakres' }, 'order-products-admin')
    await expect(updateInstallationMeasurement(db, corrected.id, { scopeId: foreignScope.id }, employeeActor()))
      .rejects.toMatchObject({ fieldErrors: { scopeId: expect.any(String) } })
  })
})

describe('public order product projection', () => {
  it('keeps a string name without exposing order product code or manufacturer as a public fallback', async () => {
    const room = await createInstallationRoom(db, orderId, { name: 'Publiczne produkty' }, 'order-products-admin')
    const scope = await createInstallationScope(db, room.id, { name: 'Produkty publiczne' }, 'order-products-admin')
    await addInstallationScopeProduct(db, scope.id, { productCodeSnapshot: 'KOD-PUBLICZNY' }, 'order-products-admin')
    await addInstallationScopeProduct(db, scope.id, { manufacturerSnapshot: 'Producent publiczny' }, 'order-products-admin')
    await addInstallationScopeProduct(db, scope.id, { batchSnapshot: 'Tylko partia' }, 'order-products-admin')
    const draft = await createInstallationFormTemplate(db, { name: 'Formularz publicznych produktów', actorId: 'order-products-admin', questions: [{ key: 'q', type: 'TEXT', label: 'Pytanie' }] })
    const published = await publishInstallationFormTemplate(db, draft.id, 'order-products-admin')
    await createInstallationOrderFormSnapshot(db, { orderId, templateId: published.id }, 'order-products-admin')
    const { token } = await createClientLink(db, { orderId, createdById: 'order-products-admin', expiresAt: new Date('2030-01-01T00:00:00.000Z') })

    const projection = await loadPublicInstallationProjection(db, token)
    const products = projection.rooms.find((candidate) => candidate.name === 'Publiczne produkty')!.scopes[0].products
    expect(products.map((product) => product.name)).toEqual(['Produkt bez nazwy', 'Produkt bez nazwy', 'Produkt bez nazwy'])
    expect(JSON.stringify(projection)).not.toContain('catalogProductId')
    expect(products[0]).toMatchObject({ name: 'Produkt bez nazwy', code: 'KOD-PUBLICZNY' })
    expect(products[1]).toMatchObject({ name: 'Produkt bez nazwy', manufacturer: 'Producent publiczny' })
  })
})
