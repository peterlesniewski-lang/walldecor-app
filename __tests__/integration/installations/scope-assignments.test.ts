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
  InstallationScopeAssignmentValidationError,
  listScopeInstallerAssignments,
  setScopeInstallerAssignments,
} from '@/lib/installations/scope-assignment-service'
import {
  changeInstallationVisit,
  createInstallationVisit,
  InstallationVisitSyncInProgressError,
  listInstallationVisits,
} from '@/lib/installations/visit-service'

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
let calendarVisitSequence = 0

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

function installerViewer(employeeId: string, employeeActive = true) {
  return { role: 'INSTALLER' as const, employeeId, employeeActive }
}

async function createCalendarVisitFixture() {
  const suffix = ++calendarVisitSequence
  const order = await createInstallationOrder(db, {
    client: { name: `Klient kalendarza ${suffix}`, email: `calendar-scope-${suffix}@example.test`, phone: '+48 501 000 099' },
    address: { street: 'Kalendarzowa', buildingNumber: String(suffix), postalCode: '00-099', city: 'Warszawa' },
    primaryEmployeeId: 'scope-primary',
    backupEmployeeId: 'scope-backup',
  }, 'scope-calendar-fixture')
  const [wallpaperRoom, plasterRoom] = await Promise.all([
    db.installationRoom.create({ data: { id: `calendar-scope-wallpaper-room-${suffix}`, orderId: order.id, name: 'Salon', sortOrder: 0 } }),
    db.installationRoom.create({ data: { id: `calendar-scope-plaster-room-${suffix}`, orderId: order.id, name: 'Korytarz', sortOrder: 1 } }),
  ])
  const [wallpaperScope, plasterScope] = await Promise.all([
    db.installationScope.create({ data: { id: `calendar-scope-wallpaper-${suffix}`, roomId: wallpaperRoom.id, name: 'Tapety', sortOrder: 0 } }),
    db.installationScope.create({ data: { id: `calendar-scope-plaster-${suffix}`, roomId: plasterRoom.id, name: 'Gładzie', sortOrder: 0 } }),
  ])
  return { order, wallpaperScope, plasterScope }
}

function confirmedVisitInput(expectedRevision: number, scopeIds: string[]) {
  return {
    action: 'CONFIRM' as const,
    expectedRevision,
    startsAt: '2026-09-14T06:00:00.000Z',
    endsAt: '2026-09-14T14:00:00.000Z',
    scopeIds,
  }
}

