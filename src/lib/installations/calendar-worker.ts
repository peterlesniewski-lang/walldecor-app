import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@/generated/prisma'
import {
  CalendarConfigurationError,
  CalendarConflictError,
  CalendarRetryableError,
  type CalendarWriteResult,
  type InstallationCalendarAdapter,
} from './calendar-adapter'
import { buildCalendarEvent, type CalendarEventParticipant, type CalendarEventProjectionInput } from './calendar-event'
import { claimNextIntegrationJob, INTEGRATION_OUTBOX_LEASE_MS, type ClaimedIntegrationJob } from './integration-outbox'

const CALENDAR_KIND = 'GOOGLE_CALENDAR'
const LEASE_HEARTBEAT_MS = Math.max(1_000, Math.floor(INTEGRATION_OUTBOX_LEASE_MS / 3))
const SAFE_MESSAGES = {
  stale: 'Pominięto nieaktualne zadanie synchronizacji kalendarza.',
  invalidData: 'Wizyta nie ma kompletnych danych wymaganych do synchronizacji kalendarza.',
  retry: 'Tymczasowy problem z kalendarzem. Synchronizacja zostanie ponowiona automatycznie.',
  conflict: 'Wydarzenie w kalendarzu zostało zmienione poza aplikacją. Wymagane jest świadome ponowienie synchronizacji.',
  configuration: 'Integracja z kalendarzem wymaga konfiguracji lub uprawnień administratora.',
  internal: 'Synchronizacja kalendarza nie powiodła się. Spróbuj ponownie po sprawdzeniu konfiguracji.',
} as const

type CalendarProjection = {
  revision: number
  event: CalendarEventProjectionInput
}

type WorkerClock = {
  now(): Date
  advanceForHeartbeat(): Date
}

type FinalState = {
  status: 'COMPLETED' | 'RETRY' | 'DEAD'
  availableAt: Date
  completedAt: Date | null
  errorCode: string | null
  errorMessage: string | null
  attemptOutcome: 'SUCCESS' | 'RETRY' | 'ATTENTION' | 'STALE'
  sync: {
    status: 'PENDING' | 'SYNCED' | 'ATTENTION'
    externalId?: string | null
    externalUrl?: string | null
    externalEtag?: string | null
    lastSyncedAt?: Date | null
  } | null
}

export type ProcessJobResult = {
  outboxId: string
  outcome: 'COMPLETED' | 'RETRIED' | 'ATTENTION' | 'STALE' | 'FENCED'
}

export type BatchResult = {
  claimed: number
  completed: number
  retried: number
  attention: number
}

function calendarBaseUrl(): string {
  const fallback = 'https://app.walldecor.pl'
  const candidate = process.env.NEXTAUTH_URL?.trim()
  if (!candidate) return fallback
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) return fallback
    return parsed.origin
  } catch {
    return fallback
  }
}

function orderUrl(orderId: string): string {
  return `${calendarBaseUrl()}/installations/${encodeURIComponent(orderId)}`
}

function normalizedEmail(value: string): string | null {
  const email = value.trim()
  return email.length > 0 ? email : null
}

/**
 * `now` is a deterministic base for callers and tests. Heartbeats advance
 * that base by non-decreasing elapsed wall time, while production calls with
 * no supplied base continue to use current wall time for every fence.
 */
function createWorkerClock(now?: Date): WorkerClock {
  if (!now) {
    return {
      now: () => new Date(),
      advanceForHeartbeat: () => new Date(),
    }
  }

  const baseMs = now.getTime()
  const startedAt = Date.now()
  let elapsedMs = 0
  const advance = () => {
    elapsedMs = Math.max(elapsedMs, Math.max(0, Date.now() - startedAt))
    return new Date(baseMs + elapsedMs)
  }

  return {
    now: () => new Date(baseMs + elapsedMs),
    advanceForHeartbeat: advance,
  }
}

