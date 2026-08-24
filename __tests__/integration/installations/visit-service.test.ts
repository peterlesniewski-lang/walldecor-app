import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import {
  changeInstallationVisit,
  createInstallationVisit,
  InstallationVisitRevisionConflictError,
  listInstallationVisits,
  requeueInstallationCalendar,
} from '@/lib/installations/visit-service'
import { setScopeInstallerAssignments } from '@/lib/installations/scope-assignment-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-visit-service-'))
const databasePath = path.join(databaseDirectory, 'visit-service.db')
const databaseUrl = `file:${databasePath}`

let db: PrismaClient
let sequence = 0

const employees = {
  primary: 'visit-primary',
  backup: 'visit-backup',
  ready: 'visit-installer-ready',
  alsoReady: 'visit-installer-also-ready',
  missingEmail: 'visit-installer-missing-email',
  inactive: 'visit-installer-inactive',
} as const

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

async function createFixture() {
  const suffix = ++sequence
  const client = await db.installationClient.create({
    data: {
      id: `visit-client-${suffix}`,
      name: `Klient wizyty ${suffix}`,
      email: `visit-client-${suffix}@example.test`,
      phone: '+48 500 000 001',
    },
  })
  const order = await db.installationOrder.create({
    data: {
      id: `visit-order-${suffix}`,
      number: `VISIT-${suffix}`,
      clientId: client.id,
      addressStreet: 'Kalendarzowa',
      addressBuildingNumber: '1',
      addressPostalCode: '00-001',
      addressCity: 'Warszawa',
      primaryEmployeeId: employees.primary,
      backupEmployeeId: employees.backup,
    },
  })
  const [wallpaperRoom, plasterRoom] = await Promise.all([
    db.installationRoom.create({ data: { id: `visit-wallpaper-room-${suffix}`, orderId: order.id, name: 'Salon', sortOrder: 0 } }),
    db.installationRoom.create({ data: { id: `visit-plaster-room-${suffix}`, orderId: order.id, name: 'Korytarz', sortOrder: 1 } }),
  ])
  const [wallpaperScope, plasterScope] = await Promise.all([
    db.installationScope.create({ data: { id: `visit-wallpaper-scope-${suffix}`, roomId: wallpaperRoom.id, name: 'Tapety', sortOrder: 0 } }),
    db.installationScope.create({ data: { id: `visit-plaster-scope-${suffix}`, roomId: plasterRoom.id, name: 'Gładzie', sortOrder: 0 } }),
  ])

  return { order, wallpaperScope, plasterScope }
}

async function assign(scopeId: string, employeeId: string, orderId: string) {
  await db.installationScopeAssignment.create({
    data: { orderId, scopeId, employeeId, createdById: 'fixture' },
  })
}

function confirmedInput(expectedRevision: number, scopeIds: string[]) {
  return {
    action: 'CONFIRM' as const,
    expectedRevision,
    startsAt: '2026-09-14T06:00:00.000Z',
    endsAt: '2026-09-14T14:00:00.000Z',
    scopeIds,
  }
}

