import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@/generated/prisma'
import {
  CalendarConflictError,
  CalendarRetryableError,
  type InstallationCalendarAdapter,
} from '@/lib/installations/calendar-adapter'
import { FakeInstallationCalendarAdapter } from '@/lib/installations/fake-calendar-adapter'
import { claimNextIntegrationJob, INTEGRATION_OUTBOX_LEASE_MS } from '@/lib/installations/integration-outbox'
import {
  processInstallationCalendarBatch,
  processInstallationCalendarJob,
} from '@/lib/installations/calendar-worker'
import {
  changeInstallationVisit,
  InstallationVisitSyncInProgressError,
  requeueInstallationCalendar,
} from '@/lib/installations/visit-service'
import { setScopeInstallerAssignments } from '@/lib/installations/scope-assignment-service'

const databaseDirectory = mkdtempSync(path.join(tmpdir(), 'walldecor-calendar-outbox-'))
const databasePath = path.join(databaseDirectory, 'calendar-outbox.db')
const databaseUrl = `file:${databasePath}`

let dbA: PrismaClient
let dbB: PrismaClient
let sequence = 0

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

async function createOutboxFixture(options: {
  id?: string
  operation?: 'CALENDAR_UPSERT' | 'CALENDAR_CANCEL'
  revision?: number
  status?: 'PENDING' | 'PROCESSING' | 'RETRY' | 'COMPLETED' | 'DEAD'
  availableAt?: Date
  lockedUntil?: Date | null
  forceOverwrite?: boolean
  hasReadyParticipant?: boolean
  startsAt?: Date | null
  endsAt?: Date | null
} = {}) {
  const suffix = ++sequence
  const client = await dbA.installationClient.create({
    data: { id: `outbox-client-${suffix}`, name: `Klient outboxa ${suffix}`, email: `outbox-${suffix}@example.test`, phone: '+48 500 000 001' },
  })
  const order = await dbA.installationOrder.create({
    data: {
      id: `outbox-order-${suffix}`,
      number: `OUTBOX-${suffix}`,
      clientId: client.id,
      addressStreet: 'Kalendarzowa',
      addressBuildingNumber: String(suffix),
      addressPostalCode: '00-001',
      addressCity: 'Warszawa',
      primaryEmployeeId: 'outbox-primary',
      backupEmployeeId: 'outbox-backup',
    },
  })
  const room = await dbA.installationRoom.create({
    data: { id: `outbox-room-${suffix}`, orderId: order.id, name: 'Salon', sortOrder: 0 },
  })
  const scope = await dbA.installationScope.create({
    data: { id: `outbox-scope-${suffix}`, roomId: room.id, name: 'Tapety', sortOrder: 0 },
  })
  if (options.hasReadyParticipant !== false) {
    await dbA.installationScopeAssignment.create({
      data: { orderId: order.id, scopeId: scope.id, employeeId: 'outbox-installer', createdById: 'outbox-fixture' },
    })
  }
  const visit = await dbA.installationVisit.create({
    data: {
      id: `outbox-visit-${suffix}`,
      orderId: order.id,
      status: options.operation === 'CALENDAR_CANCEL' ? 'CANCELLED' : 'CONFIRMED',
      startsAt: options.startsAt === undefined ? new Date('2026-09-14T06:00:00.000Z') : options.startsAt,
      endsAt: options.endsAt === undefined ? new Date('2026-09-14T14:00:00.000Z') : options.endsAt,
      revision: options.revision ?? 2,
      createdById: 'outbox-fixture',
      scopes: { create: { orderId: order.id, scopeId: scope.id } },
      syncStates: { create: { kind: 'GOOGLE_CALENDAR', status: 'PENDING' } },
    },
  })
  const job = await dbA.integrationOutbox.create({
    data: {
      id: options.id ?? `outbox-job-${suffix}`,
      visitId: visit.id,
      revision: options.revision ?? 2,
      operation: options.operation ?? 'CALENDAR_UPSERT',
      idempotencyKey: `calendar:${visit.id}:${options.revision ?? 2}:${options.operation ?? 'CALENDAR_UPSERT'}`,
      status: options.status ?? 'PENDING',
      availableAt: options.availableAt ?? new Date('2026-09-14T00:00:00.000Z'),
      lockedUntil: options.lockedUntil,
      forceOverwrite: options.forceOverwrite ?? false,
    },
  })
  return { order, visit, job, scope }
}