async function loadCalendarProjection(db: PrismaClient, job: ClaimedIntegrationJob): Promise<CalendarProjection | null> {
  const visit = await db.installationVisit.findUnique({
    where: { id: job.visitId },
    select: {
      id: true,
      revision: true,
      startsAt: true,
      endsAt: true,
      order: {
        select: {
          id: true,
          number: true,
          addressStreet: true,
          addressBuildingNumber: true,
          addressApartmentNumber: true,
          addressPostalCode: true,
          addressCity: true,
          client: { select: { name: true } },
        },
      },
      scopes: {
        select: {
          scopeId: true,
          scope: { select: { name: true, room: { select: { name: true } } } },
        },
      },
    },
  })
  if (!visit || visit.revision !== job.revision || !visit.startsAt || !visit.endsAt) return null

  const scopeIds = visit.scopes.map((scope) => scope.scopeId)
  const assignments = scopeIds.length === 0
    ? []
    : await db.installationScopeAssignment.findMany({
      where: { orderId: visit.order.id, scopeId: { in: scopeIds }, employee: { active: true } },
      select: { employee: { select: { email: true } } },
    })
  const participants: CalendarEventParticipant[] = assignments.map((assignment) => {
    const email = normalizedEmail(assignment.employee.email)
    return { email, inviteStatus: email ? 'READY' : 'MISSING_EMAIL' }
  })
  if (!participants.some((participant) => participant.inviteStatus === 'READY')) return null

  return {
    revision: visit.revision,
    event: {
      id: visit.id,
      startsAt: visit.startsAt,
      endsAt: visit.endsAt,
      orderUrl: orderUrl(visit.order.id),
      order: {
        number: visit.order.number,
        clientName: visit.order.client.name,
        addressStreet: visit.order.addressStreet,
        addressBuildingNumber: visit.order.addressBuildingNumber,
        addressApartmentNumber: visit.order.addressApartmentNumber,
        addressPostalCode: visit.order.addressPostalCode,
        addressCity: visit.order.addressCity,
      },
      scopes: visit.scopes.map((scope) => ({ roomName: scope.scope.room.name, name: scope.scope.name })),
      participants,
    },
  }
}

function boundedMessage(message: string): string {
  return message.slice(0, 500)
}

function retryDelaySeconds(outboxId: string, priorAttemptCount: number): number {
  const base = Math.min(3600, (2 ** priorAttemptCount) * 15)
  let hash = 2166136261
  for (const character of outboxId) {
    hash ^= character.codePointAt(0)!
    hash = Math.imul(hash, 16777619)
  }
  const jitterUpperBound = Math.max(1, Math.floor(base / 10))
  const jitter = (hash >>> 0) % (jitterUpperBound + 1)
  return Math.min(3600, base + jitter)
}

