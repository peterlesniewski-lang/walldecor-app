import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { archiveInstallationOrder, createInstallationOrder } from '@/lib/installations/order-service'
import {
  addInstallationMeasurement,
  addInstallationScopeProduct,
  createInstallationFormTemplate,
  createInstallationOrderFormSnapshot,
  createCatalogCategory,
  createCatalogProduct,
  createCatalogType,
  createInstallationRoom,
  createInstallationScope,
  deleteInstallationMeasurement,
  deleteInstallationRoom,
  deleteInstallationScope,
  deleteInstallationScopeProduct,
  reorderInstallationRooms,
  reorderInstallationScopeProducts,
  reorderInstallationScopes,
  updateInstallationMeasurement,
  updateInstallationRoom,
  updateInstallationScope,
  publishInstallationFormTemplate,
} from '@/lib/installations/catalog-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-task2-corrective-'))
const databasePath = path.join(databaseDirectory, 'task2-corrective.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let primaryEmployeeId: string
let orderId: string

function applyMigrations(databaseFile: string) {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationSqlPath of readdirSync(migrationRoot).sort().map((directory) => path.join(migrationRoot, directory, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databaseFile], { cwd: process.cwd(), input: readFileSync(migrationSqlPath, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

beforeAll(async () => {
  applyMigrations(databasePath)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'T2C', name: 'Korekta Task 2' } })
  const [primary, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Pomiar', email: 'task2.primary@example.test', position: 'Koordynatorka', costCenterId: 'T2C', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Backup', email: 'task2.backup@example.test', position: 'Koordynator', costCenterId: 'T2C', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
  ])
  primaryEmployeeId = primary.id
  const order = await createInstallationOrder(db, {
    client: { name: 'Korekta Task 2', email: 'task2.client@example.test', phone: '+48 501 333 333' },
    address: { street: 'Dobra', buildingNumber: '2', postalCode: '00-001', city: 'Warszawa' },
    primaryEmployeeId: primary.id,
    backupEmployeeId: backup.id,
  }, 'task2-admin')
  orderId = order.id
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('Task 2 corrective service invariants on real SQLite', () => {
  it('derives immutable measurement provenance from the trusted actor instead of spoofed payload fields', async () => {
    const room = await createInstallationRoom(db, orderId, { name: 'Pomiar provenance' }, 'task2-admin')
    const trustedActor = { userId: 'employee-user-1', role: 'EMPLOYEE', employeeId: primaryEmployeeId }
    const measurement = await addInstallationMeasurement(db, room.id, {
      elementName: 'Szerokość glifu', value: '12.50', unit: 'CM',
      source: 'CLIENT', authorId: 'foreign-employee', authorContext: 'CLIENT:spoofed',
    }, trustedActor as never)

    expect(measurement).toMatchObject({
      source: 'EMPLOYEE', authorId: primaryEmployeeId, authorContext: 'EMPLOYEE:employee-user-1',
    })
    expect(measurement as unknown as Record<string, unknown>).toMatchObject({ actorUserId: 'employee-user-1', actorRole: 'EMPLOYEE' })

    const corrected = await updateInstallationMeasurement(db, measurement.id, {
      value: '13.25', source: 'CLIENT', authorId: 'another-foreign-employee', authorContext: 'CLIENT:patched',
    }, trustedActor as never)
    expect(corrected).toMatchObject({
      value: expect.objectContaining({ toString: expect.any(Function) }),
      source: 'EMPLOYEE', authorId: primaryEmployeeId, authorContext: 'EMPLOYEE:employee-user-1',
    })
    expect(corrected.value.toString()).toBe('13.25')
    expect(corrected as unknown as Record<string, unknown>).toMatchObject({ actorUserId: 'employee-user-1', actorRole: 'EMPLOYEE' })

    const adminRoom = await createInstallationRoom(db, orderId, { name: 'Pomiar administratora' }, 'task2-admin')
    const administratorMeasurement = await addInstallationMeasurement(db, adminRoom.id, {
      elementName: 'Wysokość administratora', value: '250', unit: 'CM', source: 'CLIENT', authorId: 'foreign-employee', authorContext: 'CLIENT:spoofed',
    }, { userId: 'admin-user-1', role: 'ADMIN', employeeId: null })
    expect(administratorMeasurement).toMatchObject({ source: 'EMPLOYEE', authorId: null, authorContext: 'ADMIN:admin-user-1' })
    expect(administratorMeasurement as unknown as Record<string, unknown>).toMatchObject({ actorUserId: 'admin-user-1', actorRole: 'ADMIN' })
  })

  it('rejects every room, scope, product and measurement mutation after archive without creating audit history', async () => {
    const category = await createCatalogCategory(db, { name: 'Korekta archiwum' })
    const type = await createCatalogType(db, { categoryId: category.id, name: 'Typ korekty' })
    const catalogProduct = await createCatalogProduct(db, { typeId: type.id, name: 'Produkt korekty' })
    const room = await createInstallationRoom(db, orderId, { name: 'Archiwalny salon' }, 'task2-admin')
    const scope = await createInstallationScope(db, room.id, { name: 'Archiwalna ściana' }, 'task2-admin')
    const scopeProduct = await addInstallationScopeProduct(db, scope.id, { catalogProductId: catalogProduct.id }, 'task2-admin')
    const measurementActor = { userId: 'task2-admin', role: 'ADMIN' as const, employeeId: null }
    const measurement = await addInstallationMeasurement(db, room.id, {
      elementName: 'Wysokość', value: '250', unit: 'CM', source: 'EMPLOYEE', authorId: primaryEmployeeId, authorContext: 'EMPLOYEE:before-archive',
    }, measurementActor)
    const formDraft = await createInstallationFormTemplate(db, {
      name: 'Archiwalny formularz Task 2', actorId: 'task2-admin',
      questions: [{ key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?' }],
    })
    const publishedForm = await publishInstallationFormTemplate(db, formDraft.id, 'task2-admin')
    await archiveInstallationOrder(db, orderId, 'task2-admin')
    const auditsBefore = await db.installationAuditEvent.count({ where: { orderId } })
    const snapshotsBefore = await db.installationOrderFormSnapshot.count({ where: { orderId } })

    const mutations = [
      () => createInstallationRoom(db, orderId, { name: 'Niedozwolony pokój' }, 'task2-admin'),
      () => updateInstallationRoom(db, room.id, { name: 'Niedozwolona zmiana' }, 'task2-admin'),
      () => deleteInstallationRoom(db, room.id, 'task2-admin'),
      () => reorderInstallationRooms(db, orderId, [room.id]),
      () => createInstallationScope(db, room.id, { name: 'Niedozwolony zakres' }, 'task2-admin'),
      () => updateInstallationScope(db, scope.id, { name: 'Niedozwolona zmiana' }, 'task2-admin'),
      () => deleteInstallationScope(db, scope.id, 'task2-admin'),
      () => reorderInstallationScopes(db, room.id, [scope.id]),
      () => addInstallationScopeProduct(db, scope.id, { catalogProductId: catalogProduct.id }, 'task2-admin'),
      () => deleteInstallationScopeProduct(db, scopeProduct.id, 'task2-admin'),
      () => reorderInstallationScopeProducts(db, scope.id, [scopeProduct.id]),
      () => addInstallationMeasurement(db, room.id, { elementName: 'Niedozwolony pomiar', value: '1', unit: 'CM', source: 'EMPLOYEE' }, measurementActor),
      () => updateInstallationMeasurement(db, measurement.id, { value: '251' }, measurementActor),
      () => deleteInstallationMeasurement(db, measurement.id, measurementActor),
      () => createInstallationOrderFormSnapshot(db, { orderId, templateId: publishedForm.id }, 'task2-admin'),
    ]

    for (const mutate of mutations) await expect(mutate()).rejects.toMatchObject({ fieldErrors: expect.objectContaining({ orderId: expect.any(String) }) })

    expect(await db.installationAuditEvent.count({ where: { orderId } })).toBe(auditsBefore)
    expect(await db.installationOrderFormSnapshot.count({ where: { orderId } })).toBe(snapshotsBefore)
    expect(await db.installationRoom.findUniqueOrThrow({ where: { id: room.id } })).toMatchObject({ name: 'Archiwalny salon' })
    expect(await db.installationScope.findUniqueOrThrow({ where: { id: scope.id } })).toMatchObject({ name: 'Archiwalna ściana' })
    expect(await db.installationScopeProduct.findUniqueOrThrow({ where: { id: scopeProduct.id } })).toMatchObject({ scopeId: scope.id })
    expect(await db.installationMeasurement.findUniqueOrThrow({ where: { id: measurement.id } })).toMatchObject({ source: 'EMPLOYEE' })
  })
})
