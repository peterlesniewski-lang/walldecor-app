import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-hierarchy-upgrade-'))
const databasePath = path.join(databaseDirectory, 'legacy-upgrade.db')
const databaseUrl = `file:${databasePath}`
const freshDatabasePath = path.join(databaseDirectory, 'fresh-full-chain.db')
const freshDatabaseUrl = `file:${freshDatabasePath}`
const remoteDeleteUpgradeDatabasePath = path.join(databaseDirectory, 'remote-delete-checksum-upgrade.db')
const remoteDeleteUpgradeDatabaseUrl = `file:${remoteDeleteUpgradeDatabasePath}`
const remoteDeleteMigration = '20260823060000_installation_remote_delete_lifecycle'
const remoteDeleteMigrationChecksum = '4c6a561d580d306a10773121e9c5e610fe3428a8bb8699ee6132aa8738248f1e'

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

function createRemoteDeleteChecksumPrismaDirectory() {
  const root = path.join(databaseDirectory, 'remote-delete-checksum-prisma')
  const migrations = path.join(root, 'migrations')
  mkdirSync(migrations, { recursive: true })
  cpSync(path.join(workspace, 'prisma', 'schema.prisma'), path.join(root, 'schema.prisma'))
  cpSync(path.join(workspace, 'prisma', 'migrations', 'migration_lock.toml'), path.join(migrations, 'migration_lock.toml'))
  for (const migration of readdirSync(path.join(workspace, 'prisma', 'migrations')).sort().filter((name) => name <= remoteDeleteMigration)) {
    const source = path.join(workspace, 'prisma', 'migrations', migration)
    if (existsSync(path.join(source, 'migration.sql'))) cpSync(source, path.join(migrations, migration), { recursive: true })
  }

  const migrationPath = path.join(migrations, remoteDeleteMigration, 'migration.sql')
  const historicalSql = readFileSync(migrationPath, 'utf8').replace(
    /\n-- Initial visibility revocation[\s\S]*?END;\n\nDROP TRIGGER "InstallationFileAuditEvent_insert_guard";/,
    '\nDROP TRIGGER "InstallationFileAuditEvent_insert_guard";',
  )
  const historicalChecksum = createHash('sha256').update(historicalSql).digest('hex')
  if (historicalChecksum !== remoteDeleteMigrationChecksum) throw new Error(`Historical Task 5 migration fixture drifted: ${historicalChecksum}`)
  writeFileSync(migrationPath, historicalSql)
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
  // This database intentionally stops at migration 20. Do not use the
  // current Prisma InstallationOrder model: Task 4 adds columns which the
  // historic schema legitimately does not have yet.
  const order = { id: 'legacy-upgrade-order' }
  const client = await db.installationClient.create({ data: { name: 'Legacy history', email: 'legacy.history@example.test', phone: '+48 501 000 001' } })
  await db.$executeRaw`
    INSERT INTO "InstallationOrder" (
      "id", "number", "status", "clientId", "addressStreet", "addressBuildingNumber",
      "addressPostalCode", "addressCity", "primaryEmployeeId", "backupEmployeeId", "updatedAt"
    ) VALUES (
      ${order.id}, 'MON-LEGACY-UPGRADE', 'DRAFT', ${client.id}, 'Dobra', '1',
      '00-001', 'Warszawa', ${primary.id}, ${backup.id}, ${legacyUpdatedAt}
    )
  `
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

  it('upgrades a database carrying the original 60000 checksum through an additive soft-delete guard migration', async () => {
    runMigrate(remoteDeleteUpgradeDatabaseUrl, createRemoteDeleteChecksumPrismaDirectory())
    let db = new PrismaClient({ datasources: { db: { url: remoteDeleteUpgradeDatabaseUrl } } })
    const historicalMigration = await db.$queryRawUnsafe<Array<{ checksum: string }>>(
      'SELECT checksum FROM _prisma_migrations WHERE migration_name = ?', remoteDeleteMigration,
    )
    expect(historicalMigration).toEqual([{ checksum: remoteDeleteMigrationChecksum }])

    await db.costCenter.create({ data: { id: 'RDU', name: 'Remote delete upgrade' } })
    const [primary, backup] = await Promise.all([
      db.employee.create({ data: { id: 'remote-delete-upgrade-primary', firstName: 'Anna', lastName: 'Upgrade', email: 'remote-delete-upgrade-primary@example.test', position: 'Koordynatorka', costCenterId: 'RDU', startDate: new Date('2026-01-01'), active: true } }),
      db.employee.create({ data: { id: 'remote-delete-upgrade-backup', firstName: 'Bartek', lastName: 'Upgrade', email: 'remote-delete-upgrade-backup@example.test', position: 'Koordynator', costCenterId: 'RDU', startDate: new Date('2026-01-01'), active: true } }),
    ])
    const client = await db.installationClient.create({ data: { id: 'remote-delete-upgrade-client', name: 'Klient upgrade', email: 'remote-delete-upgrade-client@example.test', phone: '+48 500 700 800' } })
    const order = await db.installationOrder.create({ data: {
      id: 'remote-delete-upgrade-order', number: 'RDU-001', clientId: client.id,
      addressStreet: 'Migracyjna', addressBuildingNumber: '7', addressPostalCode: '00-007', addressCity: 'Warszawa',
      primaryEmployeeId: primary.id, backupEmployeeId: backup.id,
    } })
    const file = await db.installationFile.create({ data: {
      id: 'remote-delete-upgrade-file', orderId: order.id, purpose: 'INTERNAL_PROJECT', originalFilename: 'upgrade.pdf',
      contentType: 'application/pdf', status: 'PENDING', source: 'INTERNAL', createdById: primary.id,
    } })
    await db.installationFile.update({ where: { id: file.id }, data: { status: 'READY', byteSize: 4, sha256: 'a'.repeat(64) } })
    await db.$executeRawUnsafe(
      'INSERT INTO "InstallationClientLink" ("id", "orderId", "tokenHash", "expiresAt", "createdById", "createdAt") VALUES (?, ?, ?, ?, ?, ?)',
      'remote-delete-upgrade-client-link', order.id, 'b'.repeat(64), new Date('2027-01-01T00:00:00.000Z'), primary.id, new Date('2026-08-23T07:00:00.000Z'),
    )
    await db.$disconnect()

    runMigrate(remoteDeleteUpgradeDatabaseUrl)
    runMigrate(remoteDeleteUpgradeDatabaseUrl)
    db = new PrismaClient({ datasources: { db: { url: remoteDeleteUpgradeDatabaseUrl } } })
    const [migrations, checksum, integrity, migratedClientLink, clientLinkColumns, clientLinkIndexes] = await Promise.all([
      db.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>('SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name'),
      db.$queryRawUnsafe<Array<{ checksum: string }>>('SELECT checksum FROM _prisma_migrations WHERE migration_name = ?', remoteDeleteMigration),
      db.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check'),
      db.$queryRawUnsafe<Array<{ sentAt: null; sentById: null }>>('SELECT "sentAt", "sentById" FROM "InstallationClientLink" WHERE "id"=?', 'remote-delete-upgrade-client-link'),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM pragma_table_info('InstallationClientLink') WHERE name IN ('sentAt', 'sentById') ORDER BY cid"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='index' AND name='InstallationClientLink_orderId_sentAt_idx'"),
    ])
    expect(migrations).toHaveLength(34)
    expect(migrations.every((migration) => migration.finished_at !== null && migration.rolled_back_at === null)).toBe(true)
    expect(migrations.at(-1)).toMatchObject({ migration_name: '20260823080000_installation_client_link_sent', finished_at: expect.anything(), rolled_back_at: null })
    expect(checksum).toEqual([{ checksum: remoteDeleteMigrationChecksum }])
    expect(migratedClientLink).toEqual([{ sentAt: null, sentById: null }])
    expect(clientLinkColumns).toEqual([{ name: 'sentAt' }, { name: 'sentById' }])
    expect(clientLinkIndexes).toEqual([{ name: 'InstallationClientLink_orderId_sentAt_idx' }])
    await expect(db.$executeRawUnsafe(
      'UPDATE "InstallationFile" SET "softDeletedAt"=?, "softDeletedById"=? WHERE "id"=?',
      new Date(), primary.id, file.id,
    )).rejects.toBeTruthy()
    await expect(db.installationFile.findUniqueOrThrow({ where: { id: file.id } })).resolves.toMatchObject({ softDeletedAt: null, remoteDeleteStatus: 'NOT_REQUESTED' })
    expect(integrity).toEqual([{ integrity_check: 'ok' }])
    await db.$disconnect()
  })

  it('applies the complete fresh chain, including client-form and governance migrations, with healthy SQLite integrity', async () => {
    runMigrate(freshDatabaseUrl)
    const db = new PrismaClient({ datasources: { db: { url: freshDatabaseUrl } } })
    const [migrations, triggers, clientFormTriggers, submittedRevisionTriggers, governanceTriggers, cleanupColumns, cleanupTriggers, clientLinkColumns, clientLinkIndexes, foreignKeys, integrity] = await Promise.all([
      db.$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM _prisma_migrations ORDER BY migration_name'),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'InstallationCatalog%' ORDER BY name"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'InstallationAnswer_submitted_%' ORDER BY name"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'InstallationFormSubmission_submitted_%' ORDER BY name"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'InstallationOrder_visitFeePolicy_%' OR name LIKE 'InstallationOrder_accepted_fee_%' OR name LIKE 'InstallationOrder_billed_fee_%' OR name LIKE 'InstallationMismatch_task5_%' OR name LIKE 'InstallationMismatch_private_%' OR name LIKE 'InstallationMismatch_billed_%' OR name LIKE 'InstallationVisitFeePolicy_referenced_%' OR name LIKE 'InstallationVisitFeePolicy_historic_%' OR name LIKE 'InstallationBillingTask_mismatch_%') ORDER BY name"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM pragma_table_info('InstallationFile') WHERE name LIKE 'remoteDelete%' ORDER BY cid"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (name LIKE 'InstallationFile_remote_delete_%' OR name = 'InstallationFile_soft_delete_remote_state_guard') ORDER BY name"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM pragma_table_info('InstallationClientLink') WHERE name IN ('sentAt', 'sentById') ORDER BY cid"),
      db.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='index' AND name='InstallationClientLink_orderId_sentAt_idx'"),
      db.$queryRawUnsafe('PRAGMA foreign_key_check'), db.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check'),
    ])
    expect(migrations).toHaveLength(34)
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260822030000_installation_client_form')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260822030100_installation_submitted_answer_insert_guard')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260822030200_installation_submitted_revision_guard')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260822040000_installation_governance')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260823010000_installation_mismatch_verified_evidence')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260823020000_installation_governance_durability')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260823030000_installation_fee_acceptance_integrity')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260823040000_installation_private_media')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260823050000_mobile_handoff_retry_release')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260823060000_installation_remote_delete_lifecycle')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260823070000_installation_soft_delete_remote_guard')
    expect(migrations.map((migration) => migration.migration_name)).toContain('20260823080000_installation_client_link_sent')
    expect(migrations.at(-1)).toMatchObject({ migration_name: '20260823080000_installation_client_link_sent' })
    expect(triggers).toHaveLength(6)
    expect(clientFormTriggers).toEqual([
      { name: 'InstallationAnswer_submitted_delete_guard' },
      { name: 'InstallationAnswer_submitted_insert_guard' },
      { name: 'InstallationAnswer_submitted_update_guard' },
    ])
    expect(submittedRevisionTriggers).toEqual([
      { name: 'InstallationFormSubmission_submitted_delete_guard' },
      { name: 'InstallationFormSubmission_submitted_update_guard' },
    ])
    expect(governanceTriggers).toEqual([
      { name: 'InstallationBillingTask_mismatch_approval_guard' },
      { name: 'InstallationBillingTask_mismatch_approval_update_guard' },
      { name: 'InstallationBillingTask_mismatch_future_legal_insert_guard' },
      { name: 'InstallationBillingTask_mismatch_future_legal_update_guard' },
      { name: 'InstallationMismatch_billed_evidence_immutability_guard' },
      { name: 'InstallationMismatch_private_evidence_insert_guard' },
      { name: 'InstallationMismatch_private_evidence_update_guard' },
      { name: 'InstallationOrder_accepted_fee_snapshot_update_guard' },
      { name: 'InstallationOrder_billed_fee_snapshot_immutability_guard' },
      { name: 'InstallationOrder_visitFeePolicy_insert_guard' },
      { name: 'InstallationOrder_visitFeePolicy_update_guard' },
      { name: 'InstallationVisitFeePolicy_historic_snapshot_update_guard' },
      { name: 'InstallationVisitFeePolicy_referenced_delete_guard' },
      { name: 'InstallationVisitFeePolicy_referenced_id_update_guard' },
    ])
    expect(cleanupColumns.map((column) => column.name)).toEqual([
      'remoteDeleteStatus', 'remoteDeleteAttemptCount', 'remoteDeleteLastError', 'remoteDeleteNextAttemptAt', 'remoteDeletedAt',
    ])
    expect(cleanupTriggers).toEqual([
      { name: 'InstallationFile_remote_delete_insert_guard' },
      { name: 'InstallationFile_remote_delete_update_guard' },
      { name: 'InstallationFile_soft_delete_remote_state_guard' },
    ])
    expect(clientLinkColumns).toEqual([{ name: 'sentAt' }, { name: 'sentById' }])
    expect(clientLinkIndexes).toEqual([{ name: 'InstallationClientLink_orderId_sentAt_idx' }])
    expect(foreignKeys).toEqual([])
    expect(integrity[0]?.integrity_check).toBe('ok')
    await db.$disconnect()
  })
})