async function createConfirmedVisit(orderId: string, scopeIds: string[]) {
  const draft = await createInstallationVisit(db, orderId, { scopeIds }, 'scope-calendar-fixture')
  return changeInstallationVisit(db, orderId, draft.id, confirmedVisitInput(1, scopeIds), 'scope-calendar-fixture')
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
    const wallpaperAssignment = await setScopeInstallerAssignments(db, orderId, wallpaperScopeId, [installerAId, ` ${installerAId} `, installerAId], 'actor-1')
    const plasterAssignment = await setScopeInstallerAssignments(db, orderId, plasterScopeId, [installerCId, installerBId, installerBId], 'actor-1')

    expect(wallpaperAssignment).toEqual({ scopeId: wallpaperScopeId, employeeIds: [installerAId] })
    expect(plasterAssignment).toEqual({ scopeId: plasterScopeId, employeeIds: [installerBId, installerCId] })

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
    expect(JSON.parse(audits.find((audit) => JSON.parse(audit.afterJson!).scopeId === wallpaperScopeId)!.afterJson!))
      .toEqual({ scopeId: wallpaperScopeId, employeeIds: [installerAId] })
    expect(JSON.parse(audits.find((audit) => JSON.parse(audit.afterJson!).scopeId === plasterScopeId)!.afterJson!))
      .toEqual({ scopeId: plasterScopeId, employeeIds: [installerBId, installerCId] })

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

  it('treats an identical persisted normalized team as a no-op before validating employee activity', async () => {
    const { order, wallpaperScope } = await createCalendarVisitFixture()
    await db.installationScopeAssignment.create({
      data: { orderId: order.id, scopeId: wallpaperScope.id, employeeId: inactiveInstallerId, createdById: 'legacy-fixture' },
    })
    const auditCount = await db.installationAuditEvent.count({ where: { orderId: order.id } })

    await expect(setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [` ${inactiveInstallerId} `], 'actor-1'))
      .resolves.toEqual({ scopeId: wallpaperScope.id, employeeIds: [inactiveInstallerId] })
    expect(await listScopeInstallerAssignments(db, order.id))
      .toEqual([{ scopeId: wallpaperScope.id, employeeIds: [inactiveInstallerId] }])
    expect(await db.installationAuditEvent.count({ where: { orderId: order.id } })).toBe(auditCount)
  })

  it('fails closed for archived orders before both replacement and no-op without changing calendar state', async () => {
    const { order, wallpaperScope } = await createCalendarVisitFixture()
    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerAId], 'actor-1')
    const confirmed = await createConfirmedVisit(order.id, [wallpaperScope.id])
    await db.integrationSyncState.update({
      where: { visitId_kind: { visitId: confirmed.id, kind: 'GOOGLE_CALENDAR' } },
      data: { status: 'SYNCED', externalId: 'event-archived', externalEtag: 'etag-archived' },
    })
    await db.installationOrder.update({ where: { id: order.id }, data: { archivedAt: new Date() } })
    const before = await Promise.all([
      listScopeInstallerAssignments(db, order.id),
      db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } }),
      db.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: confirmed.id, kind: 'GOOGLE_CALENDAR' } } }),
      db.integrationOutbox.findMany({ where: { visitId: confirmed.id }, orderBy: { revision: 'asc' } }),
      db.installationAuditEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }),
    ])

    const replacementError = await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerBId], 'actor-2').catch((cause: unknown) => cause)
    expect(replacementError).toMatchObject({ name: 'InstallationScopeAssignmentArchivedOrderError' })
    expect((replacementError as Error).message).toContain('zarchiwizowanej')
    await expect(setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerAId], 'actor-3'))
      .rejects.toMatchObject({ name: 'InstallationScopeAssignmentArchivedOrderError' })

    expect(await Promise.all([
      listScopeInstallerAssignments(db, order.id),
      db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } }),
      db.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: confirmed.id, kind: 'GOOGLE_CALENDAR' } } }),
      db.integrationOutbox.findMany({ where: { visitId: confirmed.id }, orderBy: { revision: 'asc' } }),
      db.installationAuditEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }),
    ])).toEqual(before)
  })

  it('bumps every affected confirmed visit and enqueues one upsert after a real team replacement, but not after a no-op', async () => {
    const { order, wallpaperScope } = await createCalendarVisitFixture()
    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerAId], 'actor-1')
    const confirmed = await createConfirmedVisit(order.id, [wallpaperScope.id])
    const beforeOutbox = await db.integrationOutbox.findMany({ where: { visitId: confirmed.id } })
    await db.integrationSyncState.update({
      where: { visitId_kind: { visitId: confirmed.id, kind: 'GOOGLE_CALENDAR' } },
      data: { status: 'SYNCED', lastSyncedAt: new Date() },
    })

    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerBId], 'actor-2')

    expect(await db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } }))
      .toMatchObject({ status: 'CONFIRMED', revision: 3 })
    expect(await db.integrationOutbox.findMany({ where: { visitId: confirmed.id }, orderBy: { revision: 'asc' } }))
      .toMatchObject([
        { operation: 'CALENDAR_UPSERT', revision: 2, status: 'PENDING' },
        { operation: 'CALENDAR_UPSERT', revision: 3, status: 'PENDING', idempotencyKey: `calendar:${confirmed.id}:3:CALENDAR_UPSERT` },
      ])
    expect(await db.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: confirmed.id, kind: 'GOOGLE_CALENDAR' } } }))
      .toMatchObject({ status: 'PENDING' })
    expect(await listInstallationVisits(db, order.id)).toMatchObject([
      { id: confirmed.id, revision: 3, participants: [{ employeeId: installerBId, inviteStatus: 'READY' }] },
    ])
    expect(await db.installationAuditEvent.findMany({ where: { orderId: order.id, action: 'INSTALLATION_VISIT_PARTICIPANTS_CHANGED' } })).toHaveLength(1)

    const revisionBeforeNoOp = (await db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } })).revision
    const outboxCountBeforeNoOp = await db.integrationOutbox.count({ where: { visitId: confirmed.id } })
    const auditCountBeforeNoOp = await db.installationAuditEvent.count({ where: { orderId: order.id } })
    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [` ${installerBId} `, installerBId], 'actor-3')
    expect((await db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } })).revision).toBe(revisionBeforeNoOp)
    expect(await db.integrationOutbox.count({ where: { visitId: confirmed.id } })).toBe(outboxCountBeforeNoOp)
    expect(await db.installationAuditEvent.count({ where: { orderId: order.id } })).toBe(auditCountBeforeNoOp)
    expect(beforeOutbox).toHaveLength(1)
  })

  it('rolls back a scope-team replacement while the confirmed visit calendar lease is active, then allows it after expiry', async () => {
    const { order, wallpaperScope } = await createCalendarVisitFixture()
    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerAId], 'actor-1')
    const confirmed = await createConfirmedVisit(order.id, [wallpaperScope.id])
    const job = await db.integrationOutbox.findFirstOrThrow({
      where: { visitId: confirmed.id, revision: confirmed.revision },
    })
    await db.integrationOutbox.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', lockedUntil: new Date(Date.now() + 60_000) },
    })

    await expect(setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerBId], 'actor-2'))
      .rejects.toBeInstanceOf(InstallationVisitSyncInProgressError)
    expect(await listScopeInstallerAssignments(db, order.id))
      .toEqual([{ scopeId: wallpaperScope.id, employeeIds: [installerAId] }])
    expect(await db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } }))
      .toMatchObject({ revision: confirmed.revision, status: 'CONFIRMED' })
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { id: job.id } }))
      .toMatchObject({ status: 'PROCESSING', lockedUntil: expect.any(Date) })

    await db.integrationOutbox.update({
      where: { id: job.id },
      data: { lockedUntil: new Date(Date.now() - 1) },
    })
    await expect(setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerBId], 'actor-3'))
      .resolves.toEqual({ scopeId: wallpaperScope.id, employeeIds: [installerBId] })
    expect(await db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } }))
      .toMatchObject({ revision: confirmed.revision + 1, status: 'CONFIRMED' })
  })

  it('rolls back a replacement that leaves a confirmed visit without a ready participant', async () => {
    const { order, wallpaperScope } = await createCalendarVisitFixture()
    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerAId], 'actor-1')
    const confirmed = await createConfirmedVisit(order.id, [wallpaperScope.id])
    const assignmentsBefore = await listScopeInstallerAssignments(db, order.id)
    const auditCountBefore = await db.installationAuditEvent.count({ where: { orderId: order.id } })
    const outboxCountBefore = await db.integrationOutbox.count({ where: { visitId: confirmed.id } })

    const error = await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [], 'actor-2').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(InstallationScopeAssignmentValidationError)
    expect((error as Error).message).toContain('e-mail')
    expect(await listScopeInstallerAssignments(db, order.id)).toEqual(assignmentsBefore)
    expect(await db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } }))
      .toMatchObject({ status: 'CONFIRMED', revision: 2 })
    expect(await db.integrationOutbox.count({ where: { visitId: confirmed.id } })).toBe(outboxCountBefore)
    expect(await db.installationAuditEvent.count({ where: { orderId: order.id } })).toBe(auditCountBefore)
  })

  it('allows a changed scope team when another scope of the confirmed visit keeps a ready participant', async () => {
    const { order, wallpaperScope, plasterScope } = await createCalendarVisitFixture()
    await Promise.all([
      setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerAId], 'actor-1'),
      setScopeInstallerAssignments(db, order.id, plasterScope.id, [installerBId], 'actor-1'),
    ])
    const confirmed = await createConfirmedVisit(order.id, [wallpaperScope.id, plasterScope.id])

    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [], 'actor-2')

    expect(await db.installationVisit.findUniqueOrThrow({ where: { id: confirmed.id } }))
      .toMatchObject({ status: 'CONFIRMED', revision: 3 })
    expect(await db.integrationOutbox.findMany({ where: { visitId: confirmed.id }, orderBy: { revision: 'asc' } }))
      .toMatchObject([
        { operation: 'CALENDAR_UPSERT', revision: 2 },
        { operation: 'CALENDAR_UPSERT', revision: 3, idempotencyKey: `calendar:${confirmed.id}:3:CALENDAR_UPSERT` },
      ])
    expect(await listInstallationVisits(db, order.id)).toMatchObject([
      { id: confirmed.id, participants: [{ employeeId: installerBId, inviteStatus: 'READY', scopeIds: [plasterScope.id] }] },
    ])
  })

  it('queues each confirmed visit containing the replaced scope independently', async () => {
    const { order, wallpaperScope } = await createCalendarVisitFixture()
    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerAId], 'actor-1')
    const [first, second] = await Promise.all([
      createConfirmedVisit(order.id, [wallpaperScope.id]),
      createConfirmedVisit(order.id, [wallpaperScope.id]),
    ])

    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [installerBId], 'actor-2')

    for (const visit of [first, second]) {
      expect(await db.installationVisit.findUniqueOrThrow({ where: { id: visit.id } })).toMatchObject({ revision: 3, status: 'CONFIRMED' })
      expect(await db.integrationOutbox.findMany({ where: { visitId: visit.id }, orderBy: { revision: 'asc' } }))
        .toMatchObject([
          { operation: 'CALENDAR_UPSERT', revision: 2 },
          { operation: 'CALENDAR_UPSERT', revision: 3, idempotencyKey: `calendar:${visit.id}:3:CALENDAR_UPSERT` },
        ])
    }
    expect(await db.installationAuditEvent.count({ where: { orderId: order.id, action: 'INSTALLATION_VISIT_PARTICIPANTS_CHANGED' } })).toBe(2)
  })
})