beforeAll(async () => {
  applyMigrations(databasePath)
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'VISIT', name: 'Wizyty' } })
  await Promise.all([
    db.employee.create({ data: { id: employees.primary, firstName: 'Anna', lastName: 'Koordynatorka', email: 'visit.primary@example.test', position: 'Koordynatorka', costCenterId: 'VISIT', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: employees.backup, firstName: 'Bartek', lastName: 'Zastępca', email: 'visit.backup@example.test', position: 'Koordynator', costCenterId: 'VISIT', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: employees.ready, firstName: 'Celina', lastName: 'Gotowa', email: 'visit.ready@example.test', position: 'Instalatorka', costCenterId: 'VISIT', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: employees.alsoReady, firstName: 'Damian', lastName: 'Gotowy', email: 'visit.also-ready@example.test', position: 'Instalator', costCenterId: 'VISIT', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    // Employee.email is non-null in the existing schema; whitespace is the durable representation of a missing invite address.
    db.employee.create({ data: { id: employees.missingEmail, firstName: 'Eliza', lastName: 'Bez emaila', email: ' ', position: 'Instalatorka', costCenterId: 'VISIT', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    db.employee.create({ data: { id: employees.inactive, firstName: 'Filip', lastName: 'Nieaktywny', email: 'visit.inactive@example.test', position: 'Instalator', costCenterId: 'VISIT', startDate: new Date('2026-01-01T00:00:00.000Z'), active: false } }),
  ])
})

afterAll(async () => {
  await db?.$disconnect()
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('installation visit lifecycle', () => {
  it('persists a draft without an outbox, then revisions confirmed updates and cancellation atomically', async () => {
    const { order, wallpaperScope } = await createFixture()
    await assign(wallpaperScope.id, employees.ready, order.id)

    const draft = await createInstallationVisit(db, order.id, {
      scopeIds: [wallpaperScope.id],
      note: 'Tapety tekstylne',
    }, 'owner-user')

    expect(draft).toMatchObject({ status: 'DRAFT', revision: 1, scopeIds: [wallpaperScope.id] })
    expect(await db.integrationSyncState.findMany({ where: { visitId: draft.id } }))
      .toMatchObject([{ kind: 'GOOGLE_CALENDAR', status: 'NOT_REQUESTED' }])
    expect(await db.integrationOutbox.count({ where: { visitId: draft.id } })).toBe(0)

    const confirmed = await changeInstallationVisit(db, order.id, draft.id, confirmedInput(1, [wallpaperScope.id]), 'owner-user')
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', revision: 2 })
    expect(await db.integrationOutbox.findMany({ where: { visitId: draft.id }, orderBy: { revision: 'asc' } }))
      .toMatchObject([{ operation: 'CALENDAR_UPSERT', revision: 2, status: 'PENDING', idempotencyKey: `calendar:${draft.id}:2:CALENDAR_UPSERT` }])
    expect(await db.integrationSyncState.findMany({ where: { visitId: draft.id } }))
      .toMatchObject([{ status: 'PENDING' }])

    const changed = await changeInstallationVisit(db, order.id, draft.id, {
      ...confirmedInput(2, [wallpaperScope.id]),
      startsAt: '2026-09-15T06:00:00.000Z',
      endsAt: '2026-09-15T14:00:00.000Z',
    }, 'owner-user')
    expect(changed).toMatchObject({ status: 'CONFIRMED', revision: 3 })

    const cancelled = await changeInstallationVisit(db, order.id, draft.id, {
      action: 'CANCEL', expectedRevision: 3,
    }, 'owner-user')
    expect(cancelled).toMatchObject({ status: 'CANCELLED', revision: 4 })

    expect(await db.integrationOutbox.findMany({ where: { visitId: draft.id }, orderBy: { revision: 'asc' } }))
      .toMatchObject([
        { operation: 'CALENDAR_UPSERT', revision: 2, status: 'PENDING' },
        { operation: 'CALENDAR_UPSERT', revision: 3, status: 'PENDING' },
        { operation: 'CALENDAR_CANCEL', revision: 4, status: 'PENDING', idempotencyKey: `calendar:${draft.id}:4:CALENDAR_CANCEL` },
      ])

    const outboxCount = await db.integrationOutbox.count({ where: { visitId: draft.id } })
    await expect(changeInstallationVisit(db, order.id, draft.id, {
      action: 'CANCEL', expectedRevision: 1,
    }, 'owner-user')).rejects.toBeInstanceOf(InstallationVisitRevisionConflictError)
    expect(await db.integrationOutbox.count({ where: { visitId: draft.id } })).toBe(outboxCount)
    expect(await db.installationAuditEvent.count({ where: { orderId: order.id } })).toBe(4)
  })

  it('permits draft saves only for drafts while confirmed edits remain confirmed and enqueue an upsert', async () => {
    const { order, wallpaperScope, plasterScope } = await createFixture()
    await Promise.all([
      assign(wallpaperScope.id, employees.ready, order.id),
      assign(plasterScope.id, employees.alsoReady, order.id),
    ])
    const draft = await createInstallationVisit(db, order.id, { scopeIds: [wallpaperScope.id] }, 'owner-user')

    const savedDraft = await changeInstallationVisit(db, order.id, draft.id, {
      action: 'SAVE_DRAFT',
      expectedRevision: 1,
      startsAt: '2026-09-13T06:00:00.000Z',
      endsAt: '2026-09-13T14:00:00.000Z',
      note: 'Termin roboczy',
      scopeIds: [plasterScope.id],
    }, 'owner-user')
    expect(savedDraft).toMatchObject({ status: 'DRAFT', revision: 2, scopeIds: [plasterScope.id] })
    expect(await db.integrationOutbox.count({ where: { visitId: draft.id } })).toBe(0)

    const confirmed = await changeInstallationVisit(db, order.id, draft.id, confirmedInput(2, [plasterScope.id]), 'owner-user')
    const editedConfirmed = await changeInstallationVisit(db, order.id, draft.id, {
      ...confirmedInput(3, [plasterScope.id]),
      startsAt: '2026-09-15T06:00:00.000Z',
      endsAt: '2026-09-15T14:00:00.000Z',
    }, 'owner-user')
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', revision: 3 })
    expect(editedConfirmed).toMatchObject({ status: 'CONFIRMED', revision: 4 })
    expect(await db.integrationOutbox.findMany({ where: { visitId: draft.id }, orderBy: { revision: 'asc' } }))
      .toMatchObject([
        { operation: 'CALENDAR_UPSERT', revision: 3 },
        { operation: 'CALENDAR_UPSERT', revision: 4 },
      ])

    const auditCount = await db.installationAuditEvent.count({ where: { orderId: order.id } })
    const outboxCount = await db.integrationOutbox.count({ where: { visitId: draft.id } })
    await expect(changeInstallationVisit(db, order.id, draft.id, {
      action: 'SAVE_DRAFT',
      expectedRevision: 4,
      note: 'To nie może zmienić potwierdzonego terminu',
      scopeIds: [wallpaperScope.id],
    }, 'owner-user')).rejects.toMatchObject({
      name: 'InstallationVisitValidationError',
      fieldErrors: { action: expect.stringContaining('Nie można') },
    })
    expect(await db.installationVisit.findUniqueOrThrow({ where: { id: draft.id } }))
      .toMatchObject({ status: 'CONFIRMED', revision: 4 })
    expect(await db.installationVisitScope.findMany({ where: { visitId: draft.id } }))
      .toMatchObject([{ scopeId: plasterScope.id }])
    expect(await db.integrationOutbox.count({ where: { visitId: draft.id } })).toBe(outboxCount)
    expect(await db.installationAuditEvent.count({ where: { orderId: order.id } })).toBe(auditCount)
  })

  it('allows cancellation from draft or confirmed and keeps cancelled and completed visits terminal', async () => {
    const cancelledDraftFixture = await createFixture()
    await assign(cancelledDraftFixture.wallpaperScope.id, employees.ready, cancelledDraftFixture.order.id)
    const draft = await createInstallationVisit(db, cancelledDraftFixture.order.id, { scopeIds: [cancelledDraftFixture.wallpaperScope.id] }, 'owner-user')
    const cancelledDraft = await changeInstallationVisit(db, cancelledDraftFixture.order.id, draft.id, {
      action: 'CANCEL', expectedRevision: 1,
    }, 'owner-user')
    expect(cancelledDraft).toMatchObject({ status: 'CANCELLED', revision: 2 })
    expect(await db.integrationOutbox.count({ where: { visitId: draft.id } })).toBe(0)

    const cancelledConfirmedFixture = await createFixture()
    await assign(cancelledConfirmedFixture.wallpaperScope.id, employees.ready, cancelledConfirmedFixture.order.id)
    const confirmedForCancellation = await createInstallationVisit(db, cancelledConfirmedFixture.order.id, { scopeIds: [cancelledConfirmedFixture.wallpaperScope.id] }, 'owner-user')
    await changeInstallationVisit(db, cancelledConfirmedFixture.order.id, confirmedForCancellation.id, confirmedInput(1, [cancelledConfirmedFixture.wallpaperScope.id]), 'owner-user')
    const cancelledConfirmed = await changeInstallationVisit(db, cancelledConfirmedFixture.order.id, confirmedForCancellation.id, {
      action: 'CANCEL', expectedRevision: 2,
    }, 'owner-user')
    expect(cancelledConfirmed).toMatchObject({ status: 'CANCELLED', revision: 3 })
    expect(await db.integrationOutbox.findMany({ where: { visitId: confirmedForCancellation.id }, orderBy: { revision: 'asc' } }))
      .toMatchObject([
        { operation: 'CALENDAR_UPSERT', revision: 2 },
        { operation: 'CALENDAR_CANCEL', revision: 3 },
      ])

    const completedFixture = await createFixture()
    await assign(completedFixture.wallpaperScope.id, employees.ready, completedFixture.order.id)
    const confirmedForCompletion = await createInstallationVisit(db, completedFixture.order.id, { scopeIds: [completedFixture.wallpaperScope.id] }, 'owner-user')
    await changeInstallationVisit(db, completedFixture.order.id, confirmedForCompletion.id, confirmedInput(1, [completedFixture.wallpaperScope.id]), 'owner-user')
    const completed = await changeInstallationVisit(db, completedFixture.order.id, confirmedForCompletion.id, {
      action: 'COMPLETE', expectedRevision: 2,
    }, 'owner-user')
    expect(completed).toMatchObject({ status: 'COMPLETED', revision: 3 })
    expect(await db.integrationOutbox.findMany({ where: { visitId: confirmedForCompletion.id } }))
      .toMatchObject([{ operation: 'CALENDAR_UPSERT', revision: 2 }])

    for (const terminal of [
      { visitId: draft.id, orderId: cancelledDraftFixture.order.id, revision: 2, scopeId: cancelledDraftFixture.wallpaperScope.id },
      { visitId: confirmedForCancellation.id, orderId: cancelledConfirmedFixture.order.id, revision: 3, scopeId: cancelledConfirmedFixture.wallpaperScope.id },
      { visitId: confirmedForCompletion.id, orderId: completedFixture.order.id, revision: 3, scopeId: completedFixture.wallpaperScope.id },
    ]) {
      const before = await db.installationVisit.findUniqueOrThrow({ where: { id: terminal.visitId } })
      const scopesBefore = await db.installationVisitScope.findMany({ where: { visitId: terminal.visitId }, orderBy: { scopeId: 'asc' } })
      const outboxCount = await db.integrationOutbox.count({ where: { visitId: terminal.visitId } })
      const auditCount = await db.installationAuditEvent.count({ where: { orderId: terminal.orderId } })
      const actions = [
        { action: 'SAVE_DRAFT', expectedRevision: terminal.revision, note: 'Niedozwolone', scopeIds: [terminal.scopeId] },
        confirmedInput(terminal.revision, [terminal.scopeId]),
        { action: 'CANCEL', expectedRevision: terminal.revision },
        { action: 'COMPLETE', expectedRevision: terminal.revision },
      ]

      for (const action of actions) {
        await expect(changeInstallationVisit(db, terminal.orderId, terminal.visitId, action, 'owner-user')).rejects.toMatchObject({
          name: 'InstallationVisitValidationError',
          fieldErrors: { action: expect.stringContaining('Nie można') },
        })
      }

      expect(await db.installationVisit.findUniqueOrThrow({ where: { id: terminal.visitId } }))
        .toMatchObject({ status: before.status, revision: before.revision })
      expect(await db.installationVisitScope.findMany({ where: { visitId: terminal.visitId }, orderBy: { scopeId: 'asc' } })).toEqual(scopesBefore)
      expect(await db.integrationOutbox.count({ where: { visitId: terminal.visitId } })).toBe(outboxCount)
      expect(await db.installationAuditEvent.count({ where: { orderId: terminal.orderId } })).toBe(auditCount)
    }
  })

  it('does not revise or queue draft and terminal visits when a scope team changes', async () => {
    const { order, wallpaperScope } = await createFixture()
    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [employees.ready], 'owner-user')
    const draft = await createInstallationVisit(db, order.id, { scopeIds: [wallpaperScope.id] }, 'owner-user')
    const confirmed = await createInstallationVisit(db, order.id, { scopeIds: [wallpaperScope.id] }, 'owner-user')
    await changeInstallationVisit(db, order.id, confirmed.id, confirmedInput(1, [wallpaperScope.id]), 'owner-user')
    const completed = await changeInstallationVisit(db, order.id, confirmed.id, { action: 'COMPLETE', expectedRevision: 2 }, 'owner-user')
    const auditCount = await db.installationAuditEvent.count({ where: { orderId: order.id } })
    const outboxCount = await db.integrationOutbox.count({ where: { visit: { orderId: order.id } } })

    await setScopeInstallerAssignments(db, order.id, wallpaperScope.id, [employees.alsoReady], 'owner-user')

    expect(await listInstallationVisits(db, order.id)).toMatchObject([
      { id: draft.id, status: 'DRAFT', revision: 1, participants: [{ employeeId: employees.alsoReady }] },
      { id: completed.id, status: 'COMPLETED', revision: 3, participants: [{ employeeId: employees.alsoReady }] },
    ])
    expect(await db.integrationOutbox.count({ where: { visit: { orderId: order.id } } })).toBe(outboxCount)
    expect(await db.installationAuditEvent.count({ where: { orderId: order.id, action: 'INSTALLATION_VISIT_PARTICIPANTS_CHANGED' } })).toBe(0)
    expect(await db.installationAuditEvent.count({ where: { orderId: order.id } })).toBe(auditCount + 1)
  })

  it('rejects foreign scopes and changes to archived orders without committing visit records', async () => {
    const first = await createFixture()
    const second = await createFixture()

    await expect(createInstallationVisit(db, first.order.id, {
      scopeIds: [second.wallpaperScope.id],
    }, 'owner-user')).rejects.toMatchObject({
      name: 'InstallationVisitValidationError',
      fieldErrors: { scopeIds: expect.stringContaining('zakres') },
    })
    expect(await db.installationVisit.count({ where: { orderId: first.order.id } })).toBe(0)

    await db.installationOrder.update({ where: { id: first.order.id }, data: { archivedAt: new Date() } })
    await expect(createInstallationVisit(db, first.order.id, {
      scopeIds: [first.wallpaperScope.id],
    }, 'owner-user')).rejects.toThrow('zarchiwiz')
    expect(await db.installationVisit.count({ where: { orderId: first.order.id } })).toBe(0)
    expect(await db.integrationOutbox.count({ where: { visit: { orderId: first.order.id } } })).toBe(0)
  })

  it('requires an active assigned installer with an invite address before confirmation', async () => {
    const noAssignment = await createFixture()
    const noAssignmentDraft = await createInstallationVisit(db, noAssignment.order.id, { scopeIds: [noAssignment.wallpaperScope.id] }, 'owner-user')
    await expect(changeInstallationVisit(db, noAssignment.order.id, noAssignmentDraft.id, confirmedInput(1, [noAssignment.wallpaperScope.id]), 'owner-user'))
      .rejects.toMatchObject({ fieldErrors: { scopeIds: expect.stringContaining('aktywn') } })
    expect(await db.integrationOutbox.count({ where: { visitId: noAssignmentDraft.id } })).toBe(0)

    const inactiveAssignment = await createFixture()
    await assign(inactiveAssignment.wallpaperScope.id, employees.inactive, inactiveAssignment.order.id)
    const inactiveDraft = await createInstallationVisit(db, inactiveAssignment.order.id, { scopeIds: [inactiveAssignment.wallpaperScope.id] }, 'owner-user')
    await expect(changeInstallationVisit(db, inactiveAssignment.order.id, inactiveDraft.id, confirmedInput(1, [inactiveAssignment.wallpaperScope.id]), 'owner-user'))
      .rejects.toMatchObject({ fieldErrors: { scopeIds: expect.stringContaining('aktywn') } })
    expect(await db.integrationOutbox.count({ where: { visitId: inactiveDraft.id } })).toBe(0)

    const missingEmail = await createFixture()
    await assign(missingEmail.wallpaperScope.id, employees.missingEmail, missingEmail.order.id)
    const missingEmailDraft = await createInstallationVisit(db, missingEmail.order.id, { scopeIds: [missingEmail.wallpaperScope.id] }, 'owner-user')
    await expect(changeInstallationVisit(db, missingEmail.order.id, missingEmailDraft.id, confirmedInput(1, [missingEmail.wallpaperScope.id]), 'owner-user'))
      .rejects.toMatchObject({ fieldErrors: { scopeIds: expect.stringContaining('adres') } })
    expect(await db.integrationOutbox.count({ where: { visitId: missingEmailDraft.id } })).toBe(0)
  })

  it('exposes mixed-email participants as warnings while confirming the addressable team', async () => {
    const { order, wallpaperScope, plasterScope } = await createFixture()
    await Promise.all([
      assign(wallpaperScope.id, employees.ready, order.id),
      assign(wallpaperScope.id, employees.missingEmail, order.id),
      assign(plasterScope.id, employees.ready, order.id),
      assign(plasterScope.id, employees.alsoReady, order.id),
    ])
    const draft = await createInstallationVisit(db, order.id, { scopeIds: [plasterScope.id, wallpaperScope.id] }, 'owner-user')

    const confirmed = await changeInstallationVisit(db, order.id, draft.id, confirmedInput(1, [plasterScope.id, wallpaperScope.id]), 'owner-user')

    expect(confirmed.participants).toEqual([
      { employeeId: employees.ready, name: 'Celina Gotowa', email: 'visit.ready@example.test', scopeIds: [wallpaperScope.id, plasterScope.id], inviteStatus: 'READY' },
      { employeeId: employees.alsoReady, name: 'Damian Gotowy', email: 'visit.also-ready@example.test', scopeIds: [plasterScope.id], inviteStatus: 'READY' },
      { employeeId: employees.missingEmail, name: 'Eliza Bez emaila', email: null, scopeIds: [wallpaperScope.id], inviteStatus: 'MISSING_EMAIL' },
    ])
  })

  it('requeues the same failed job and carries the requested overwrite mode', async () => {
    const { order, wallpaperScope } = await createFixture()
    await assign(wallpaperScope.id, employees.ready, order.id)
    const draft = await createInstallationVisit(db, order.id, { scopeIds: [wallpaperScope.id] }, 'owner-user')
    await changeInstallationVisit(db, order.id, draft.id, confirmedInput(1, [wallpaperScope.id]), 'owner-user')
    const original = await db.integrationOutbox.findFirstOrThrow({ where: { visitId: draft.id } })

    await db.$transaction([
      db.integrationOutbox.update({ where: { id: original.id }, data: { status: 'DEAD', attemptCount: 2, lastErrorCode: 'ETAG_CONFLICT' } }),
      db.integrationAttempt.createMany({ data: [
        { outboxId: original.id, number: 1, outcome: 'ATTENTION', errorCode: 'ETAG_CONFLICT', durationMs: 1 },
        { outboxId: original.id, number: 2, outcome: 'ATTENTION', errorCode: 'ETAG_CONFLICT', durationMs: 1 },
      ] }),
      db.integrationSyncState.update({ where: { visitId_kind: { visitId: draft.id, kind: 'GOOGLE_CALENDAR' } }, data: { status: 'ATTENTION', lastErrorCode: 'ETAG_CONFLICT' } }),
    ])
    await requeueInstallationCalendar(db, order.id, draft.id, false, 'owner-user')
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { id: original.id } }))
      .toMatchObject({ status: 'PENDING', forceOverwrite: false, attemptCount: 2, lastErrorCode: null, lastErrorMessage: null })

    await db.$transaction([
      db.integrationOutbox.update({ where: { id: original.id }, data: { status: 'DEAD', lastErrorCode: 'ETAG_CONFLICT' } }),
      db.integrationSyncState.update({ where: { visitId_kind: { visitId: draft.id, kind: 'GOOGLE_CALENDAR' } }, data: { status: 'ATTENTION', lastErrorCode: 'ETAG_CONFLICT' } }),
    ])
    const result = await requeueInstallationCalendar(db, order.id, draft.id, true, 'owner-user')
    expect(result).toMatchObject({ id: draft.id, revision: 2 })
    expect(await db.integrationOutbox.findMany({ where: { visitId: draft.id } })).toHaveLength(1)
    expect(await db.integrationOutbox.findUniqueOrThrow({ where: { id: original.id } }))
      .toMatchObject({ status: 'PENDING', forceOverwrite: true, attemptCount: 2, lastErrorCode: null, lastErrorMessage: null })
    expect(await db.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: draft.id, kind: 'GOOGLE_CALENDAR' } } }))
      .toMatchObject({ status: 'PENDING', lastErrorCode: null, lastErrorMessage: null })
  })

  it('returns the same stored visit and outbox data through a newly opened Prisma client', async () => {
    const { order, wallpaperScope } = await createFixture()
    await assign(wallpaperScope.id, employees.ready, order.id)
    const draft = await createInstallationVisit(db, order.id, { scopeIds: [wallpaperScope.id] }, 'owner-user')
    await changeInstallationVisit(db, order.id, draft.id, confirmedInput(1, [wallpaperScope.id]), 'owner-user')

    const reopened = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    try {
      expect(await listInstallationVisits(reopened, order.id)).toMatchObject([
        { id: draft.id, status: 'CONFIRMED', revision: 2, scopeIds: [wallpaperScope.id] },
      ])
      expect(await reopened.integrationOutbox.findMany({ where: { visitId: draft.id } }))
        .toMatchObject([{ operation: 'CALENDAR_UPSERT', revision: 2, status: 'PENDING' }])
    } finally {
      await reopened.$disconnect()
    }
  })
})
