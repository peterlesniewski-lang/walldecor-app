import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import { canViewInstallationOrder } from '@/lib/installations/access'
import {
  getInstallationOrder,
  createInstallationOrder,
  listInstallationOrders,
} from '@/lib/installations/order-service'
import {
  listScopeInstallerAssignments,
  setScopeInstallerAssignments,
} from '@/lib/installations/scope-assignment-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-scope-assignments-'))
const databasePath = path.join(databaseDirectory, 'scope-assignments.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let orderId: string
let foreignOrderId: string
let wallpaperScopeId: string
let plasterScopeId: string
let foreignScopeId: string
let installerAId: string
let installerBId: string
let installerCId: string
let inactiveInstallerId: string

function applyMigrations(databaseFile: string) {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationSqlPath of readdirSync(migrationRoot).sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databaseFile], {
      cwd: process.cwd(),
      input: readFileSync(migrationSqlPath, 'utf8'),
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

function installerViewer(employeeId: string) {
  return { role: 'INSTALLER' as const, employeeId }
}

beforeAll(async () => {
  applyMigrations(databasePath)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'SCOPE', name: 'Przypisania zakresów' } })

  const [primary, backup, installerA, installerB, installerC, inactiveInstaller] = await Promise.all([
    db.employee.create({ data: { id: 'scope-primary', firstName: 'Anna', lastName: 'Koordynatorka', email: 'scope.primary@example.test', position: 'Koordynatorka', costCenterId: 'SCOPE', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: 'scope-backup', firstName: 'Bartek', lastName: 'Zastępca', email: 'scope.backup@example.test', position: 'Koordynator', costCenterId: 'SCOPE', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: 'installer-a', firstName: 'Celina', lastName: 'Tapety', email: 'installer.a@example.test', position: 'Instalator', costCenterId: 'SCOPE', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: 'installer-b', firstName: 'Damian', lastName: 'Gładzie', email: 'installer.b@example.test', position: 'Instalator', costCenterId: 'SCOPE', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: 'installer-c', firstName: 'Eliza', lastName: 'Sztukateria', email: 'installer.c@example.test', position: 'Instalator', costCenterId: 'SCOPE', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: 'installer-inactive', firstName: 'Filip', lastName: 'Nieaktywny', email: 'installer.inactive@example.test', position: 'Instalator', costCenterId: 'SCOPE', startDate: new Date('2026-01-01T00:00:00.000Z'), active: false } }),
  ])
  installerAId = installerA.id
  installerBId = installerB.id
  installerCId = installerC.id
  inactiveInstallerId = inactiveInstaller.id

  const [order, foreignOrder] = await Promise.all([
    createInstallationOrder(db, {
      client: { name: 'Klient przypisań', email: 'scope.client@example.test', phone: '+48 501 000 001' },
      address: { street: 'Dobra', buildingNumber: '1', postalCode: '00-001', city: 'Warszawa' },
      primaryEmployeeId: primary.id,
      backupEmployeeId: backup.id,
    }, 'scope-actor'),
    createInstallationOrder(db, {
      client: { name: 'Inny klient', email: 'scope.foreign@example.test', phone: '+48 501 000 002' },
      address: { street: 'Zła', buildingNumber: '2', postalCode: '00-002', city: 'Warszawa' },
      primaryEmployeeId: primary.id,
      backupEmployeeId: backup.id,
    }, 'scope-actor'),
  ])
  orderId = order.id
  foreignOrderId = foreignOrder.id

  const [wallpaperRoom, plasterRoom, foreignRoom] = await Promise.all([
    db.installationRoom.create({ data: { id: 'scope-wallpaper-room', orderId, name: 'Salon', sortOrder: 0 } }),
    db.installationRoom.create({ data: { id: 'scope-plaster-room', orderId, name: 'Korytarz', sortOrder: 1 } }),
    db.installationRoom.create({ data: { id: 'scope-foreign-room', orderId: foreignOrderId, name: 'Obcy pokój', sortOrder: 0 } }),
  ])
  const [wallpaperScope, plasterScope, foreignScope] = await Promise.all([
    db.installationScope.create({ data: { id: 'scope-wallpaper', roomId: wallpaperRoom.id, name: 'Tapety', sortOrder: 0 } }),
    db.installationScope.create({ data: { id: 'scope-plaster', roomId: plasterRoom.id, name: 'Gładzie', sortOrder: 0 } }),
    db.installationScope.create({ data: { id: 'scope-foreign', roomId: foreignRoom.id, name: 'Obcy zakres', sortOrder: 0 } }),
  ])
  wallpaperScopeId = wallpaperScope.id
  plasterScopeId = plasterScope.id
  foreignScopeId = foreignScope.id
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('scope installer assignments', () => {
  it('replaces a scope team from normalized active employee IDs and writes an audit event', async () => {
    await setScopeInstallerAssignments(db, orderId, wallpaperScopeId, [installerAId, ` ${installerAId} `, installerAId], 'actor-1')
    await setScopeInstallerAssignments(db, orderId, plasterScopeId, [installerBId, installerCId, installerBId], 'actor-1')

    expect(await listScopeInstallerAssignments(db, orderId)).toEqual([
      { scopeId: wallpaperScopeId, employeeIds: [installerAId] },
      { scopeId: plasterScopeId, employeeIds: [installerBId, installerCId] },
    ])

    const loadedOrder = await getInstallationOrder(db, orderId)
    expect(loadedOrder).not.toBeNull()
    expect(canViewInstallationOrder(installerViewer(installerAId), loadedOrder!)).toBe(true)
    expect(await listInstallationOrders(db, { viewer: installerViewer(installerAId) }))
      .toEqual([expect.objectContaining({ id: orderId })])

    const audits = await db.installationAuditEvent.findMany({
      where: { orderId, action: 'INSTALLATION_SCOPE_ASSIGNMENTS_CHANGED' },
      orderBy: { createdAt: 'asc' },
    })
    expect(audits).toHaveLength(2)
    expect(JSON.parse(audits[0]!.afterJson!)).toEqual({ scopeId: wallpaperScopeId, employeeIds: [installerAId] })

    await setScopeInstallerAssignments(db, orderId, wallpaperScopeId, [installerBId], 'actor-2')
    expect(await listScopeInstallerAssignments(db, orderId)).toEqual([
      { scopeId: wallpaperScopeId, employeeIds: [installerBId] },
      { scopeId: plasterScopeId, employeeIds: [installerBId, installerCId] },
    ])
  })

  it('rejects a scope owned by another order and an inactive installer without recording a change', async () => {
    const auditCountBefore = await db.installationAuditEvent.count({ where: { orderId } })

    await expect(setScopeInstallerAssignments(db, orderId, foreignScopeId, [installerAId], 'actor-1'))
      .rejects.toMatchObject({ name: 'InstallationScopeAssignmentValidationError' })
    await expect(setScopeInstallerAssignments(db, orderId, wallpaperScopeId, [inactiveInstallerId], 'actor-1'))
      .rejects.toMatchObject({ name: 'InstallationScopeAssignmentValidationError' })

    expect(await db.installationAuditEvent.count({ where: { orderId } })).toBe(auditCountBefore)
    expect(await listScopeInstallerAssignments(db, foreignOrderId)).toEqual([])
  })
})
