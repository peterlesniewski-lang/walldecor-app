import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const workspace = process.cwd()
const databaseDirectory = mkdtempSync('/tmp/walldecor-installations-e2e-')
const databasePath = path.join(databaseDirectory, 'calendar.db')
const databaseUrl = `file:${databasePath}`
const SAFE_DIRECTORY_NAME = /^walldecor-installations-e2e-[A-Za-z0-9_-]+$/u

function isValidatedPrivateDirectory() {
  if (path.dirname(databaseDirectory) !== '/tmp' || !SAFE_DIRECTORY_NAME.test(path.basename(databaseDirectory))) return false
  if (databasePath !== path.join(databaseDirectory, 'calendar.db')) return false
  try {
    const directory = lstatSync(databaseDirectory)
    return !directory.isSymbolicLink()
      && directory.isDirectory()
      && (directory.mode & 0o077) === 0
      && (typeof process.getuid !== 'function' || directory.uid === process.getuid())
  } catch {
    return false
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: workspace, encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('VALIDATION_PROCESS_FAILED')
  return result.stdout
}

function applyCommittedMigrations() {
  const migrationRoot = path.join(workspace, 'prisma', 'migrations')
  const migrationSqlPaths = readdirSync(migrationRoot)
    .sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)

  if (migrationSqlPaths.length === 0) throw new Error('VALIDATION_MIGRATIONS_MISSING')
  for (const migrationSqlPath of migrationSqlPaths) {
    runChecked('sqlite3', ['-bail', databasePath], { input: readFileSync(migrationSqlPath, 'utf8') })
  }
}

function cleanup() {
  if (!isValidatedPrivateDirectory()) throw new Error('VALIDATION_UNSAFE_CLEANUP_TARGET')
  if (existsSync(databasePath)) {
    const database = lstatSync(databasePath)
    if (database.isSymbolicLink() || !database.isFile()) throw new Error('VALIDATION_UNSAFE_CLEANUP_TARGET')
  }
  rmSync(databaseDirectory, { recursive: true, force: true })
}