function calendarErrorKind(error: unknown): 'RETRY' | 'CONFLICT' | 'CONFIGURATION' | 'INTERNAL' {
  if (error instanceof CalendarRetryableError) return 'RETRY'
  if (error instanceof CalendarConflictError) return 'CONFLICT'
  if (error instanceof CalendarConfigurationError) return 'CONFIGURATION'
  if (typeof error !== 'object' || error === null) return 'INTERNAL'
  const candidate = error as { code?: unknown; status?: unknown }
  const code = String(candidate.code ?? candidate.status ?? '').toUpperCase()
  if (code === '429' || code === 'RATE_LIMIT' || code === 'TOO_MANY_REQUESTS') return 'RETRY'
  if (code === '401' || code === '403' || code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return 'CONFIGURATION'
  return 'INTERNAL'
}

function safeRetryErrorCode(error: unknown): string {
  if (!(error instanceof CalendarRetryableError)) return 'RATE_LIMIT'
  const code = error.code.trim().toUpperCase()
  return ['429', 'RATE_LIMIT', 'TOO_MANY_REQUESTS', 'TIMEOUT', 'NETWORK_ERROR'].includes(code)
    ? code
    : 'RETRYABLE_ERROR'
}

function fencedWhere(job: ClaimedIntegrationJob, now: Date): Prisma.IntegrationOutboxWhereInput {
  return {
    id: job.id,
    status: 'PROCESSING',
    lockedUntil: { equals: job.lockedUntil, gt: now },
  }
}

/**
 * Refuses a lease that was already reclaimed, and refreshes the fencing token
 * immediately before any adapter side effect. A slow adapter is still fenced
 * at final persistence; a worker that has already lost its lease does no I/O.
 */
async function renewCurrentLease(
  db: PrismaClient,
  job: ClaimedIntegrationJob,
  now: Date,
): Promise<ClaimedIntegrationJob | null> {
  const lockedUntil = new Date(now.getTime() + INTEGRATION_OUTBOX_LEASE_MS)
  const renewed = await db.$executeRaw`
    UPDATE "IntegrationOutbox"
    SET "lockedUntil" = ${lockedUntil},
        "updatedAt" = ${now}
    WHERE "id" = ${job.id}
      AND "status" = 'PROCESSING'
      AND "lockedUntil" = ${job.lockedUntil}
      AND "lockedUntil" > ${now}
      AND EXISTS (
        SELECT 1
        FROM "InstallationVisit"
        WHERE "InstallationVisit"."id" = "IntegrationOutbox"."visitId"
          AND "InstallationVisit"."revision" = ${job.revision}
      )
  `
  return renewed === 1 ? { ...job, lockedUntil } : null
}

type LeaseHeartbeat = {
  stop(): Promise<ClaimedIntegrationJob | null>
}

/**
 * Keeps the fencing token fresh throughout adapter I/O. Adapters must impose
 * their own hard I/O timeout well below the five-minute lease; a lost or
 * indeterminate heartbeat intentionally leaves the job PROCESSING for a
 * later worker to reclaim rather than writing an unsafe final state.
 */
function startLeaseHeartbeat(db: PrismaClient, initialJob: ClaimedIntegrationJob, clock: WorkerClock): LeaseHeartbeat {
  let currentJob = initialJob
  let lostFence = false
  let inFlight: Promise<void> | null = null

  const beat = () => {
    if (lostFence || inFlight) return
    const renewal = (async () => {
      try {
        const renewed = await renewCurrentLease(db, currentJob, clock.advanceForHeartbeat())
        if (renewed) currentJob = renewed
        else lostFence = true
      } catch {
        lostFence = true
      }
    })()
    inFlight = renewal
    void renewal.finally(() => {
      if (inFlight === renewal) inFlight = null
    })
  }

  const timer = setInterval(beat, LEASE_HEARTBEAT_MS)
  return {
    async stop() {
      clearInterval(timer)
      await inFlight
      return lostFence ? null : currentJob
    },
  }
}

function staleFinalState(now: Date): FinalState {
  return {
    status: 'COMPLETED', availableAt: now, completedAt: now,
    errorCode: 'STALE', errorMessage: boundedMessage(SAFE_MESSAGES.stale),
    attemptOutcome: 'STALE', sync: null,
  }
}

/** Persists only while this precise lease is current; side effects happen before this transaction. */
async function persistFinalState(
  db: PrismaClient,
  job: ClaimedIntegrationJob,
  now: Date,
  durationMs: number,
  desired: FinalState,
): Promise<'APPLIED' | 'STALE' | 'FENCED'> {
  return db.$transaction(async (tx) => {
    const currentVisit = await tx.installationVisit.findUnique({ where: { id: job.visitId }, select: { revision: true } })
    const state = !currentVisit || currentVisit.revision !== job.revision ? staleFinalState(now) : desired
    const attemptNumber = job.attemptCount + 1
    const changed = await tx.integrationOutbox.updateMany({
      where: fencedWhere(job, now),
      data: {
        status: state.status,
        attemptCount: attemptNumber,
        availableAt: state.availableAt,
        lockedUntil: null,
        completedAt: state.completedAt,
        lastErrorCode: state.errorCode,
        lastErrorMessage: state.errorMessage,
      },
    })
    if (changed.count !== 1) return 'FENCED'
    await tx.integrationAttempt.create({
      data: {
        outboxId: job.id, number: attemptNumber, outcome: state.attemptOutcome,
        errorCode: state.errorCode, durationMs: Math.max(0, Math.floor(durationMs)),
      },
    })
    if (state.sync) {
      await tx.integrationSyncState.upsert({
        where: { visitId_kind: { visitId: job.visitId, kind: CALENDAR_KIND } },
        create: {
          visitId: job.visitId, kind: CALENDAR_KIND, status: state.sync.status,
          externalId: state.sync.externalId ?? null,
          externalUrl: state.sync.externalUrl ?? null,
          externalEtag: state.sync.externalEtag ?? null,
          lastErrorCode: state.errorCode, lastErrorMessage: state.errorMessage,
          lastAttemptAt: now, lastSyncedAt: state.sync.lastSyncedAt ?? null,
        },
        update: {
          status: state.sync.status,
          ...(state.sync.externalId === undefined ? {} : { externalId: state.sync.externalId }),
          ...(state.sync.externalUrl === undefined ? {} : { externalUrl: state.sync.externalUrl }),
          ...(state.sync.externalEtag === undefined ? {} : { externalEtag: state.sync.externalEtag }),
          lastErrorCode: state.errorCode, lastErrorMessage: state.errorMessage, lastAttemptAt: now,
          ...(state.sync.lastSyncedAt === undefined ? {} : { lastSyncedAt: state.sync.lastSyncedAt }),
        },
      })
    }
    return state === desired ? 'APPLIED' : 'STALE'
  })
}

function successState(now: Date, write: CalendarWriteResult | null): FinalState {
  return {
    status: 'COMPLETED', availableAt: now, completedAt: now,
    errorCode: null, errorMessage: null, attemptOutcome: 'SUCCESS',
    sync: { status: 'SYNCED', ...(write ? { externalId: write.eventId, externalUrl: write.htmlLink, externalEtag: write.etag } : {}), lastSyncedAt: now },
  }
}

function retryState(job: ClaimedIntegrationJob, now: Date, code: string): FinalState {
  return {
    status: 'RETRY', availableAt: new Date(now.getTime() + retryDelaySeconds(job.id, job.attemptCount) * 1000), completedAt: null,
    errorCode: code, errorMessage: boundedMessage(SAFE_MESSAGES.retry), attemptOutcome: 'RETRY', sync: { status: 'PENDING' },
  }
}

function attentionState(code: string, message: string, now: Date): FinalState {
  return {
    status: 'DEAD', availableAt: now, completedAt: now, errorCode: code,
    errorMessage: boundedMessage(message), attemptOutcome: 'ATTENTION', sync: { status: 'ATTENTION' },
  }
}

function resultFromPersisted(outboxId: string, persisted: 'APPLIED' | 'STALE' | 'FENCED', normal: ProcessJobResult['outcome']): ProcessJobResult {
  return { outboxId, outcome: persisted === 'FENCED' ? 'FENCED' : persisted === 'STALE' ? 'STALE' : normal }
}

export async function processInstallationCalendarJob(
  db: PrismaClient,
  adapter: InstallationCalendarAdapter,
  job: ClaimedIntegrationJob,
  now?: Date,
): Promise<ProcessJobResult> {
  const startedAt = Date.now()
  const durationMs = () => Math.max(0, Date.now() - startedAt)
  const clock = createWorkerClock(now)
  const current = await db.installationVisit.findUnique({ where: { id: job.visitId }, select: { revision: true } })
  if (!current || current.revision !== job.revision) {
    const finishedAt = clock.now()
    const persisted = await persistFinalState(
      db, job, finishedAt, durationMs(), staleFinalState(finishedAt),
    )
    return resultFromPersisted(job.id, persisted, 'STALE')
  }

  const sync = await db.integrationSyncState.findUnique({
    where: { visitId_kind: { visitId: job.visitId, kind: CALENDAR_KIND } },
    select: { externalId: true, externalEtag: true },
  })
  let projection: CalendarProjection | null = null
  if (job.operation === 'CALENDAR_UPSERT') {
    projection = await loadCalendarProjection(db, job)
    if (!projection) {
      const finishedAt = clock.now()
      const persisted = await persistFinalState(
        db, job, finishedAt, durationMs(),
        attentionState('DOMAIN_DATA_INVALID', SAFE_MESSAGES.invalidData, finishedAt),
      )
      return resultFromPersisted(job.id, persisted, 'ATTENTION')
    }
  }

  // Data reads precede this point, but the lease is refreshed immediately
  // before adapter I/O. A reclaimed or expired worker makes no external call.
  const activeJob = await renewCurrentLease(db, job, clock.now())
  if (!activeJob) return { outboxId: job.id, outcome: 'FENCED' }
  const heartbeat = startLeaseHeartbeat(db, activeJob, clock)
  try {
    let write: CalendarWriteResult | null = null
    if (activeJob.operation === 'CALENDAR_UPSERT') {
      write = await adapter.upsert({
        event: buildCalendarEvent(projection!.event), externalId: sync?.externalId ?? null,
        etag: sync?.externalEtag ?? null, forceOverwrite: activeJob.forceOverwrite,
      })
    } else if (sync?.externalId) {
      await adapter.cancel({
        visitId: activeJob.visitId, externalId: sync.externalId,
        etag: sync.externalEtag ?? null, forceOverwrite: activeJob.forceOverwrite,
      })
    }
    const latestJob = await heartbeat.stop()
    if (!latestJob) return { outboxId: activeJob.id, outcome: 'FENCED' }
    const finishedAt = clock.now()
    const persisted = await persistFinalState(db, latestJob, finishedAt, durationMs(), successState(finishedAt, write))
    return resultFromPersisted(latestJob.id, persisted, 'COMPLETED')
  } catch (error) {
    const latestJob = await heartbeat.stop()
    if (!latestJob) return { outboxId: activeJob.id, outcome: 'FENCED' }
    const kind = calendarErrorKind(error)
    if (kind === 'RETRY') {
      const finishedAt = clock.now()
      const persisted = await persistFinalState(db, latestJob, finishedAt, durationMs(), retryState(latestJob, finishedAt, safeRetryErrorCode(error)))
      return resultFromPersisted(latestJob.id, persisted, 'RETRIED')
    }
    if (kind === 'CONFLICT') {
      const finishedAt = clock.now()
      const persisted = await persistFinalState(db, latestJob, finishedAt, durationMs(), attentionState('ETAG_CONFLICT', SAFE_MESSAGES.conflict, finishedAt))
      return resultFromPersisted(latestJob.id, persisted, 'ATTENTION')
    }
    if (kind === 'CONFIGURATION') {
      const finishedAt = clock.now()
      const persisted = await persistFinalState(db, latestJob, finishedAt, durationMs(), attentionState('CONFIGURATION_ERROR', SAFE_MESSAGES.configuration, finishedAt))
      return resultFromPersisted(latestJob.id, persisted, 'ATTENTION')
    }
    const finishedAt = clock.now()
    const persisted = await persistFinalState(db, latestJob, finishedAt, durationMs(), attentionState('INTERNAL_ERROR', SAFE_MESSAGES.internal, finishedAt))
    return resultFromPersisted(latestJob.id, persisted, 'ATTENTION')
  }
}

export async function processInstallationCalendarBatch(
  db: PrismaClient,
  adapter: InstallationCalendarAdapter,
  limit = 10,
): Promise<BatchResult> {
  const maximum = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 10
  const result: BatchResult = { claimed: 0, completed: 0, retried: 0, attention: 0 }
  const workerId = `calendar-batch-${randomUUID()}`
  for (let index = 0; index < maximum; index += 1) {
    const job = await claimNextIntegrationJob(db, new Date(), workerId)
    if (!job) break
    result.claimed += 1
    const processed = await processInstallationCalendarJob(db, adapter, job)
    if (processed.outcome === 'COMPLETED' || processed.outcome === 'STALE') result.completed += 1
    if (processed.outcome === 'RETRIED') result.retried += 1
    if (processed.outcome === 'ATTENTION') result.attention += 1
  }
  return result
}
