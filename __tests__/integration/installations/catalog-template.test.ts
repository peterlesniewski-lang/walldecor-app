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
  archiveCatalogProduct,
  createCatalogCategory,
  createCatalogProduct,
  createCatalogType,
  createInstallationFormTemplate,
  createInstallationOrderFormSnapshot,
  createInstallationRoom,
  createInstallationScope,
  createNextInstallationFormTemplateDraft,
  deleteInstallationMeasurement,
  getInstallationOrderRooms,
  InstallationCatalogValidationError,
  listInstallationCatalog,
  publishInstallationFormTemplate,
  reorderCatalogProducts,
  updateCatalogProduct,
  updateInstallationMeasurement,
  updateInstallationRoom,
  updateInstallationScope,
  updateInstallationFormTemplateDraft,
} from '@/lib/installations/catalog-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installations-catalog-'))
const databasePath = path.join(databaseDirectory, 'catalog.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let orderId: string
let catalogProductId: string

function createClient() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } })
}

function applyMigrations(databaseFile: string) {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  const migrationSqlPaths = readdirSync(migrationRoot)
    .sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)
  for (const migrationSqlPath of migrationSqlPaths) {
    const result = spawnSync('sqlite3', ['-bail', databaseFile], {
      cwd: process.cwd(),
      input: readFileSync(migrationSqlPath, 'utf8'),
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

beforeAll(async () => {
  applyMigrations(databasePath)
  db = createClient()
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'CAT', name: 'Katalog montaży' } })
  const [primary, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'catalog.primary@example.test', position: 'Koordynatorka', costCenterId: 'CAT', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'catalog.backup@example.test', position: 'Koordynator', costCenterId: 'CAT', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
  ])
  const order = await createInstallationOrder(db, {
    client: { name: 'Katalogowy klient', email: 'catalog.client@example.test', phone: '+48 501 555 555' },
    address: { street: 'Dobra', buildingNumber: '1', postalCode: '00-001', city: 'Warszawa' },
    primaryEmployeeId: primary.id,
    backupEmployeeId: backup.id,
  }, 'catalog-admin')
  orderId = order.id
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('installation catalog, templates and room history use real SQLite', () => {
  it('persists a normalized dynamic catalog, reorders it, and excludes archived entries from new selection', async () => {
    const category = await createCatalogCategory(db, { name: '  Tapety  ' })
    const type = await createCatalogType(db, { categoryId: category.id, name: '  Winylowe ' })
    const original = await createCatalogProduct(db, {
      typeId: type.id,
      name: 'Misty Grey', manufacturer: 'WallDecor', collection: 'Misty', code: 'MG-01',
    })
    const second = await createCatalogProduct(db, { typeId: type.id, name: 'Ciepły len' })
    catalogProductId = original.id

    await expect(createCatalogCategory(db, { name: 'tapety' })).rejects.toBeInstanceOf(InstallationCatalogValidationError)
    await reorderCatalogProducts(db, type.id, [second.id, original.id])
    await updateCatalogProduct(db, original.id, { name: 'Misty Grey po zmianie' })

    const catalogAfterRename = await listInstallationCatalog(db)
    expect(catalogAfterRename).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Tapety',
        types: [expect.objectContaining({
          name: 'Winylowe',
          products: [
            expect.objectContaining({ id: second.id, name: 'Ciepły len', sortOrder: 0 }),
            expect.objectContaining({ id: original.id, name: 'Misty Grey po zmianie', sortOrder: 1 }),
          ],
        })],
      }),
    ]))

    await archiveCatalogProduct(db, original.id)
    const offeredForNewScope = await listInstallationCatalog(db)
    expect(offeredForNewScope[0].types[0].products.map((product) => product.id)).toEqual([second.id])
    const auditCatalog = await listInstallationCatalog(db, { includeInactive: true })
    expect(auditCatalog[0].types[0].products.find((product) => product.id === original.id)).toMatchObject({ isActive: false })
  })

  it('publishes immutable template v1 snapshots and starts v2 as a separate draft', async () => {
    const draft = await createInstallationFormTemplate(db, {
      name: 'Wywiad o glifach',
      actorId: 'catalog-admin',
      questions: [
        { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', help: 'Nie wiem jest poprawną odpowiedzią.' },
        { key: 'glify-cm', type: 'DIMENSION', label: 'Ile cm?', condition: { questionKey: 'glify', equals: 'YES' } },
      ],
    })
    const publishedV1 = await publishInstallationFormTemplate(db, draft.id, 'catalog-admin')
    const snapshot = await createInstallationOrderFormSnapshot(db, { orderId, templateId: publishedV1.id }, 'catalog-admin')

    const draftV2 = await createNextInstallationFormTemplateDraft(db, publishedV1.id, 'catalog-admin')
    await updateInstallationFormTemplateDraft(db, draftV2.id, {
      name: 'Wywiad o glifach v2',
      questions: [
        { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify w wersji 2?' },
        { key: 'glify-cm', type: 'DIMENSION', label: 'Ile cm?', condition: { questionKey: 'glify', equals: 'YES' } },
      ],
    }, 'catalog-manager')
    const publishedV2 = await publishInstallationFormTemplate(db, draftV2.id, 'catalog-manager')

    expect(publishedV1).toMatchObject({ version: 1, status: 'PUBLISHED' })
    expect(publishedV2).toMatchObject({ version: 2, status: 'PUBLISHED', familyId: publishedV1.familyId })
    expect(JSON.parse(snapshot.schemaJson)).toMatchObject({ version: 1, questions: expect.arrayContaining([expect.objectContaining({ label: 'Czy są glify?' })]) })
    const snapshotAfterV2 = await db.installationOrderFormSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })
    expect(snapshotAfterV2).toMatchObject({ templateId: publishedV1.id, templateVersion: 1, schemaJson: snapshot.schemaJson })
  })

  it('keeps catalog-product snapshots in scopes and audits every measurement mutation', async () => {
    const room = await createInstallationRoom(db, orderId, { name: 'Salon' }, 'catalog-admin')
    const renamedRoom = await updateInstallationRoom(db, room.id, { name: 'Salon z glifem' }, 'catalog-manager')
    const scope = await createInstallationScope(db, room.id, { name: 'Ściana telewizyjna' }, 'catalog-manager')
    const renamedScope = await updateInstallationScope(db, scope.id, { name: 'Ściana TV z glifem' }, 'catalog-manager')
    await expect(addInstallationScopeProduct(db, renamedScope.id, { catalogProductId }, 'catalog-manager')).rejects.toBeInstanceOf(InstallationCatalogValidationError)

    const activeCategory = await createCatalogCategory(db, { name: 'Sztukateria' })
    const activeType = await createCatalogType(db, { categoryId: activeCategory.id, name: 'Profil' })
    const activeProduct = await createCatalogProduct(db, { typeId: activeType.id, name: 'Profil P-10', code: 'P-10', manufacturer: 'WallDecor' })
    const scopeProduct = await addInstallationScopeProduct(db, renamedScope.id, { catalogProductId: activeProduct.id }, 'catalog-manager')
    await updateCatalogProduct(db, activeProduct.id, { name: 'Profil P-10 po zmianie', code: 'P-10-NEW' })
    await archiveCatalogProduct(db, activeProduct.id)

    const measurementActor = { userId: 'catalog-manager', role: 'MANAGER' as const, employeeId: null }
    const measurement = await addInstallationMeasurement(db, renamedRoom.id, {
      scopeId: renamedScope.id,
      elementName: 'Szerokość glifu', value: '12.50', unit: 'CM', source: 'EMPLOYEE', authorId: 'catalog-manager', authorContext: 'MANAGER',
    }, measurementActor)
    const correctedMeasurement = await updateInstallationMeasurement(db, measurement.id, { value: '13.25', unit: 'CM' }, measurementActor)
    await deleteInstallationMeasurement(db, correctedMeasurement.id, measurementActor)
    await expect(addInstallationMeasurement(db, renamedRoom.id, {
      elementName: 'Pomiary błędne', value: 12.5, unit: 'CM', source: 'EMPLOYEE', authorId: 'catalog-manager', authorContext: 'MANAGER',
    }, measurementActor)).rejects.toBeInstanceOf(InstallationCatalogValidationError)

    const rooms = await getInstallationOrderRooms(db, orderId)
    expect(renamedRoom.name).toBe('Salon z glifem')
    expect(rooms).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: room.id,
        scopes: [expect.objectContaining({
          id: scope.id,
          scopeProducts: [expect.objectContaining({
            id: scopeProduct.id,
            productNameSnapshot: 'Profil P-10',
            productCodeSnapshot: 'P-10',
            manufacturerSnapshot: 'WallDecor',
          })],
        })],
      }),
    ]))
    expect(await db.installationMeasurement.count({ where: { id: measurement.id } })).toBe(0)
    expect(await db.installationAuditEvent.findMany({ where: { orderId, action: { in: [
      'INSTALLATION_MEASUREMENT_CREATED', 'INSTALLATION_MEASUREMENT_UPDATED', 'INSTALLATION_MEASUREMENT_DELETED',
    ] } } })).toHaveLength(3)
  })
})
