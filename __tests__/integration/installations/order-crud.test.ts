import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import {
  archiveInstallationOrder,
  createInstallationOrder,
  getInstallationOrder,
  listInstallationOrders,
  updateInstallationOrder,
} from '@/lib/installations/order-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installations-'))
const databasePath = path.join(databaseDirectory, 'installations.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let primaryEmployeeId: string
let backupEmployeeId: string
let installerEmployeeId: string
let inactiveEmployeeId: string

function createClient() {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } })
}

async function seedEmployees() {
  await db.costCenter.create({ data: { id: 'JAG', name: 'Janki' } })
  await db.user.create({
    data: {
      username: 'installation-admin',
      name: 'Administrator montaży',
      email: 'installation-admin@example.test',
      role: 'ADMIN',
      passwordHash: 'test-only-hash',
    },
  })
  const employees = await Promise.all([
    db.employee.create({
      data: {
        firstName: 'Dawid', lastName: 'Instalator', email: 'dawid.instalator@example.pl',
        position: 'Instalator', costCenterId: 'JAG', startDate: new Date('2025-01-01T12:00:00.000Z'), active: true,
      },
    }),
    db.employee.create({
      data: {
        firstName: 'Anna', lastName: 'Opiekun', email: 'anna.opiekun@example.pl',
        position: 'Koordynatorka', costCenterId: 'JAG', startDate: new Date('2025-01-01T12:00:00.000Z'), active: true,
      },
    }),
    db.employee.create({
      data: {
        firstName: 'Bartek', lastName: 'Zastępca', email: 'bartek.zastepca@example.pl',
        position: 'Koordynator', costCenterId: 'JAG', startDate: new Date('2025-01-01T12:00:00.000Z'), active: true,
      },
    }),
    db.employee.create({
      data: {
        firstName: 'Celina', lastName: 'Nieaktywna', email: 'celina.nieaktywna@example.pl',
        position: 'Koordynatorka', costCenterId: 'JAG', startDate: new Date('2025-01-01T12:00:00.000Z'), active: false,
      },
    }),
  ])
  primaryEmployeeId = employees[0].id
  backupEmployeeId = employees[1].id
  installerEmployeeId = employees[2].id
  inactiveEmployeeId = employees[3].id
}

function committedMigrationSqlPaths() {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  return readdirSync(migrationRoot)
    .sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)
}