beforeAll(async () => {
  applyMigrations(databasePath)
  dbA = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  dbB = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await Promise.all([
    dbA.$executeRawUnsafe('PRAGMA foreign_keys = ON'),
    dbB.$executeRawUnsafe('PRAGMA foreign_keys = ON'),
    dbA.$queryRawUnsafe('PRAGMA busy_timeout = 5000'),
    dbB.$queryRawUnsafe('PRAGMA busy_timeout = 5000'),
  ])
  await dbA.costCenter.create({ data: { id: 'OUTBOX', name: 'Outbox kalendarza' } })
  await Promise.all([
    dbA.employee.create({ data: { id: 'outbox-primary', firstName: 'Anna', lastName: 'Koordynatorka', email: 'outbox.primary@example.test', position: 'Koordynatorka', costCenterId: 'OUTBOX', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    dbA.employee.create({ data: { id: 'outbox-backup', firstName: 'Bartek', lastName: 'Zastępca', email: 'outbox.backup@example.test', position: 'Koordynator', costCenterId: 'OUTBOX', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    dbA.employee.create({ data: { id: 'outbox-installer', firstName: 'Celina', lastName: 'Instalatorka', email: 'outbox.installer@example.test', position: 'Instalatorka', costCenterId: 'OUTBOX', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
    dbA.employee.create({ data: { id: 'outbox-installer-b', firstName: 'Dominika', lastName: 'Zmiana', email: 'outbox.installer-b@example.test', position: 'Instalatorka', costCenterId: 'OUTBOX', startDate: new Date('2026-01-01T00:00:00.000Z') } }),
  ])
})

afterAll(async () => {
  await Promise.all([dbA?.$disconnect(), dbB?.$disconnect()])
  rmSync(databaseDirectory, { recursive: true, force: true })
})

describe('installation calendar outbox', () => {
  it('exposes the durable claim and worker public API', () => {
    expect(claimNextIntegrationJob).toBeTypeOf('function')
    expect(processInstallationCalendarJob).toBeTypeOf('function')
    expect(processInstallationCalendarBatch).toBeTypeOf('function')
  })

  it('atomically claims a pending job for only one of two Prisma clients', async () => {
    const now = new Date('2026-09-14T10:00:00.000Z')
    const { job } = await createOutboxFixture()

    const claims = await Promise.all([
      claimNextIntegrationJob(dbA, now, 'worker-a'),
      claimNextIntegrationJob(dbB, now, 'worker-b'),
    ])

    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claims.find(Boolean)).toMatchObject({ id: job.id, status: 'PROCESSING' })
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: job.id } }))
      .toMatchObject({ status: 'PROCESSING', lockedUntil: new Date('2026-09-14T10:05:00.000Z') })
    await dbA.integrationOutbox.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: now, lockedUntil: null } })
  })

  it('projects only calendar-safe visit data and stores a successful upsert result', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: queuedJob } = await createOutboxFixture()
    await dbA.installationVisit.update({ where: { id: visit.id }, data: { note: 'Prywatna notatka i odpowiedzi formularza nie mogą wyjść do kalendarza.' } })
    const job = await claimNextIntegrationJob(dbA, now, 'worker-success')
    const adapter = new FakeInstallationCalendarAdapter()

    expect(job).toMatchObject({ id: queuedJob.id, revision: 2 })
    const result = await processInstallationCalendarJob(dbA, adapter, job!, now)

    expect(result).toMatchObject({ outcome: 'COMPLETED', outboxId: queuedJob.id })
    expect(adapter.snapshot()).toMatchObject([{
      event: {
        visitId: visit.id,
        attendeeEmails: ['outbox.installer@example.test'],
        privateProperties: { wallDecorVisitId: visit.id },
      },
    }])
    expect(JSON.stringify(adapter.snapshot())).not.toContain('Prywatna notatka')
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
      .toMatchObject({ status: 'COMPLETED', lockedUntil: null, attemptCount: 1 })
    expect(await dbA.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } }))
      .toMatchObject({ status: 'SYNCED', externalId: adapter.snapshot()[0].eventId, externalEtag: adapter.snapshot()[0].etag, lastSyncedAt: now })
    expect(await dbA.integrationAttempt.findMany({ where: { outboxId: queuedJob.id } }))
      .toMatchObject([{ number: 1, outcome: 'SUCCESS', durationMs: expect.any(Number) }])
  })

  it('recovers an expired lease through the same atomic claim path', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { job: queuedJob } = await createOutboxFixture({
      status: 'PROCESSING',
      lockedUntil: new Date('2026-09-14T09:59:59.999Z'),
    })

    const claim = await claimNextIntegrationJob(dbB, now, 'worker-recovery')

    expect(claim).toMatchObject({ id: queuedJob.id, workerId: 'worker-recovery', status: 'PROCESSING' })
    expect(claim?.lockedUntil).toEqual(new Date('2026-09-14T10:06:00.000Z'))
    await dbA.integrationOutbox.update({ where: { id: queuedJob.id }, data: { status: 'COMPLETED', completedAt: now, lockedUntil: null } })
  })

  it('retries a typed 429 with deterministic bounded backoff and a safe persisted error', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { job: queuedJob } = await createOutboxFixture({ id: 'retry-jitter-job' })
    const job = await claimNextIntegrationJob(dbA, now, 'worker-retry')
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { throw new CalendarRetryableError('429', 'Bearer private-token must never be stored') },
      cancel: async () => undefined,
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'RETRIED', outboxId: queuedJob.id })
    const retried = await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } })
    expect(retried).toMatchObject({ status: 'RETRY', attemptCount: 1, lastErrorCode: '429', lockedUntil: null })
    const delayMs = retried.availableAt.getTime() - now.getTime()
    expect(delayMs).toBeGreaterThanOrEqual(15_000)
    expect(delayMs).toBeLessThanOrEqual(16_000)
    expect(retried.lastErrorMessage).not.toContain('private-token')
    expect(retried.lastErrorMessage?.length).toBeLessThanOrEqual(500)
    expect(await dbA.integrationAttempt.findMany({ where: { outboxId: queuedJob.id } }))
      .toMatchObject([{ number: 1, outcome: 'RETRY', errorCode: '429', durationMs: expect.any(Number) }])
  })

  it('turns a 403 into ATTENTION without persisting raw adapter details', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: queuedJob } = await createOutboxFixture()
    const job = await claimNextIntegrationJob(dbA, now, 'worker-403')
    const forbidden = Object.assign(new Error('Authorization: Bearer top-secret'), { status: 403 })
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { throw forbidden },
      cancel: async () => undefined,
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'ATTENTION' })
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
      .toMatchObject({ status: 'DEAD', lastErrorCode: 'CONFIGURATION_ERROR' })
    const sync = await dbA.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } })
    expect(sync).toMatchObject({ status: 'ATTENTION', lastErrorCode: 'CONFIGURATION_ERROR' })
    expect(sync.lastErrorMessage).not.toContain('top-secret')
  })

  it('normalizes an arbitrary retryable error code before persistence', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { job: queuedJob } = await createOutboxFixture()
    const job = await claimNextIntegrationJob(dbA, now, 'worker-retry-code')
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { throw new CalendarRetryableError('Bearer private-token') },
      cancel: async () => undefined,
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'RETRIED' })
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
      .toMatchObject({ status: 'RETRY', lastErrorCode: 'RETRYABLE_ERROR' })
    expect(await dbA.integrationAttempt.findMany({ where: { outboxId: queuedJob.id } }))
      .toMatchObject([{ number: 1, errorCode: 'RETRYABLE_ERROR' }])
  })

  it('requires conscious recovery after an etag conflict', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: queuedJob } = await createOutboxFixture()
    const job = await claimNextIntegrationJob(dbA, now, 'worker-conflict')
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { throw new CalendarConflictError('stale etag private detail') },
      cancel: async () => undefined,
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'ATTENTION' })
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
      .toMatchObject({ status: 'DEAD', lastErrorCode: 'ETAG_CONFLICT' })
    expect(await dbA.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } }))
      .toMatchObject({ status: 'ATTENTION', lastErrorCode: 'ETAG_CONFLICT' })
  })

  it('fences a stale revision without invoking the adapter or replacing newer sync state', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: queuedJob } = await createOutboxFixture()
    await dbA.installationVisit.update({ where: { id: visit.id }, data: { revision: 3 } })
    await dbA.integrationSyncState.update({
      where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } },
      data: { status: 'PENDING', externalId: 'newer-event', externalEtag: 'newer-etag' },
    })
    const job = await claimNextIntegrationJob(dbA, now, 'worker-stale')
    let adapterCalls = 0
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { adapterCalls += 1; return { eventId: 'unexpected', htmlLink: 'https://calendar.example.test/unexpected', etag: 'unexpected' } },
      cancel: async () => { adapterCalls += 1 },
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'STALE', outboxId: queuedJob.id })
    expect(adapterCalls).toBe(0)
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
      .toMatchObject({ status: 'COMPLETED', lastErrorCode: 'STALE' })
    expect(await dbA.integrationAttempt.findMany({ where: { outboxId: queuedJob.id } }))
      .toMatchObject([{ number: 1, outcome: 'STALE', errorCode: 'STALE' }])
    expect(await dbA.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } }))
      .toMatchObject({ status: 'PENDING', externalId: 'newer-event', externalEtag: 'newer-etag' })
  })

  it('atomically fences a revision that becomes stale after projection but before adapter I/O', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: oldQueued } = await createOutboxFixture()
    const oldJob = await claimNextIntegrationJob(dbA, now, 'worker-race-old')
    // Deliberately bypass the generated PrismaPromise signature only in this
    // controlled race hook; production never mutates a Prisma delegate.
    const assignmentsDelegate = dbA.installationScopeAssignment as unknown as {
      findMany: (...args: unknown[]) => Promise<unknown>
    }
    const originalFindMany = dbA.installationScopeAssignment.findMany
      .bind(dbA.installationScopeAssignment) as unknown as (...args: unknown[]) => Promise<unknown>
    let injected = false
    assignmentsDelegate.findMany = async (...args) => {
      const assignments = await originalFindMany(...args)
      if (!injected) {
        injected = true
        await dbB.$transaction([
          dbB.installationVisit.update({ where: { id: visit.id }, data: { status: 'CANCELLED', revision: 3 } }),
          dbB.integrationSyncState.update({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } }, data: { status: 'PENDING' } }),
          dbB.integrationOutbox.create({
            data: {
              id: `${oldQueued.id}-cancel-race`, visitId: visit.id, revision: 3, operation: 'CALENDAR_CANCEL',
              idempotencyKey: `calendar:${visit.id}:3:CALENDAR_CANCEL`, status: 'PENDING', availableAt: now,
            },
          }),
        ])
      }
      return assignments
    }
    const adapter = new FakeInstallationCalendarAdapter()
    try {
      expect(await processInstallationCalendarJob(dbA, adapter, oldJob!, now)).toMatchObject({ outcome: 'FENCED' })
    } finally {
      assignmentsDelegate.findMany = originalFindMany
    }

    expect(injected).toBe(true)
    expect(adapter.snapshot()).toHaveLength(0)
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: oldQueued.id } }))
      .toMatchObject({ status: 'PROCESSING', attemptCount: 0 })
    const cancelJob = await claimNextIntegrationJob(dbA, now, 'worker-race-cancel')
    expect(await processInstallationCalendarJob(dbA, adapter, cancelJob!, now)).toMatchObject({ outcome: 'COMPLETED' })
    expect(adapter.snapshot()).toHaveLength(0)
    await dbA.integrationOutbox.update({ where: { id: oldQueued.id }, data: { status: 'COMPLETED', completedAt: now, lockedUntil: null } })
  })

  it('fences visit and scope mutations throughout adapter I/O, then permits a retry after completion', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { order, visit, job: queuedJob, scope } = await createOutboxFixture()
    const job = await claimNextIntegrationJob(dbA, now, 'worker-held-io')
    let adapterEntered!: () => void
    let releaseAdapter!: () => void
    const enteredAdapter = new Promise<void>((resolve) => { adapterEntered = resolve })
    const waitForRelease = new Promise<void>((resolve) => { releaseAdapter = resolve })
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => {
        adapterEntered()
        await waitForRelease
        return { eventId: `held-${visit.id}`, htmlLink: `https://calendar.example.test/${visit.id}`, etag: 'held-etag' }
      },
      cancel: async () => undefined,
    }

    const processing = processInstallationCalendarJob(dbA, adapter, job!, now)
    await enteredAdapter

    await expect(changeInstallationVisit(dbB, order.id, visit.id, { action: 'CANCEL', expectedRevision: 2 }, 'outbox-fixture'))
      .rejects.toBeInstanceOf(InstallationVisitSyncInProgressError)
    await expect(setScopeInstallerAssignments(dbB, order.id, scope.id, ['outbox-installer-b'], 'outbox-fixture'))
      .rejects.toBeInstanceOf(InstallationVisitSyncInProgressError)
    expect(await dbA.installationVisit.findUniqueOrThrow({ where: { id: visit.id } }))
      .toMatchObject({ revision: 2, status: 'CONFIRMED' })
    expect(await dbA.installationScopeAssignment.findMany({ where: { orderId: order.id, scopeId: scope.id } }))
      .toMatchObject([{ employeeId: 'outbox-installer' }])
    expect(await dbA.integrationOutbox.count({ where: { visitId: visit.id } })).toBe(1)

    releaseAdapter()
    expect(await processing).toMatchObject({ outcome: 'COMPLETED', outboxId: queuedJob.id })
    await expect(changeInstallationVisit(dbB, order.id, visit.id, { action: 'CANCEL', expectedRevision: 2 }, 'outbox-fixture'))
      .resolves.toMatchObject({ revision: 3, status: 'CANCELLED' })
    await dbA.integrationOutbox.updateMany({
      where: { visitId: visit.id },
      data: { status: 'COMPLETED', lockedUntil: null, completedAt: now },
    })
  })

  it('keeps a mutation blocked after lease expiry until another worker reclaims and completes it', async () => {
    const now = new Date()
    const { order, visit } = await createOutboxFixture({ availableAt: now })
    const job = await claimNextIntegrationJob(dbA, now, 'worker-expired-mutation')
    await dbA.integrationOutbox.update({
      where: { id: job!.id },
      data: { lockedUntil: new Date(now.getTime() - 1) },
    })

    let adapterCalls = 0
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { adapterCalls += 1; return { eventId: 'unexpected', htmlLink: 'https://calendar.example.test/unexpected', etag: 'unexpected' } },
      cancel: async () => { adapterCalls += 1 },
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'FENCED' })
    expect(adapterCalls).toBe(0)
    await expect(changeInstallationVisit(dbB, order.id, visit.id, { action: 'CANCEL', expectedRevision: 2 }, 'outbox-fixture'))
      .rejects.toBeInstanceOf(InstallationVisitSyncInProgressError)
    const recovered = await claimNextIntegrationJob(dbB, new Date(now.getTime() + 1), 'worker-reclaimed-mutation')
    expect(await processInstallationCalendarJob(dbB, new FakeInstallationCalendarAdapter(), recovered!, new Date(now.getTime() + 1)))
      .toMatchObject({ outcome: 'COMPLETED' })
    await expect(changeInstallationVisit(dbB, order.id, visit.id, { action: 'CANCEL', expectedRevision: 2 }, 'outbox-fixture'))
      .resolves.toMatchObject({ revision: 3, status: 'CANCELLED' })
    await dbA.integrationOutbox.updateMany({
      where: { visitId: visit.id },
      data: { status: 'COMPLETED', lockedUntil: null, completedAt: now },
    })
  })

  it('heartbeats a held adapter lease past its original expiry and permits one mutation only after success', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const now = new Date('2026-09-14T10:01:00.000Z')
    vi.setSystemTime(now)
    try {
      const { order, visit, job: queuedJob, scope } = await createOutboxFixture({ availableAt: now })
      const job = await claimNextIntegrationJob(dbA, now, 'worker-heartbeat')
      let adapterEntered!: () => void
      let releaseAdapter!: () => void
      const enteredAdapter = new Promise<void>((resolve) => { adapterEntered = resolve })
      const waitForRelease = new Promise<void>((resolve) => { releaseAdapter = resolve })
      const adapter: InstallationCalendarAdapter = {
        upsert: async () => {
          adapterEntered()
          await waitForRelease
          return { eventId: `heartbeat-${visit.id}`, htmlLink: `https://calendar.example.test/${visit.id}`, etag: 'heartbeat-etag' }
        },
        cancel: async () => undefined,
      }

      const processing = processInstallationCalendarJob(dbA, adapter, job!)
      await enteredAdapter
      await vi.advanceTimersByTimeAsync(INTEGRATION_OUTBOX_LEASE_MS + 1)

      const renewed = await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } })
      expect(renewed.lockedUntil!.getTime()).toBeGreaterThan(now.getTime() + INTEGRATION_OUTBOX_LEASE_MS)
      await dbA.integrationOutbox.updateMany({
        where: { status: 'RETRY' },
        data: { availableAt: new Date('2030-01-01T00:00:00.000Z') },
      })
      expect(await claimNextIntegrationJob(dbB, new Date())).toBeNull()
      await expect(changeInstallationVisit(dbB, order.id, visit.id, { action: 'CANCEL', expectedRevision: 2 }, 'outbox-fixture'))
        .rejects.toBeInstanceOf(InstallationVisitSyncInProgressError)
      await expect(setScopeInstallerAssignments(dbB, order.id, scope.id, ['outbox-installer-b'], 'outbox-fixture'))
        .rejects.toBeInstanceOf(InstallationVisitSyncInProgressError)

      releaseAdapter()
      expect(await processing).toMatchObject({ outcome: 'COMPLETED', outboxId: queuedJob.id })
      expect(await dbA.integrationAttempt.findMany({ where: { outboxId: queuedJob.id } }))
        .toMatchObject([{ number: 1, outcome: 'SUCCESS' }])
      await expect(changeInstallationVisit(dbB, order.id, visit.id, { action: 'CANCEL', expectedRevision: 2 }, 'outbox-fixture'))
        .resolves.toMatchObject({ revision: 3, status: 'CANCELLED' })
      await dbA.integrationOutbox.updateMany({
        where: { visitId: visit.id },
        data: { status: 'COMPLETED', lockedUntil: null, completedAt: new Date() },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps heartbeat fencing on the supplied worker clock instead of moving a future lease backward', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const wallClockNow = new Date('2026-09-14T10:01:00.000Z')
    const suppliedNow = new Date('2032-09-14T10:01:00.000Z')
    vi.setSystemTime(wallClockNow)
    let visitId: string | null = null
    let processing: Promise<unknown> | null = null
    let releaseAdapter: (() => void) | null = null
    let restoreExecuteRaw: (() => void) | null = null
    try {
      const fixture = await createOutboxFixture({ availableAt: suppliedNow })
      visitId = fixture.visit.id
      await dbA.integrationOutbox.updateMany({
        where: { id: { not: fixture.job.id }, status: { in: ['PENDING', 'RETRY'] } },
        data: { availableAt: new Date('2100-01-01T00:00:00.000Z') },
      })
      const job = await claimNextIntegrationJob(dbA, suppliedNow, 'worker-supplied-clock')
      let adapterEntered!: () => void
      const enteredAdapter = new Promise<void>((resolve) => { adapterEntered = resolve })
      const waitForRelease = new Promise<void>((resolve) => { releaseAdapter = resolve })
      const adapter: InstallationCalendarAdapter = {
        upsert: async () => {
          adapterEntered()
          await waitForRelease
          return { eventId: `clock-${fixture.visit.id}`, htmlLink: `https://calendar.example.test/${fixture.visit.id}`, etag: 'clock-etag' }
        },
        cancel: async () => undefined,
      }

      // Fake timers await the interval callback, but not necessarily the
      // asynchronous SQLite write it starts. Observe the second lease UPDATE
      // (the first is the immediate pre-I/O fence) through its completion.
      const rawExecuteClient = dbA as unknown as {
        $executeRaw: (...args: unknown[]) => Promise<number>
      }
      const originalExecuteRaw = rawExecuteClient.$executeRaw
      const executeRaw = originalExecuteRaw.bind(dbA)
      let leaseUpdates = 0
      let resolveHeartbeatWrite!: () => void
      const heartbeatWriteCommitted = new Promise<void>((resolve) => { resolveHeartbeatWrite = resolve })
      rawExecuteClient.$executeRaw = async (...args) => {
        const result = await executeRaw(...args)
        leaseUpdates += 1
        if (leaseUpdates === 2) resolveHeartbeatWrite()
        return result
      }
      restoreExecuteRaw = () => { rawExecuteClient.$executeRaw = originalExecuteRaw }

      processing = processInstallationCalendarJob(dbA, adapter, job!, suppliedNow)
      await enteredAdapter
      await vi.advanceTimersByTimeAsync(Math.floor(INTEGRATION_OUTBOX_LEASE_MS / 3) + 1)
      await heartbeatWriteCommitted
      restoreExecuteRaw()
      restoreExecuteRaw = null

      const renewed = await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: fixture.job.id } })
      expect(renewed.lockedUntil!.getTime()).toBeGreaterThan(suppliedNow.getTime() + INTEGRATION_OUTBOX_LEASE_MS)
      releaseAdapter()
      await expect(processing).resolves.toMatchObject({ outcome: 'COMPLETED' })
      expect(await dbA.integrationAttempt.findMany({ where: { outboxId: fixture.job.id } }))
        .toMatchObject([{ number: 1, outcome: 'SUCCESS' }])
    } finally {
      restoreExecuteRaw?.()
      releaseAdapter?.()
      if (processing) await processing
      if (visitId) {
        await dbA.integrationOutbox.updateMany({
          where: { visitId },
          data: { status: 'COMPLETED', lockedUntil: null, completedAt: new Date() },
        })
      }
      vi.useRealTimers()
    }
  })

  it('leaves a heartbeat fence-loss job processing for reclaim without recording its stale adapter result', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const now = new Date('2026-09-14T11:01:00.000Z')
    vi.setSystemTime(now)
    try {
      const { order, visit, job: queuedJob } = await createOutboxFixture({ availableAt: now })
      const job = await claimNextIntegrationJob(dbA, now, 'worker-heartbeat-lost')
      let adapterEntered!: () => void
      let releaseAdapter!: () => void
      const enteredAdapter = new Promise<void>((resolve) => { adapterEntered = resolve })
      const waitForRelease = new Promise<void>((resolve) => { releaseAdapter = resolve })
      const adapter: InstallationCalendarAdapter = {
        upsert: async () => {
          adapterEntered()
          await waitForRelease
          return { eventId: `lost-${visit.id}`, htmlLink: `https://calendar.example.test/${visit.id}`, etag: 'lost-etag' }
        },
        cancel: async () => undefined,
      }

      const processing = processInstallationCalendarJob(dbA, adapter, job!)
      await enteredAdapter
      await dbA.integrationOutbox.update({
        where: { id: queuedJob.id },
        data: { lockedUntil: new Date(now.getTime() - 1) },
      })
      await vi.advanceTimersByTimeAsync(Math.floor(INTEGRATION_OUTBOX_LEASE_MS / 3) + 1)
      releaseAdapter()

      expect(await processing).toMatchObject({ outcome: 'FENCED', outboxId: queuedJob.id })
      expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
        .toMatchObject({ status: 'PROCESSING', attemptCount: 0 })
      expect(await dbA.integrationAttempt.count({ where: { outboxId: queuedJob.id } })).toBe(0)
      await expect(changeInstallationVisit(dbB, order.id, visit.id, { action: 'CANCEL', expectedRevision: 2 }, 'outbox-fixture'))
        .rejects.toBeInstanceOf(InstallationVisitSyncInProgressError)

      await dbA.integrationOutbox.updateMany({
        where: { status: 'RETRY' },
        data: { availableAt: new Date('2030-01-01T00:00:00.000Z') },
      })
      const reclaimed = await claimNextIntegrationJob(dbB, new Date(), 'worker-heartbeat-reclaimed')
      expect(reclaimed).toMatchObject({ id: queuedJob.id })
      expect(await processInstallationCalendarJob(dbB, new FakeInstallationCalendarAdapter(), reclaimed!))
        .toMatchObject({ outcome: 'COMPLETED' })
      await expect(changeInstallationVisit(dbB, order.id, visit.id, { action: 'CANCEL', expectedRevision: 2 }, 'outbox-fixture'))
        .resolves.toMatchObject({ revision: 3, status: 'CANCELLED' })
      await dbA.integrationOutbox.updateMany({
        where: { visitId: visit.id },
        data: { status: 'COMPLETED', lockedUntil: null, completedAt: new Date() },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts incomplete calendar projection data into ATTENTION without calling an adapter', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { job: queuedJob } = await createOutboxFixture({ hasReadyParticipant: false })
    const job = await claimNextIntegrationJob(dbA, now, 'worker-invalid-projection')
    let calls = 0
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { calls += 1; return { eventId: 'unexpected', htmlLink: 'https://calendar.example.test/unexpected', etag: 'unexpected' } },
      cancel: async () => { calls += 1 },
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'ATTENTION' })
    expect(calls).toBe(0)
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
      .toMatchObject({ status: 'DEAD', lastErrorCode: 'DOMAIN_DATA_INVALID' })
  })

  it('updates the same stable calendar event after a newer visit revision', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: firstQueued } = await createOutboxFixture()
    const adapter = new FakeInstallationCalendarAdapter()
    const firstJob = await claimNextIntegrationJob(dbA, now, 'worker-create')
    await processInstallationCalendarJob(dbA, adapter, firstJob!, now)

    await dbA.installationVisit.update({
      where: { id: visit.id },
      data: { revision: 3, startsAt: new Date('2026-09-15T06:00:00.000Z'), endsAt: new Date('2026-09-15T14:00:00.000Z') },
    })
    const updateQueued = await dbA.integrationOutbox.create({
      data: {
        id: `${firstQueued.id}-update`, visitId: visit.id, revision: 3, operation: 'CALENDAR_UPSERT',
        idempotencyKey: `calendar:${visit.id}:3:CALENDAR_UPSERT`, status: 'PENDING', availableAt: now,
      },
    })
    const updateJob = await claimNextIntegrationJob(dbA, now, 'worker-update')
    await processInstallationCalendarJob(dbA, adapter, updateJob!, now)

    expect(adapter.snapshot()).toHaveLength(1)
    expect(adapter.snapshot()[0]).toMatchObject({ event: { visitId: visit.id, start: { dateTime: '2026-09-15T06:00:00.000Z' } } })
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: updateQueued.id } }))
      .toMatchObject({ status: 'COMPLETED', attemptCount: 1 })
  })

  it('cancels a deterministic remote event even when the local external id was never persisted', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: queuedJob } = await createOutboxFixture({ operation: 'CALENDAR_CANCEL' })
    const adapter = new FakeInstallationCalendarAdapter()
    await adapter.upsert({
      event: {
        visitId: visit.id,
        summary: 'Montaż po niepewnym wyniku sieciowym',
        location: 'Kalendarzowa 1, Warszawa',
        description: 'Karta montażu',
        start: { dateTime: '2026-09-14T06:00:00.000Z', timeZone: 'Europe/Warsaw' },
        end: { dateTime: '2026-09-14T14:00:00.000Z', timeZone: 'Europe/Warsaw' },
        attendeeEmails: ['outbox.installer@example.test'],
        privateProperties: { wallDecorVisitId: visit.id },
      },
      externalId: null,
      etag: null,
      forceOverwrite: false,
    })
    expect(await dbA.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } }))
      .toMatchObject({ externalId: null })
    const job = await claimNextIntegrationJob(dbA, now, 'worker-cancel-null')

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'COMPLETED' })
    expect(adapter.snapshot()).toMatchObject([{ event: { visitId: visit.id }, cancelled: true }])
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } })).toMatchObject({ status: 'COMPLETED' })
    expect(await dbA.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } }))
      .toMatchObject({ status: 'SYNCED', externalId: null })
    expect(await dbA.integrationAttempt.findMany({ where: { outboxId: queuedJob.id } }))
      .toMatchObject([{ number: 1, outcome: 'SUCCESS' }])
  })

  it('cancels the persisted external event with its visit fencing identity', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: createQueued } = await createOutboxFixture()
    const adapter = new FakeInstallationCalendarAdapter()
    const createJob = await claimNextIntegrationJob(dbA, now, 'worker-cancel-create')
    await processInstallationCalendarJob(dbA, adapter, createJob!, now)
    await dbA.installationVisit.update({
      where: { id: visit.id },
      data: { status: 'CANCELLED', revision: 3, startsAt: null, endsAt: null },
    })
    await dbA.installationVisitScope.deleteMany({ where: { visitId: visit.id } })
    const cancelQueued = await dbA.integrationOutbox.create({
      data: {
        id: `${createQueued.id}-cancel`, visitId: visit.id, revision: 3, operation: 'CALENDAR_CANCEL',
        idempotencyKey: `calendar:${visit.id}:3:CALENDAR_CANCEL`, status: 'PENDING', availableAt: now,
      },
    })
    const cancelJob = await claimNextIntegrationJob(dbA, now, 'worker-cancel')

    expect(await processInstallationCalendarJob(dbA, adapter, cancelJob!, now)).toMatchObject({ outcome: 'COMPLETED' })
    expect(adapter.snapshot()).toMatchObject([{ eventId: adapter.snapshot()[0].eventId, cancelled: true }])
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: cancelQueued.id } })).toMatchObject({ status: 'COMPLETED' })
    expect(await dbA.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } }))
      .toMatchObject({
        status: 'SYNCED',
        // Keep the deterministic identity for a repeat cancel, but never retain
        // a clickable URL or a version token for a deleted remote event.
        externalId: adapter.snapshot()[0].eventId,
        externalUrl: null,
        externalEtag: null,
      })
    expect(await dbA.integrationAttempt.findMany({ where: { outboxId: cancelQueued.id } }))
      .toMatchObject([{ number: 1, outcome: 'SUCCESS' }])
  })

  it('treats unknown adapter failures as safe internal attention without error leakage', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: queuedJob } = await createOutboxFixture()
    const job = await claimNextIntegrationJob(dbA, now, 'worker-unknown')
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { throw new Error('X-Api-Key: hidden-secret@example.test') },
      cancel: async () => undefined,
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'ATTENTION' })
    const outbox = await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } })
    const sync = await dbA.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } })
    expect(outbox).toMatchObject({ status: 'DEAD', lastErrorCode: 'INTERNAL_ERROR' })
    expect(`${outbox.lastErrorMessage}\n${sync.lastErrorMessage}`).not.toContain('hidden-secret')
    expect(outbox.lastErrorMessage?.length).toBeLessThanOrEqual(500)
  })

  it('uses only a normalized HTTPS application origin in the calendar event link', async () => {
    const previous = process.env.NEXTAUTH_URL
    process.env.NEXTAUTH_URL = 'http://user:password@unsafe.example.test/internal'
    try {
      const now = new Date('2026-09-14T10:01:00.000Z')
      await createOutboxFixture()
      const job = await claimNextIntegrationJob(dbA, now, 'worker-origin')
      const adapter = new FakeInstallationCalendarAdapter()
      await processInstallationCalendarJob(dbA, adapter, job!, now)
      expect(adapter.snapshot()[0].event.description).toContain('https://app.walldecor.pl/installations/')
      expect(adapter.snapshot()[0].event.description).not.toContain('unsafe.example.test')
    } finally {
      if (previous === undefined) delete process.env.NEXTAUTH_URL
      else process.env.NEXTAUTH_URL = previous
    }
  })

  it('puts a visit without a date range into ATTENTION without an adapter side effect', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { job: queuedJob } = await createOutboxFixture({ startsAt: null, endsAt: null })
    const job = await claimNextIntegrationJob(dbA, now, 'worker-no-dates')
    let calls = 0
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { calls += 1; return { eventId: 'unexpected', htmlLink: 'https://calendar.example.test/unexpected', etag: 'unexpected' } },
      cancel: async () => { calls += 1 },
    }

    expect(await processInstallationCalendarJob(dbA, adapter, job!, now)).toMatchObject({ outcome: 'ATTENTION' })
    expect(calls).toBe(0)
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
      .toMatchObject({ status: 'DEAD', lastErrorCode: 'DOMAIN_DATA_INVALID' })
  })

  it('requeues the same conflict record with force and uses its next attempt number', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { order, visit, job: queuedJob } = await createOutboxFixture()
    const conflictJob = await claimNextIntegrationJob(dbA, now, 'worker-force-conflict')
    const conflictAdapter: InstallationCalendarAdapter = {
      upsert: async () => { throw new CalendarConflictError() },
      cancel: async () => undefined,
    }
    await processInstallationCalendarJob(dbA, conflictAdapter, conflictJob!, now)
    await requeueInstallationCalendar(dbA, order.id, visit.id, true, 'manager-1')
    const retryJob = await claimNextIntegrationJob(dbA, now, 'worker-force-retry')
    let receivedForce: boolean | null = null
    const forceAdapter: InstallationCalendarAdapter = {
      upsert: async (input) => {
        receivedForce = input.forceOverwrite
        return { eventId: 'force-event', htmlLink: 'https://calendar.example.test/force-event', etag: 'force-etag' }
      },
      cancel: async () => undefined,
    }

    expect(retryJob).toMatchObject({ id: queuedJob.id, forceOverwrite: true, attemptCount: 1 })
    expect(await processInstallationCalendarJob(dbA, forceAdapter, retryJob!, now)).toMatchObject({ outcome: 'COMPLETED' })
    expect(receivedForce).toBe(true)
    expect(await dbA.integrationAttempt.findMany({ where: { outboxId: queuedJob.id }, orderBy: { number: 'asc' } }))
      .toMatchObject([{ number: 1, outcome: 'ATTENTION' }, { number: 2, outcome: 'SUCCESS' }])
  })

  it('does not let an expired worker lease overwrite a newer claim', async () => {
    const startedAt = new Date('2026-09-14T10:01:00.000Z')
    const recoveredAt = new Date('2026-09-14T10:07:00.000Z')
    await dbA.integrationOutbox.updateMany({ where: { status: 'RETRY' }, data: { availableAt: new Date('2030-01-01T00:00:00.000Z') } })
    const { job: queuedJob } = await createOutboxFixture()
    const oldLease = await claimNextIntegrationJob(dbA, startedAt, 'worker-old-lease')
    const newLease = await claimNextIntegrationJob(dbB, recoveredAt, 'worker-new-lease')
    const adapter = new FakeInstallationCalendarAdapter()

    expect(oldLease).toMatchObject({ id: queuedJob.id })
    expect(newLease).toMatchObject({ id: queuedJob.id, workerId: 'worker-new-lease' })
    expect(await processInstallationCalendarJob(dbA, adapter, oldLease!, recoveredAt)).toMatchObject({ outcome: 'FENCED' })
    expect(adapter.snapshot()).toHaveLength(0)
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
      .toMatchObject({ status: 'PROCESSING', lockedUntil: newLease?.lockedUntil, attemptCount: 0 })
    expect(await dbA.integrationAttempt.count({ where: { outboxId: queuedJob.id } })).toBe(0)
  })

  it('persists a completed worker result across a newly constructed Prisma client', async () => {
    const now = new Date('2026-09-14T10:01:00.000Z')
    const { visit, job: queuedJob } = await createOutboxFixture()
    const job = await claimNextIntegrationJob(dbA, now, 'worker-reconnect')
    await processInstallationCalendarJob(dbA, new FakeInstallationCalendarAdapter(), job!, now)
    const reopened = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    try {
      expect(await reopened.integrationOutbox.findUniqueOrThrow({ where: { id: queuedJob.id } }))
        .toMatchObject({ status: 'COMPLETED', attemptCount: 1 })
      expect(await reopened.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: visit.id, kind: 'GOOGLE_CALENDAR' } } }))
        .toMatchObject({ status: 'SYNCED', lastSyncedAt: now })
    } finally {
      await reopened.$disconnect()
    }
  })

  it('processes a finite batch and stops after a retry becomes unavailable', async () => {
    const { job } = await createOutboxFixture({ id: 'batch-retry-job', availableAt: new Date('2000-01-01T00:00:00.000Z') })
    const adapter: InstallationCalendarAdapter = {
      upsert: async () => { throw new CalendarRetryableError('429') },
      cancel: async () => undefined,
    }

    await expect(processInstallationCalendarBatch(dbA, adapter, 2)).resolves.toEqual({ claimed: 1, completed: 0, retried: 1, attention: 0 })
    expect(await dbA.integrationOutbox.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'RETRY', attemptCount: 1 })
  })
})
