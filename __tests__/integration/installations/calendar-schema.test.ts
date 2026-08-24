import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-installation-calendar-schema-'))
const databasePath = path.join(databaseDirectory, 'calendar-schema.db')
const databaseUrl = `file:${databasePath}`

function runMigrate() {
  const result = spawnSync(
    process.execPath,
    [path.join(workspace, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: workspace, env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: 'debug' }, encoding: 'utf8' },
  )

  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
}

afterAll(() => rmSync(databaseDirectory, { recursive: true, force: true }))

describe('installation visit calendar schema', () => {
  it('applies the full migration chain with durable visit, assignment, and outbox tables', async () => {
    runMigrate()
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })

    try {
      const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('InstallationVisit', 'InstallationVisitScope', 'InstallationScopeAssignment', 'IntegrationSyncState', 'IntegrationOutbox', 'IntegrationAttempt') ORDER BY name",
      )

      expect(tables.map(({ name }) => name)).toEqual([
        'InstallationScopeAssignment',
        'InstallationVisit',
        'InstallationVisitScope',
        'IntegrationAttempt',
        'IntegrationOutbox',
        'IntegrationSyncState',
      ])

      const costCenter = await db.costCenter.create({ data: { id: 'CAL', name: 'Calendar tests' } })
      const [coordinator, backup, installer] = await Promise.all([
        db.employee.create({ data: { id: 'calendar-coordinator', firstName: 'Anna', lastName: 'Calendar', email: 'calendar-coordinator@example.test', position: 'Koordynatorka', costCenterId: costCenter.id, startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
        db.employee.create({ data: { id: 'calendar-backup', firstName: 'Bartek', lastName: 'Calendar', email: 'calendar-backup@example.test', position: 'Koordynator', costCenterId: costCenter.id, startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
        db.employee.create({ data: { id: 'calendar-installer', firstName: 'Celina', lastName: 'Calendar', email: 'calendar-installer@example.test', position: 'Montera', costCenterId: costCenter.id, startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
      ])
      const [clientA, clientB] = await Promise.all([
        db.installationClient.create({ data: { id: 'calendar-client-a', name: 'Klient A', email: 'calendar-client-a@example.test', phone: '+48 500 000 001' } }),
        db.installationClient.create({ data: { id: 'calendar-client-b', name: 'Klient B', email: 'calendar-client-b@example.test', phone: '+48 500 000 002' } }),
      ])
      const [orderA, orderB] = await Promise.all([
        db.installationOrder.create({ data: { id: 'calendar-order-a', number: 'CAL-A-001', clientId: clientA.id, addressStreet: 'Kalendarzowa', addressBuildingNumber: '1', addressPostalCode: '00-001', addressCity: 'Warszawa', primaryEmployeeId: coordinator.id, backupEmployeeId: backup.id } }),
        db.installationOrder.create({ data: { id: 'calendar-order-b', number: 'CAL-B-001', clientId: clientB.id, addressStreet: 'Kalendarzowa', addressBuildingNumber: '2', addressPostalCode: '00-002', addressCity: 'Warszawa', primaryEmployeeId: coordinator.id, backupEmployeeId: backup.id } }),
      ])
      const [roomA, roomA2, roomB] = await Promise.all([
        db.installationRoom.create({ data: { id: 'calendar-room-a', orderId: orderA.id, name: 'Pokój A', sortOrder: 0 } }),
        db.installationRoom.create({ data: { id: 'calendar-room-a-2', orderId: orderA.id, name: 'Pokój A2', sortOrder: 1 } }),
        db.installationRoom.create({ data: { id: 'calendar-room-b', orderId: orderB.id, name: 'Pokój B', sortOrder: 0 } }),
      ])
      const [scopeA, scopeB] = await Promise.all([
        db.installationScope.create({ data: { id: 'calendar-scope-a', roomId: roomA.id, name: 'Zakres A', sortOrder: 0 } }),
        db.installationScope.create({ data: { id: 'calendar-scope-b', roomId: roomB.id, name: 'Zakres B', sortOrder: 0 } }),
      ])
      const visit = await db.installationVisit.create({
        data: {
          id: 'calendar-visit-a', orderId: orderA.id, status: 'DRAFT', startsAt: new Date('2026-08-24T09:00:00.000Z'), endsAt: new Date('2026-08-24T10:00:00.000Z'), createdById: coordinator.id,
        },
      })
      const [assignment, visitScope] = await Promise.all([
        db.installationScopeAssignment.create({ data: { id: 'calendar-assignment-a', orderId: orderA.id, scopeId: scopeA.id, employeeId: installer.id, createdById: coordinator.id } }),
        db.installationVisitScope.create({ data: { id: 'calendar-visit-scope-a', visitId: visit.id, orderId: orderA.id, scopeId: scopeA.id } }),
      ])

      expect(assignment).toMatchObject({ orderId: orderA.id, scopeId: scopeA.id, employeeId: installer.id })
      expect(visitScope).toMatchObject({ visitId: visit.id, orderId: orderA.id, scopeId: scopeA.id })
      await expect(db.$executeRawUnsafe(
        'INSERT INTO "InstallationVisit" ("id", "orderId", "status", "startsAt", "endsAt", "timezone", "revision", "createdById", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        'invalid-time-visit', orderA.id, 'DRAFT', '2026-08-24 09:00:00 UTC', '2026-08-24 09:00:00 UTC', 'Europe/Warsaw', 1, coordinator.id, '2026-08-24 08:00:00 UTC', '2026-08-24 08:00:00 UTC',
      )).rejects.toThrow('InstallationVisit_time_insert_guard')
      await expect(db.installationVisit.update({ where: { id: visit.id }, data: { endsAt: visit.startsAt } })).rejects.toBeTruthy()

      await expect(db.installationScopeAssignment.create({
        data: { id: 'calendar-assignment-cross-order', orderId: orderA.id, scopeId: scopeB.id, employeeId: installer.id, createdById: coordinator.id },
      })).rejects.toBeTruthy()
      await expect(db.installationVisitScope.create({
        data: { id: 'calendar-visit-scope-cross-order', visitId: visit.id, orderId: orderA.id, scopeId: scopeB.id },
      })).rejects.toBeTruthy()
      await expect(db.installationScopeAssignment.update({ where: { id: assignment.id }, data: { orderId: orderB.id } })).rejects.toBeTruthy()
      await expect(db.installationVisitScope.update({ where: { id: visitScope.id }, data: { orderId: orderB.id } })).rejects.toBeTruthy()

      await expect(db.installationRoom.update({ where: { id: roomA.id }, data: { orderId: orderA.id } })).resolves.toMatchObject({ orderId: orderA.id })
      await expect(db.installationScope.update({ where: { id: scopeA.id }, data: { roomId: roomA2.id } })).resolves.toMatchObject({ roomId: roomA2.id })
      await expect(db.installationScope.update({ where: { id: scopeA.id }, data: { roomId: roomA.id } })).resolves.toMatchObject({ roomId: roomA.id })
      await expect(db.installationScope.update({ where: { id: scopeA.id }, data: { roomId: roomA.id } })).resolves.toMatchObject({ roomId: roomA.id })
      await expect(db.installationVisit.update({ where: { id: visit.id }, data: { note: 'bezpieczna aktualizacja' } })).resolves.toMatchObject({ note: 'bezpieczna aktualizacja' })
      await expect(db.installationVisit.update({ where: { id: visit.id }, data: { orderId: orderA.id } })).resolves.toMatchObject({ orderId: orderA.id })

      await expect(db.installationRoom.update({ where: { id: roomA.id }, data: { orderId: orderB.id } })).rejects.toBeTruthy()
      await expect(db.installationScope.update({ where: { id: scopeA.id }, data: { roomId: roomB.id } })).rejects.toBeTruthy()
      await expect(db.installationVisit.update({ where: { id: visit.id }, data: { orderId: orderB.id } })).rejects.toBeTruthy()

      const [foreignKeys, integrity] = await Promise.all([
        db.$queryRawUnsafe('PRAGMA foreign_key_check'),
        db.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check'),
      ])
      expect(foreignKeys).toEqual([])
      expect(integrity).toEqual([{ integrity_check: 'ok' }])
    } finally {
      await db.$disconnect()
    }
  })
})