function applyMigrations(databaseFile: string, migrationSqlPaths = committedMigrationSqlPaths()) {
  for (const migrationSqlPath of migrationSqlPaths) {
    const result = spawnSync('sqlite3', ['-bail', databaseFile], {
      cwd: process.cwd(),
      input: readFileSync(migrationSqlPath, 'utf8'),
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(`Nie udało się zastosować migracji ${migrationSqlPath}: ${result.stderr || result.stdout}`)
    }
  }
}

beforeAll(async () => {
  applyMigrations(databasePath)
  db = createClient()
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await seedEmployees()
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('installation order CRUD persists in a real SQLite database', () => {
  it('creates, lists, reads, updates, archives, and survives a Prisma restart', async () => {
    const created = await createInstallationOrder(db, {
      client: { name: 'Jan Kowalski', email: 'jan.kowalski@example.pl', phone: '+48 501 234 567' },
      address: { street: 'Puławska', buildingNumber: '17', postalCode: '02-515', city: 'Warszawa' },
      primaryEmployeeId,
      backupEmployeeId,
    }, 'admin-user')

    expect(created.number).toMatch(/^MON-\d{8}-\d{4}$/)
    expect((await listInstallationOrders(db)).map((order) => order.id)).toEqual([created.id])
    expect((await getInstallationOrder(db, created.id))?.client.name).toBe('Jan Kowalski')
    expect(created.auditEvents).toHaveLength(1)
    expect(created.auditEvents[0]).toMatchObject({ actorId: 'admin-user', action: 'INSTALLATION_ORDER_CREATED' })

    const updated = await updateInstallationOrder(db, created.id, {
      client: { name: 'Jan Kowalski', email: 'jan.kowalski@example.pl', phone: '+48 511 000 111' },
      address: { street: 'Puławska', buildingNumber: '17A', postalCode: '02-515', city: 'Warszawa' },
      primaryEmployeeId: backupEmployeeId,
      backupEmployeeId: primaryEmployeeId,
    }, 'manager-user')

    expect(updated.client.phone).toBe('+48 511 000 111')
    expect(updated.addressBuildingNumber).toBe('17A')
    expect(updated.primaryEmployeeId).toBe(backupEmployeeId)
    expect(updated.auditEvents.map((event) => event.action)).toEqual([
      'INSTALLATION_ORDER_UPDATED',
      'INSTALLATION_ORDER_CREATED',
    ])

    const archived = await archiveInstallationOrder(db, created.id, 'admin-user')
    expect(archived.status).toBe('ARCHIVED')
    expect(archived.archivedAt).toBeInstanceOf(Date)
    expect(await listInstallationOrders(db)).toEqual([])
    expect((await listInstallationOrders(db, { includeArchived: true })).map((order) => order.id)).toEqual([created.id])

    await db.$disconnect()
    db = createClient()
    await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')

    const afterRestart = await getInstallationOrder(db, created.id)
    expect(existsSync(databasePath)).toBe(true)
    expect(afterRestart).toMatchObject({
      id: created.id,
      status: 'ARCHIVED',
      addressBuildingNumber: '17A',
      client: { phone: '+48 511 000 111' },
    })
  })

  it('enforces order and concrete installer assignment unique/FK constraints in SQLite', async () => {
    const created = await createInstallationOrder(db, {
      client: { name: 'Maria Nowak', email: 'maria.nowak@example.pl', phone: '+48 502 345 678' },
      address: { street: 'Domaniewska', buildingNumber: '10', postalCode: '02-672', city: 'Warszawa' },
      primaryEmployeeId,
      backupEmployeeId,
    }, 'admin-user')

    await expect(db.installationOrder.create({
      data: {
        number: created.number,
        clientId: created.clientId,
        addressStreet: 'Domaniewska',
        addressPostalCode: '02-672',
        addressCity: 'Warszawa',
        primaryEmployeeId,
        backupEmployeeId,
      },
    })).rejects.toMatchObject({ code: 'P2002' })

    const clientForOwnerCheck = await db.installationClient.create({
      data: { name: 'Klient CHECK', email: 'check-client@example.pl', phone: '+48 500 000 001' },
    })
    await expect(db.installationOrder.create({
      data: {
        number: 'MON-20260822-9988',
        clientId: clientForOwnerCheck.id,
        addressStreet: 'Domaniewska',
        addressPostalCode: '02-672',
        addressCity: 'Warszawa',
        primaryEmployeeId,
        backupEmployeeId: primaryEmployeeId,
      },
    })).rejects.toThrow(/CHECK constraint failed/)

    const clientForForeignKeyCheck = await db.installationClient.create({
      data: { name: 'Klient FK', email: 'fk-client@example.pl', phone: '+48 500 000 000' },
    })
    await expect(db.installationOrder.create({
      data: {
        number: 'MON-20260822-9999',
        clientId: clientForForeignKeyCheck.id,
        addressStreet: 'Domaniewska',
        addressPostalCode: '02-672',
        addressCity: 'Warszawa',
        primaryEmployeeId: inactiveEmployeeId,
        backupEmployeeId: 'missing-employee',
      },
    })).rejects.toMatchObject({ code: 'P2003' })

    await db.installationOrderInstaller.create({
      data: { orderId: created.id, employeeId: installerEmployeeId, createdById: 'installation-admin' },
    })
    expect((await getInstallationOrder(db, created.id))?.installerAssignments).toEqual([
      { employeeId: installerEmployeeId },
    ])

    await expect(db.installationOrderInstaller.create({
      data: { orderId: created.id, employeeId: installerEmployeeId },
    })).rejects.toMatchObject({ code: 'P2002' })
    await expect(db.installationOrderInstaller.create({
      data: { orderId: created.id, employeeId: 'missing-installer' },
    })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('keeps client data as an isolated snapshot for each order sharing an email address', async () => {
    const sharedEmail = 'shared-client@example.pl'
    const first = await createInstallationOrder(db, {
      client: { name: 'Klient A', email: sharedEmail, phone: '+48 503 111 222' },
      address: { street: 'Kredytowa', buildingNumber: '1', postalCode: '00-056', city: 'Warszawa' },
      primaryEmployeeId,
      backupEmployeeId,
    }, 'admin-user')
    const second = await createInstallationOrder(db, {
      client: { name: 'Klient B', email: sharedEmail, phone: '+48 503 333 444' },
      address: { street: 'Kredytowa', buildingNumber: '2', postalCode: '00-056', city: 'Warszawa' },
      primaryEmployeeId,
      backupEmployeeId,
    }, 'admin-user')

    expect(second.clientId).not.toBe(first.clientId)

    await updateInstallationOrder(db, second.id, {
      client: { name: 'Klient B po edycji', email: sharedEmail, phone: '+48 503 555 666' },
      address: { street: 'Kredytowa', buildingNumber: '22', postalCode: '00-056', city: 'Warszawa' },
    }, 'manager-user')

    const firstAfterSecondEdit = await getInstallationOrder(db, first.id)
    const secondAfterEdit = await getInstallationOrder(db, second.id)
    expect(firstAfterSecondEdit).toMatchObject({
      client: { name: 'Klient A', email: sharedEmail, phone: '+48 503 111 222' },
    })
    expect(firstAfterSecondEdit?.auditEvents.map((event) => event.action)).toEqual([
      'INSTALLATION_ORDER_CREATED',
    ])
    expect(secondAfterEdit).toMatchObject({
      client: { name: 'Klient B po edycji', email: sharedEmail, phone: '+48 503 555 666' },
    })
  })

  it('migrates existing shared clients into order snapshots without losing foreign-key integrity', () => {
    const legacyDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installations-legacy-'))
    const legacyDatabasePath = path.join(legacyDirectory, 'legacy.db')
    const migrationSqlPaths = committedMigrationSqlPaths()
    const correctiveMigrationIndex = migrationSqlPaths.findIndex((migrationPath) =>
      migrationPath.includes('20260822010200_installation_order_client_snapshot_and_owner_check'),
    )
    expect(correctiveMigrationIndex).toBeGreaterThan(0)

    try {
      applyMigrations(legacyDatabasePath, migrationSqlPaths.slice(0, correctiveMigrationIndex))
      const seedResult = spawnSync('sqlite3', ['-bail', legacyDatabasePath], {
        cwd: process.cwd(),
        input: `
          INSERT INTO "CostCenter" ("id", "name") VALUES ('LEGACY', 'Legacy');
          INSERT INTO "Employee" ("id", "firstName", "lastName", "email", "position", "costCenterId", "startDate", "active") VALUES
            ('legacy-primary', 'Primary', 'Legacy', 'legacy-primary@example.pl', 'Koordynator', 'LEGACY', CURRENT_TIMESTAMP, true),
            ('legacy-backup', 'Backup', 'Legacy', 'legacy-backup@example.pl', 'Koordynator', 'LEGACY', CURRENT_TIMESTAMP, true);
          INSERT INTO "InstallationClient" ("id", "name", "email", "phone", "createdAt", "updatedAt")
          VALUES ('legacy-client', 'Klient historyczny', 'shared@example.pl', '+48 500 000 001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
          INSERT INTO "InstallationOrder" ("id", "number", "status", "clientId", "addressStreet", "addressPostalCode", "addressCity", "primaryEmployeeId", "backupEmployeeId", "createdAt", "updatedAt")
          VALUES
            ('legacy-order-a', 'MON-20260822-7001', 'DRAFT', 'legacy-client', 'Marszałkowska', '00-001', 'Warszawa', 'legacy-primary', 'legacy-backup', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
            ('legacy-order-b', 'MON-20260822-7002', 'DRAFT', 'legacy-client', 'Marszałkowska', '00-001', 'Warszawa', 'legacy-primary', 'legacy-backup', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        `,
        encoding: 'utf8',
      })
      expect(seedResult.status, seedResult.stderr || seedResult.stdout).toBe(0)

      applyMigrations(legacyDatabasePath, migrationSqlPaths.slice(correctiveMigrationIndex))
      const readResult = spawnSync('sqlite3', ['-bail', '-separator', '|', legacyDatabasePath, `
        SELECT "id" || '|' || "clientId" FROM "InstallationOrder" ORDER BY "id";
        PRAGMA foreign_key_check;
      `], { cwd: process.cwd(), encoding: 'utf8' })
      expect(readResult.status, readResult.stderr || readResult.stdout).toBe(0)
      expect(readResult.stdout.trim()).toBe([
        'legacy-order-a|legacy-client',
        'legacy-order-b|installation-client-snapshot-legacy-order-b',
      ].join('\n'))
    } finally {
      rmSync(legacyDirectory, { recursive: true, force: true })
    }
  })
})