function runWorkflow() {
  const program = String.raw`
import { PrismaClient } from '@/generated/prisma'
const { createInstallationRoom, createInstallationScope } = (await import('@/lib/installations/catalog-service')).default
const { createInstallationOrder } = (await import('@/lib/installations/order-service')).default
const { setScopeInstallerAssignments } = (await import('@/lib/installations/scope-assignment-service')).default
const { createInstallationVisit, changeInstallationVisit } = (await import('@/lib/installations/visit-service')).default
const { FakeInstallationCalendarAdapter } = (await import('@/lib/installations/fake-calendar-adapter')).default
const { readInstallationCalendarConfig } = (await import('@/lib/installations/calendar-server-config')).default
const { processInstallationCalendarBatch } = (await import('@/lib/installations/calendar-worker')).default

const databaseUrl = process.env.DATABASE_URL
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
let reopened
try {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'E2E', name: 'Walidator E2E' } })
  const [owner, backup] = await Promise.all([
    db.employee.create({ data: { firstName: 'A', lastName: 'E', email: 'a@example.test', position: 'Instalator', costCenterId: 'E2E', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
    db.employee.create({ data: { firstName: 'B', lastName: 'E', email: 'b@example.test', position: 'Instalator', costCenterId: 'E2E', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
  ])
  const order = await createInstallationOrder(db, {
    client: { name: 'Walidator E2E', email: 'validator@example.test', phone: '+48501000000' },
    address: { street: 'Testowa', buildingNumber: '1', postalCode: '00-001', city: 'Warszawa' },
    primaryEmployeeId: owner.id,
    backupEmployeeId: backup.id,
  }, 'validator')
  const room = await createInstallationRoom(db, order.id, { name: 'Pomieszczenie testowe' }, 'validator')
  const scope = await createInstallationScope(db, room.id, { name: 'Zakres testowy' }, 'validator')
  await setScopeInstallerAssignments(db, order.id, scope.id, [owner.id], 'validator')
  const draft = await createInstallationVisit(db, order.id, { scopeIds: [scope.id] }, 'validator')
  const confirmed = await changeInstallationVisit(db, order.id, draft.id, {
    action: 'CONFIRM', expectedRevision: draft.revision,
    startsAt: '2027-03-01T08:00:00.000Z', endsAt: '2027-03-01T12:00:00.000Z',
    scopeIds: [scope.id],
  }, 'validator')
  const config = readInstallationCalendarConfig(process.env)
  const adapter = new FakeInstallationCalendarAdapter()
  const initialBatch = await processInstallationCalendarBatch(db, adapter, config.batchSize)
  if (initialBatch.claimed !== 1 || initialBatch.completed !== 1 || initialBatch.retried !== 0 || initialBatch.attention !== 0) throw new Error('VALIDATION_INITIAL_BATCH')
  const before = await db.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: confirmed.id, kind: 'GOOGLE_CALENDAR' } } })
  if (!before.externalId || !before.externalEtag) throw new Error('VALIDATION_INITIAL_SYNC')
  const rescheduled = await changeInstallationVisit(db, order.id, confirmed.id, {
    action: 'CHANGE_SCHEDULE', expectedRevision: confirmed.revision,
    startsAt: '2027-03-02T09:00:00.000Z', endsAt: '2027-03-02T13:00:00.000Z',
    scopeIds: [scope.id],
  }, 'validator')
  const rescheduleBatch = await processInstallationCalendarBatch(db, adapter, config.batchSize)
  if (rescheduleBatch.claimed !== 1 || rescheduleBatch.completed !== 1 || rescheduleBatch.retried !== 0 || rescheduleBatch.attention !== 0) throw new Error('VALIDATION_RESCHEDULE_BATCH')
  const after = await db.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: rescheduled.id, kind: 'GOOGLE_CALENDAR' } } })
  if (after.externalId !== before.externalId || after.externalEtag === before.externalEtag || !after.externalEtag) throw new Error('VALIDATION_EVENT_ID_OR_ETAG')
  if (await db.integrationSyncState.count({ where: { visitId: confirmed.id } }) !== 1) throw new Error('VALIDATION_SYNC_STATE_COUNT')
  await db.$disconnect()
  reopened = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await reopened.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  const integrityRows = await reopened.$queryRawUnsafe('PRAGMA integrity_check')
  const foreignKeyRows = await reopened.$queryRawUnsafe('PRAGMA foreign_key_check')
  const integrity = Array.isArray(integrityRows) ? integrityRows.map((row) => Object.values(row).join('')).join(',') : ''
  const persisted = await reopened.integrationSyncState.findUniqueOrThrow({ where: { visitId_kind: { visitId: confirmed.id, kind: 'GOOGLE_CALENDAR' } } })
  if (integrity !== 'ok' || !Array.isArray(foreignKeyRows) || foreignKeyRows.length !== 0 || persisted.externalId !== before.externalId || persisted.externalEtag !== after.externalEtag) throw new Error('VALIDATION_DATABASE_READBACK')
  process.stdout.write(JSON.stringify({ status: 'ok', syncStateCount: 1, sameExternalId: true, etagChanged: true, integrityCheck: 'ok', foreignKeyCheck: 'ok' }))
} finally {
  await reopened?.$disconnect()
  await db.$disconnect().catch(() => undefined)
}
`
  const output = runChecked(process.execPath, ['--no-warnings', '--preserve-symlinks', '--import', 'tsx', '--input-type=module', '--eval', program], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      E2E_DATABASE_URL: databaseUrl,
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'fake',
      GOOGLE_CALENDAR_ID: 'e2e-calendar@example.test',
      GOOGLE_CALENDAR_IMPERSONATED_USER: 'info@walldecor.pl',
      INSTALLATION_CALENDAR_WORKER_BATCH_SIZE: '20',
    },
  })
  return JSON.parse(output)
}

try {
  if (!isValidatedPrivateDirectory() || existsSync(databasePath)) throw new Error('VALIDATION_UNSAFE_DATABASE_PATH')
  applyCommittedMigrations()
  const result = runWorkflow()
  if (result?.status !== 'ok' || result.syncStateCount !== 1 || result.sameExternalId !== true || result.etagChanged !== true || result.integrityCheck !== 'ok' || result.foreignKeyCheck !== 'ok') {
    throw new Error('VALIDATION_RESULT_SHAPE')
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  const code = error instanceof Error && /^VALIDATION_[A-Z_]+$/u.test(error.message) ? error.message : 'VALIDATION_FAILED'
  process.stdout.write(`${JSON.stringify({ status: 'error', code })}\n`)
  process.exitCode = 1
} finally {
  try {
    cleanup()
  } catch {
    process.exitCode = 1
    process.stdout.write(`${JSON.stringify({ status: 'error', code: 'VALIDATION_CLEANUP_FAILED' })}\n`)
  }
}
