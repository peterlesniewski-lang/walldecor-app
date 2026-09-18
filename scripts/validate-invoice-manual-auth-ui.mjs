#!/usr/bin/env node
/**
 * MANUAL MISSING-AUTH INVOICE UI GATE. Importing this module performs no I/O.
 * Review before running:
 * node scripts/validate-invoice-manual-auth-ui.mjs --confirm-missing-auth \
 *   --image sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab
 *
 * A real pinned worker receives a NEW EMPTY /oauth tmpfs, never owner OAuth.
 * Exactly one worker start and one durable queue claim are allowed. Its real
 * failure must be AUTH. The stopped worker is NEVER restarted, even after the
 * EXTRACT UI action clears the queue pause. All invoices/files/users are fictional.
 * This does not prove remote OAuth revocation or recovery, successful inference,
 * provider HTTP request count, or production behavior. No fallback or login.
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { authLossWorkerArgs, createAuthLossWorkerEventGate, parseAuthLossArgs, waitForAuthLossOutcome } from './validate-ai-auth-loss.mjs'
import { chatOAuthBrowserLaunchOptions, chatOAuthFixtureUsernames } from './validate-ai-chat-oauth.mjs'
import {
  captureSyntheticScreenshot, createSyntheticInvoicePng, INVOICE_OAUTH_EXPECTED,
  invoiceOAuthServerEnvironment, retainHandledRejection,
} from './validate-invoice-import-oauth.mjs'

const REVIEWED_IMAGE = 'sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab'
const DOCKER = '/usr/local/bin/docker'
const LOCAL_DOCKER = 'unix:///Users/piotr/.docker/run/docker.sock'
const PRIMARY_FILE = 'synthetic-invoice-manual-auth.png'
const SECONDARY_FILE = 'synthetic-blank-manual-auth.png'
const AUTH_MESSAGE = 'Usługa odczytu nie ma poprawnego dostępu. Dane możesz uzupełnić i zatwierdzić ręcznie.'
const RUN_ID = /^[0-9]{13}-[a-f0-9]{8}$/
const CONTAINER_ID = /^[a-f0-9]{64}$/
const JOB_ID = /^[a-zA-Z0-9_-]{1,191}$/
export const INVOICE_MANUAL_AUTH_LIMITS = Object.freeze({
  inputFiles: 2, maximumWorkerStarts: 1, maximumQueueClaims: 1,
  maximumClaimsPerJob: 1, finalJobs: 3, approvedInvoices: 1, activeCosts: 1,
  recognizedGrossPLN: 123, firstFinishDeadlineMs: 60_000, stopAfterFinishLimitMs: 10_000,
  ownerOAuthMounted: false, providerFallback: false, automaticHarnessRetry: false,
})
class GateError extends Error {
  constructor(code) { super(code); this.code = code }
}
const check = (condition, code) => { if (!condition) throw new GateError(code) }
const failure = (code) => ({ passed: false, code })
const clearedLease = (row) => row?.workerId === null && row?.leaseToken === null && row?.leaseUntil === null
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function parseInvoiceManualAuthArgs(args) {
  const config = parseAuthLossArgs(args)
  check(config.image === REVIEWED_IMAGE, 'REVIEWED_IMAGE_REQUIRED')
  return config
}

export function invoiceManualAuthWorkerPlan(config, runId) {
  check(config && Object.keys(config).length === 1 && Object.hasOwn(config, 'image'), 'INVALID_CONFIG')
  const parsed = parseInvoiceManualAuthArgs(['--confirm-missing-auth', '--image', config.image])
  check(typeof runId === 'string' && RUN_ID.test(runId), 'INVALID_FIXTURE_RUN_ID')
  const name = `wd-ai-auth-loss-worker-invoice-manual-${runId}`
  return { name, args: authLossWorkerArgs(parsed, name) }
}

/** Irreversible in-memory permit: a stopped/failed worker cannot start twice. */
export function createInvoiceManualAuthStartPermit() {
  let starts = 0
  return {
    consume() { check(starts === 0, 'WORKER_RESTART_FORBIDDEN'); starts = 1; return starts },
    count: () => starts,
  }
}

/** IDs are recorded only after successful create. Cleanup addresses immutable IDs. */
export function invoiceManualAuthCleanupArgs(resource, runId) {
  check(typeof runId === 'string' && RUN_ID.test(runId)
    && resource && CONTAINER_ID.test(resource.id ?? '')
    && [`wd-ai-auth-loss-worker-invoice-manual-${runId}`, `wd-ai-auth-loss-probe-invoice-manual-${runId}`].includes(resource.name),
  'INVALID_OWNED_RESOURCE')
  return ['rm', '--force', resource.id]
}

/** Used only with durable non-running snapshots; no synthetic success accepted. */
export function assessInvoiceManualAuthBudget(rows, expectedIds, primaryId, requiredClaims = 1) {
  if (![0, 1].includes(requiredClaims)) return failure('INVALID_REQUIRED_CLAIMS')
  if (!Array.isArray(rows) || !Array.isArray(expectedIds) || expectedIds.length < 1 || expectedIds.length > 3
    || expectedIds.some((id) => typeof id !== 'string' || !JOB_ID.test(id))
    || new Set(expectedIds).size !== expectedIds.length || !expectedIds.includes(primaryId)
    || rows.length !== expectedIds.length || new Set(rows.map((row) => row?.id)).size !== expectedIds.length
    || rows.some((row) => !expectedIds.includes(row?.id))) return failure('UNEXPECTED_JOB_SET')
  let claims = 0
  for (const row of rows) {
    if (row.kind !== 'INVOICE_EXTRACT' || !Number.isInteger(row.attempts) || row.attempts < 0 || row.attempts > 1
      || row.resultJson !== null || !clearedLease(row)) return failure('UNEXPECTED_CLAIM_OR_RESULT')
    claims += row.attempts
    if (row.id === primaryId) {
      const validPrimary = requiredClaims === 0
        ? row.status === 'QUEUED' && row.attempts === 0 && row.errorCode === null
        : row.status === 'BLOCKED' && row.attempts === 1 && row.errorCode === 'AUTH'
      if (!validPrimary) return failure('PRIMARY_NOT_MISSING_AUTH')
    } else if (!['QUEUED', 'CANCELLED'].includes(row.status) || row.attempts !== 0 || row.errorCode !== null) {
      return failure('SECONDARY_JOB_WAS_EXECUTED')
    }
  }
  return claims === requiredClaims ? { passed: true, claims } : failure('QUEUE_CLAIM_LIMIT_EXCEEDED')
}

export function invoiceManualPlnAmountMatches(text) {
  return typeof text === 'string' && /^123(?:[,.]00)?zł$/.test(text.replace(/\s+/g, ''))
}

export async function waitForInvoiceManualDownload(page, click) {
  const pending = retainHandledRejection(page.waitForEvent('download'))
  await click()
  return pending
}

export function assessInvoiceManualAuthBlocked(evidence) {
  const job = evidence?.job
  const budget = assessInvoiceManualAuthBudget([job], [job?.id], job?.id)
  if (!budget.passed || budget.claims !== 1) return failure('PRIMARY_NOT_AUTH_BLOCKED')
  if (evidence?.queue?.pauseReason !== 'AUTH' || !clearedLease(evidence.queue)) return failure('QUEUE_NOT_AUTH_PAUSED')
  const finish = evidence?.finish
  if (finish?.status !== 'failed' || !Number.isFinite(finish.stopDelayMs)
    || finish.stopDelayMs < 0 || finish.stopDelayMs >= INVOICE_MANUAL_AUTH_LIMITS.stopAfterFinishLimitMs) return failure('FIRST_FINISH_OR_STOP_INVALID')
  if (evidence?.workerStopped !== true || evidence.workerStarts !== 1) return failure('WORKER_STOP_NOT_VERIFIED')
  return evidence?.authUiVisible === true ? { passed: true } : failure('AUTH_UI_NOT_VISIBLE')
}

async function main(args) {
  // Explicit consent + exact immutable image are checked before ANY I/O.
  const config = parseInvoiceManualAuthArgs(args)
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const workerPlan = invoiceManualAuthWorkerPlan(config, runId)
  const artifactDirectory = path.join(repository, 'test-results', `invoice-manual-auth-${runId}`)
  const controller = new AbortController()
  const signal = controller.signal
  const childEnvironment = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' }
  const permit = createInvoiceManualAuthStartPermit()
  const resources = new Map()
  const report = {
    status: 'RUNNING', runId, imageId: config.image, limits: INVOICE_MANUAL_AUTH_LIMITS,
    scope: 'Real empty-OAuth worker AUTH failure, two synthetic UI uploads, manual approval and UI skip/archive/restore/extract against clean local SQLite.',
    boundary: 'No owner OAuth is read, copied, mounted, logged, modified or deleted. No successful inference or provider HTTP count is claimed. Worker is never restarted after its one start.',
    workerEvents: [], passed: [], screenshots: [], downloads: [], cleanup: {},
  }
  let directory, databasePath, db, browser, page, server, serverReady = false
  let workerResource, workerAttach, lifecycle, workerStopped = true, interruptStopPromise, cleanupPromise
  let stepCode = 'PREFLIGHT', syntheticUiSafe = false
  const alive = (child) => child && child.exitCode === null && child.signalCode === null
  const assertActive = () => check(!signal.aborted, 'INTERRUPTED')
  const pass = (code) => { report.passed.push(code); process.stdout.write(`PASS ${code}\n`) }

  // Raw logs, stderr, environment, passwords, cookies and lease tokens never leave memory.
  async function command(binary, commandArgs, { timeoutMs = 20_000, env = childEnvironment, cleanup = false, cwd } = {}) {
    if (!cleanup) assertActive()
    return new Promise((resolve, reject) => {
      const child = spawn(binary, commandArgs, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', outputBytes = 0, timedOut = false
      const stop = () => child.kill('SIGKILL')
      const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
      if (!cleanup) signal.addEventListener('abort', stop, { once: true })
      child.stdout.on('data', (chunk) => { outputBytes += chunk.length; if (outputBytes > 1024 * 1024) stop(); else stdout += chunk.toString() })
      child.stderr.on('data', (chunk) => { outputBytes += chunk.length; if (outputBytes > 1024 * 1024) stop() })
      child.once('error', () => {
        clearTimeout(timer); signal.removeEventListener('abort', stop); reject(new GateError('COMMAND_START_FAILED'))
      })
      child.once('close', (code) => {
        clearTimeout(timer); signal.removeEventListener('abort', stop)
        if (timedOut || outputBytes > 1024 * 1024) reject(new GateError(timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_OUTPUT_LIMIT'))
        else resolve({ code, stdout })
      })
    })
  }
  const docker = (args, options) => command(DOCKER, ['--host', LOCAL_DOCKER, ...args], options)
  const must = (result, code) => { check(result.code === 0, code); return result.stdout.trim() }
  async function ownContainer(name, args, options) {
    // No cleanup entry is registered on failed create or pre-existing names.
    // A lost/failed create response can be ambiguous. Report that ambiguity;
    // never turn the generated name alone into authority to remove a container.
    let id
    try { id = must(await docker(args, options), 'OWN_CONTAINER_CREATE_FAILED') }
    catch (error) {
      report.cleanup.containerCreationStateKnown = false
      report.unresolvedContainerName = name
      throw error
    }
    const resource = { name, id }
    try { invoiceManualAuthCleanupArgs(resource, runId) }
    catch (error) {
      report.cleanup.containerCreationStateKnown = false
      report.unresolvedContainerName = name
      throw error
    }
    resources.set(id, resource)
    return resource
  }
  async function removeOwned(resource) {
    must(await docker(invoiceManualAuthCleanupArgs(resource, runId), { cleanup: true }), 'OWN_CONTAINER_REMOVE_FAILED')
    const remaining = must(await docker(['container', 'ls', '--all', '--no-trunc', '--filter', `id=${resource.id}`, '--format', '{{.ID}}'], { cleanup: true }), 'OWN_CONTAINER_REMOVE_READBACK_FAILED')
    check(remaining === '', 'OWN_CONTAINER_STILL_EXISTS')
    resources.delete(resource.id)
  }
  async function stoppedState() {
    if (!workerResource) return true
    const state = must(await docker(['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', workerResource.id], { timeoutMs: 3_000, cleanup: true }), 'WORKER_STATE_UNVERIFIED')
    check(/^(true|false) -?\d+$/.test(state), 'WORKER_STATE_UNVERIFIED')
    return state === 'false 0'
  }
  async function stopWorker({ cleanup = false } = {}) {
    if (!workerResource) return
    lifecycle?.expectStop()
    if (!await stoppedState().catch(() => false)) {
      await docker(['stop', '--time', '5', workerResource.id], { timeoutMs: 8_000, cleanup: true }).catch(() => null)
    }
    const clean = await stoppedState().catch(() => false)
    if (!clean) {
      await docker(['kill', workerResource.id], { timeoutMs: 5_000, cleanup: true }).catch(() => null)
      const state = must(await docker(['inspect', '--format', '{{.State.Running}}', workerResource.id], { timeoutMs: 3_000, cleanup: true }), 'WORKER_STOP_UNVERIFIED')
      check(state === 'false', 'WORKER_STOP_UNVERIFIED')
    }
    workerStopped = true
    if (alive(workerAttach)) {
      await Promise.race([new Promise((resolve) => workerAttach.once('close', resolve)), delay(1_000)])
      check(!alive(workerAttach), 'WORKER_ATTACH_NOT_CLOSED')
    }
    check(cleanup || clean, 'WORKER_DID_NOT_STOP_CLEANLY')
  }
  async function stopServer() {
    if (!alive(server)) return
    const child = server
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    try { await closed } finally { clearTimeout(timer); serverReady = false }
  }
  async function cleanup() {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      try { await stopWorker({ cleanup: true }); report.cleanup.workerStopped = true }
      catch { report.cleanup.workerStopped = false }
      for (const resource of [...resources.values()]) {
        try { await removeOwned(resource); report.cleanup[resource.name] = true }
        catch { report.cleanup[resource.name] = false }
      }
      if (alive(workerAttach)) workerAttach.kill('SIGKILL')
      try { await browser?.close(); report.cleanup.browserClosed = true } catch { report.cleanup.browserClosed = false }
      try { await stopServer(); report.cleanup.serverStopped = true } catch { report.cleanup.serverStopped = false }
      try { await db?.$disconnect(); report.cleanup.databaseDisconnected = true } catch { report.cleanup.databaseDisconnected = false }
      report.cleanup.ownerOAuthTouched = false
      report.cleanup.syntheticDirectoryRetained = directory ?? null
    })()
    return cleanupPromise
  }
  const onSignal = () => {
    controller.abort()
    if (!interruptStopPromise) interruptStopPromise = retainHandledRejection((async () => {
      await stopWorker({ cleanup: true })
      try { await browser?.close() } catch { /* Final cleanup records actual outcome. */ }
    })())
  }
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
  const screenshot = (label) => captureSyntheticScreenshot(page, artifactDirectory, label, report.screenshots)

  try {
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 }); await chmod(artifactDirectory, 0o700)
    const imageMetadata = must(await docker(['image', 'inspect', '--format', '{{.Id}}|{{.Os}}|{{.Architecture}}|{{.Config.User}}|{{json .Config.Entrypoint}}', config.image]), 'LOCAL_IMAGE_NOT_FOUND')
    check(imageMetadata === `${config.image}|linux|arm64|node|["/usr/bin/tini","--","/opt/ai/worker/ai/entrypoint.sh"]`, 'UNEXPECTED_IMAGE_BOUNDARY')
    const buildId = (await readFile(path.join(repository, '.next/BUILD_ID'), 'utf8')).trim()
    check(/^[a-zA-Z0-9_-]+$/.test(buildId), 'PRODUCTION_BUILD_REQUIRED'); report.buildId = buildId
    directory = await realpath(await mkdtemp(path.join(tmpdir(), 'wd-invoice-manual-auth-')))
    await chmod(directory, 0o700)
    databasePath = path.join(directory, 'synthetic.sqlite')
    const originalsDirectory = path.join(directory, 'originals'), processingDirectory = path.join(directory, 'processing')
    for (const entry of [originalsDirectory, processingDirectory]) { await mkdir(entry, { mode: 0o700 }); await chmod(entry, 0o700) }
    const primaryFixture = await createSyntheticInvoicePng(path.join(directory, PRIMARY_FILE))
    const { default: sharp } = await import('sharp')
    const blankBytes = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const secondaryFixture = { path: path.join(directory, SECONDARY_FILE), sha256: hash(blankBytes), byteSize: blankBytes.length }
    check(primaryFixture.sha256 !== secondaryFixture.sha256, 'FIXTURES_NOT_DISTINCT')
    await writeFile(secondaryFixture.path, blankBytes, { flag: 'wx', mode: 0o600 })
    const portProbe = createServer()
    await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve) })
    const port = portProbe.address().port
    await new Promise((resolve) => portProbe.close(resolve))
    const baseUrl = `http://127.0.0.1:${port}`, databaseUrl = `file:${databasePath}`
    const password = randomBytes(24).toString('base64url'), workerSecret = randomBytes(48).toString('base64url')
    const environment = invoiceOAuthServerEnvironment({ databaseUrl, baseUrl,
      nextAuthSecret: randomBytes(48).toString('base64url'), workerSecret, originalsDirectory, processingDirectory })
    report.baseUrl = baseUrl; report.syntheticDatabase = databasePath
    report.fixtures = [primaryFixture, secondaryFixture].map(({ path, sha256, byteSize }) => ({ path, sha256, byteSize, mimeType: 'image/png' }))
    for (const name of ['node_modules', 'public']) await symlink(path.join(repository, name), path.join(directory, name), 'dir')
    const buildDirectory = path.join(repository, '.next')
    await cp(buildDirectory, path.join(directory, '.next'), { recursive: true, filter(source) {
      return !['cache', 'standalone'].includes(path.relative(buildDirectory, source).split(path.sep)[0])
    } })
    await mkdir(path.join(directory, 'prisma'))
    await cp(path.join(repository, 'prisma/schema.prisma'), path.join(directory, 'prisma/schema.prisma'))
    await cp(path.join(repository, 'prisma/migrations'), path.join(directory, 'prisma/migrations'), { recursive: true })
    must(await command('/usr/bin/sqlite3', [databasePath, 'VACUUM;']), 'SYNTHETIC_DATABASE_CREATE_FAILED')
    await chmod(databasePath, 0o600)
    must(await command(process.execPath, [path.join(repository, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(directory, 'prisma/schema.prisma')],
      { timeoutMs: 30_000, env: environment, cwd: directory }), 'SYNTHETIC_MIGRATION_FAILED')
    const [{ default: bcrypt }, { chromium, expect }, { PrismaClient }] = await Promise.all([
      import('bcryptjs'), import('@playwright/test'), import('../src/generated/prisma/index.js'),
    ])
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    const username = chatOAuthFixtureUsernames(runId).admin
    await db.user.create({ data: { id: username, username, email: `${username}@example.test`, name: 'SYNTHETIC ADMIN',
      passwordHash: await bcrypt.hash(password, 10), role: 'ADMIN', mustChangePassword: false, isActive: true } })
    for (const id of ['JAG', 'PUL', 'GLOBAL']) await db.costCenter.create({ data: { id, name: id } })
    const group = await db.costTagGroup.create({ data: { name: 'Charakter kosztu', slug: 'behavior', order: 1 } })
    const fixedTag = await db.costTag.create({ data: { groupId: group.id, name: 'Stały', slug: 'fixed' } })

    async function waitFor(predicate, code, timeoutMs = 20_000) {
      const end = Date.now() + timeoutMs
      while (Date.now() < end) { assertActive(); const value = await predicate(); if (value) return value; await delay(100, undefined, { signal }) }
      throw new GateError(code)
    }
    async function startServer() {
      assertActive(); serverReady = false
      let failed = false, outputBytes = 0
      server = spawn(process.execPath, [path.join(repository, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'],
        { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
      const consume = (chunk) => {
        outputBytes += chunk.length
        if (chunk.toString().includes('Ready in')) serverReady = true
        if (chunk.toString().includes('EADDRINUSE') || outputBytes > 1024 * 1024) failed = true
      }
      server.stdout.on('data', consume); server.stderr.on('data', consume); server.once('error', () => { failed = true })
      await waitFor(async () => {
        check(alive(server) && !failed, 'LOOPBACK_NEXT_START_FAILED')
        return serverReady && await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000), redirect: 'error' }).then((response) => response.ok).catch(() => false)
      }, 'LOOPBACK_NEXT_START_TIMEOUT')
    }
    async function startWorkerOnce() {
      assertActive(); check(workerResource && workerStopped, 'WORKER_START_BOUNDARY_INVALID')
      permit.consume(); workerStopped = false
      lifecycle = createAuthLossWorkerEventGate({ stopWorker, now: () => Date.now() })
      workerAttach = spawn(DOCKER, ['--host', LOCAL_DOCKER, 'start', '--attach', workerResource.id],
        { env: childEnvironment, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      let pending = '', outputBytes = 0
      const consume = (chunk) => {
        outputBytes += chunk.length
        if (outputBytes > 64_000) { lifecycle.observeOutputLimit(); return }
        pending += chunk.toString()
        const lines = pending.split('\n'); pending = lines.pop()
        for (const line of lines) {
          try {
            const event = JSON.parse(line)
            if (event?.event === 'AI_WORKER_STARTED') report.workerEvents.push({ event: 'AI_WORKER_STARTED' })
            if (event?.event === 'AI_JOB_FINISHED' && ['succeeded', 'failed', 'lease_lost'].includes(event.status)) report.workerEvents.push({ event: 'AI_JOB_FINISHED', status: event.status })
          } catch { /* Only allowlisted events are retained. */ }
          lifecycle.observeLine(line)
        }
      }
      workerAttach.stdout.on('data', consume); workerAttach.stderr.on('data', consume)
      workerAttach.once('error', lifecycle.observeAttachError); workerAttach.once('close', lifecycle.observeExit)
      const startup = await waitForAuthLossOutcome(lifecycle.startup, 15_000, signal, 'WORKER_START_TIMEOUT')
      check(startup.ok && lifecycle.startedObserved() && !lifecycle.fatalCode(), startup.code ?? 'WORKER_START_FAILED')
      const finished = await waitForAuthLossOutcome(lifecycle.finished, INVOICE_MANUAL_AUTH_LIMITS.firstFinishDeadlineMs, signal)
      check(finished.ok && !lifecycle.fatalCode(), finished.code ?? 'WORKER_FINISH_FAILED')
      check(workerStopped && await stoppedState(), 'WORKER_STOP_NOT_VERIFIED')
      check(report.workerEvents.filter((event) => event.event === 'AI_JOB_FINISHED').length === 1, 'UNEXPECTED_WORKER_FINISH_COUNT')
      return finished.value
    }
    const jobSelect = { id: true, kind: true, status: true, attempts: true, resultJson: true, errorCode: true,
      workerId: true, leaseToken: true, leaseUntil: true }
    const readJobs = () => db.aiJob.findMany({ orderBy: { id: 'asc' }, select: jobSelect })
    const queue = () => db.aiQueueLease.findUniqueOrThrow({ where: { id: 'shared-ai' } })
    const draft = (id) => db.invoiceImportDraft.findUniqueOrThrow({ where: { id }, include: { attachment: true, audits: { orderBy: { createdAt: 'asc' } } } })
    const listItem = (name) => page.getByRole('complementary', { name: 'Dokumenty importu' }).getByRole('button').filter({ hasText: name })
    async function selectFile(name) {
      await expect(listItem(name)).toHaveCount(1)
      await listItem(name).click()
      await expect(page.getByRole('img', { name, exact: true })).toBeVisible()
    }
    async function upload(fixture, expectedDrafts) {
      check(workerStopped && await stoppedState(), 'UPLOAD_REQUIRES_STOPPED_WORKER')
      await page.getByLabel('Dodaj faktury', { exact: true }).setInputFiles(fixture.path)
      const saved = await waitFor(async () => {
        const row = await db.invoiceImportDraft.findFirst({ where: { attachment: { sha256: fixture.sha256 } }, include: { attachment: true, latestAiJob: true } })
        return row?.latestAiJob?.status === 'QUEUED' && row.latestAiJob.attempts === 0 ? row : null
      }, 'UPLOAD_DID_NOT_CREATE_QUEUED_DRAFT')
      check(await db.invoiceImportDraft.count() === expectedDrafts && await db.invoiceAttachment.count() === expectedDrafts
        && saved.attachment.state === 'READY' && saved.attachment.mimeType === 'image/png', 'UPLOAD_COUNTS_INVALID')
      await selectFile(path.basename(fixture.path))
      return saved
    }
    async function originalBytes(fixture, currentDraft, label) {
      const storedPath = path.join(originalsDirectory, currentDraft.attachment.storageKey)
      check(storedPath.startsWith(`${originalsDirectory}${path.sep}`), 'ORIGINAL_PATH_ESCAPED_PRIVATE_ROOT')
      const info = await stat(storedPath)
      check(info.isFile() && (info.mode & 0o777) === 0o600 && hash(await readFile(storedPath)) === fixture.sha256, 'STORED_ORIGINAL_CHANGED')
      const download = await waitForInvoiceManualDownload(page,
        () => page.getByRole('link', { name: 'Pobierz oryginał', exact: true }).click())
      const downloadedPath = await download.path(); check(downloadedPath, 'DOWNLOAD_PATH_UNAVAILABLE')
      const bytes = await readFile(downloadedPath)
      check(hash(bytes) === fixture.sha256 && bytes.length === fixture.byteSize, 'DOWNLOAD_BYTES_CHANGED')
      const target = path.join(artifactDirectory, `${label}.png`)
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
      report.downloads.push({ path: target, sha256: fixture.sha256, byteSize: bytes.length })
    }
    async function assertOneCost(invoiceId) {
      const invoices = await db.ksefInvoice.findMany()
      const costs = await db.costEvent.findMany({ include: { parts: { include: { tags: true, allocations: true } } } })
      const invoice = invoices[0], cost = costs[0]
      check(invoices.length === 1 && invoice?.id === invoiceId && invoice.source === 'MANUAL'
        && invoice.status === 'APPROVED' && invoice.documentStatus === 'ACTIVE' && invoice.grossAmount === 123
        && invoice.netAmount === 100 && invoice.vatAmount === 23 && invoice.currency === 'PLN'
        && invoice.reportingGrossAmount === 123 && invoice.costCenterId === 'JAG'
        && costs.length === 1 && cost?.sourceInvoiceId === invoiceId && cost.status === 'APPROVED'
        && cost.documentStatus === 'ACTIVE' && cost.grossAmount === 123 && cost.netAmount === 100 && cost.vatAmount === 23
        && cost.currency === 'PLN' && cost.parts.length === 1 && cost.parts[0].allocations.length === 1
        && cost.parts[0].allocations[0].costCenterId === 'JAG' && cost.parts[0].allocations[0].percent === 100
        && cost.parts[0].tags.length === 1 && cost.parts[0].tags[0].tagId === fixedTag.id, 'MANUAL_APPROVAL_FINANCE_INVALID')
      return cost.id
    }
    async function assertBudget(ids, primaryId) {
      check(workerStopped && await stoppedState(), 'MANUAL_FLOW_REQUIRES_STOPPED_WORKER')
      const budget = assessInvoiceManualAuthBudget(await readJobs(), ids, primaryId, permit.count())
      check(budget.passed, budget.code ?? 'JOB_BUDGET_FAILED')
      report.observedQueueClaims = budget.claims
      return budget
    }

    stepCode = 'PRIVATE_LOOPBACK_SETUP'
    await startServer()
    const probeName = `wd-ai-auth-loss-probe-invoice-manual-${runId}`
    const healthCode = `fetch(${JSON.stringify(`http://host.docker.internal:${port}/api/health`)},{signal:AbortSignal.timeout(5000),redirect:'error'}).then(r=>{if(!r.ok)process.exit(1);process.stdout.write('LOOPBACK_HEALTH_OK')}).catch(()=>process.exit(1))`
    const probe = await ownContainer(probeName, ['create', '--pull', 'never', '--name', probeName,
      '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '128', '--memory', '512m', '--cpus', '1', '--log-driver', 'none',
      '--entrypoint', '/usr/local/bin/node', config.image, '-e', healthCode])
    const health = await docker(['start', '--attach', probe.id], { timeoutMs: 10_000 })
    check(health.code === 0 && health.stdout === 'LOOPBACK_HEALTH_OK', 'HOST_GATEWAY_CANNOT_REACH_LOOPBACK_NO_WIDER_BIND_ALLOWED')
    await removeOwned(probe); report.cleanup.healthProbeRemoved = true
    workerResource = await ownContainer(workerPlan.name, workerPlan.args, { env: { ...childEnvironment,
      AI_WORKER_ENABLED: 'true', AI_WORKER_URL: `http://host.docker.internal:${port}/api/internal/ai-worker`, AI_WORKER_SECRET: workerSecret } })
    report.workerContainerId = workerResource.id
    pass('CLEAN_MIGRATED_SQLITE_PRIVATE_FILES_LOOPBACK_AND_EMPTY_OAUTH_WORKER_CREATED')

    stepCode = 'PRIMARY_UI_UPLOAD'
    browser = await chromium.launch(chatOAuthBrowserLaunchOptions(directory))
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } })
    page = await context.newPage(); page.setDefaultTimeout(12_000)
    page.on('pageerror', () => { report.uncaughtPageErrors = (report.uncaughtPageErrors ?? 0) + 1 })
    await page.goto(`${baseUrl}/login`); await page.waitForLoadState('networkidle')
    await page.getByLabel('Login', { exact: true }).fill(username)
    await page.getByLabel('Hasło', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
    await page.waitForURL((url) => !url.pathname.includes('login')); await page.waitForLoadState('networkidle')
    await page.goto(`${baseUrl}/finance/ksef`); await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Dodaj faktury', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Import faktur', exact: true })).toBeVisible()
    const workspaceUrl = page.url()
    const primary = await upload(primaryFixture, 1)
    syntheticUiSafe = true
    const primaryJobId = primary.latestAiJob.id
    check(await db.aiJob.count() === 1 && await db.ksefInvoice.count() === 0 && await db.costEvent.count() === 0, 'UPLOAD_CREATED_FINANCE')
    await assertBudget([primaryJobId], primaryJobId)
    await screenshot('primary-before-auth-attempt')
    pass('ONE_SYNTHETIC_PNG_UPLOADED_IN_UI_WITH_ONE_UNCLAIMED_JOB_AND_NO_FINANCE')

    stepCode = 'REAL_EMPTY_OAUTH_AUTH_BLOCK'
    const finish = await startWorkerOnce()
    await expect(page.getByText(AUTH_MESSAGE, { exact: true })).toBeVisible({ timeout: 15_000 })
    const blocked = await db.aiJob.findUniqueOrThrow({ where: { id: primaryJobId }, select: jobSelect })
    const assessment = assessInvoiceManualAuthBlocked({ job: blocked, queue: await queue(), finish,
      workerStopped: workerStopped && await stoppedState(), workerStarts: permit.count(), authUiVisible: true })
    check(assessment.passed, assessment.code ?? 'AUTH_BLOCK_FAILED')
    const empty = await draft(primary.id)
    check(empty.state === 'OPEN' && empty.invoiceId === null && Object.keys(JSON.parse(empty.dataJson)).length === 0
      && await db.costEvent.count() === 0 && await db.ksefInvoice.count() === 0, 'AUTH_FAILURE_APPLIED_INVENTED_DATA')
    report.missingAuth = { status: blocked.status, errorCode: blocked.errorCode, attempts: blocked.attempts,
      finishStatus: finish.status, stopDelayMs: finish.stopDelayMs, authUiVisible: true }
    await screenshot('primary-real-auth-blocked-manual-editor-available')
    pass('REAL_AUTH_BLOCK_VISIBLE_AND_WORKER_POSITIVELY_STOPPED_BEFORE_MANUAL_INPUT')

    stepCode = 'MANUAL_UI_FILL_AND_APPROVE'
    await page.getByLabel('Rodzaj dokumentu', { exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Faktura', exact: true }).click()
    for (const [label, value] of [
      ['Numer dokumentu', INVOICE_OAUTH_EXPECTED.invoiceNumber], ['Nazwa dostawcy', INVOICE_OAUTH_EXPECTED.supplierName],
      ['NIP / identyfikator podatkowy', INVOICE_OAUTH_EXPECTED.taxId], ['Waluta', 'PLN'],
      ['Data wystawienia', INVOICE_OAUTH_EXPECTED.issueDate], ['Termin płatności', INVOICE_OAUTH_EXPECTED.dueDate], ['Kwota brutto', '123'],
    ]) await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByLabel('Status płatności', { exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Niezapłacona', exact: true }).click()
    await page.getByLabel('Miejsce kosztu', { exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'JAG', exact: true }).click()
    await page.getByRole('button', { name: 'Stały', exact: true }).click()
    await page.getByText('Dane szczegółowe', { exact: false }).click()
    await page.getByLabel('Kwota netto', { exact: true }).fill('100')
    await page.getByLabel('Kwota VAT', { exact: true }).fill('23')
    await page.getByRole('button', { name: 'Zapisz szkic', exact: true }).click()
    const saved = await waitFor(async () => {
      const row = await draft(primary.id), data = JSON.parse(row.dataJson)
      return data.gross === 123 && data.net === 100 && data.vat === 23 && data.costCenterId === 'JAG' ? row : null
    }, 'MANUAL_SAVE_NOT_DURABLE')
    const protectedFields = JSON.parse(saved.manualFieldsJson)
    check(['documentType', 'supplierName', 'taxId', 'invoiceNumber', 'currency', 'issueDate', 'dueDate', 'gross', 'net', 'vat', 'paymentStatus', 'costCenterId', 'tagIds']
      .every((field) => protectedFields.includes(field)), 'MANUAL_FIELDS_NOT_PROTECTED')
    const savedData = JSON.parse(saved.dataJson)
    for (const [key, value] of Object.entries(INVOICE_OAUTH_EXPECTED)) {
      check(value === null ? savedData[key] == null : savedData[key] === value, 'MANUAL_VALUES_NOT_DURABLE')
    }
    check(await db.ksefInvoice.count() === 0 && await db.costEvent.count() === 0, 'MANUAL_SAVE_CREATED_FINANCE')
    await screenshot('manually-completed-auth-blocked-draft')
    await page.getByRole('button', { name: 'Zatwierdź i następna', exact: true }).click()
    const approved = await waitFor(async () => { const row = await draft(primary.id); return row.state === 'APPROVED' ? row : null }, 'MANUAL_APPROVAL_NOT_DURABLE')
    const invoiceId = approved.invoiceId, costId = await assertOneCost(invoiceId)
    check(approved.attachmentId === primary.attachmentId && approved.audits.some((audit) => audit.action === 'EDITED')
      && approved.audits.filter((audit) => audit.action === 'APPROVED').length === 1
      && !approved.audits.some((audit) => audit.action === 'AI_RESULT_APPLIED'), 'MANUAL_APPROVAL_HISTORY_INVALID')
    await assertBudget([primaryJobId], primaryJobId)
    check((await queue()).pauseReason === 'AUTH', 'MANUAL_APPROVAL_RESUMED_AI_QUEUE')
    await page.getByRole('button', { name: 'Historia dokumentu', exact: true }).click()
    await expect(page.getByText('Zapisano poprawki', { exact: true })).toBeVisible()
    await expect(page.getByText('Zatwierdzono w kosztach', { exact: true })).toBeVisible()
    await originalBytes(primaryFixture, approved, 'primary-approved-original')
    await screenshot('primary-manually-approved-with-history-and-original')
    pass('AUTH_BLOCKED_INVOICE_APPROVED_MANUALLY_AS_ONE_123_PLN_COST_JAG_FIXED')

    stepCode = 'SECONDARY_UI_SKIP_ARCHIVE_RESTORE_EXTRACT'
    const secondary = await upload(secondaryFixture, 2), secondaryJobId = secondary.latestAiJob.id
    check((await queue()).pauseReason === 'AUTH', 'SECONDARY_UPLOAD_RESUMED_AI_QUEUE')
    await assertBudget([primaryJobId, secondaryJobId], primaryJobId); await assertOneCost(invoiceId)
    await expect(page.getByLabel('Kwota brutto', { exact: true })).toHaveValue('')
    await page.getByRole('button', { name: 'Pomiń na teraz', exact: true }).click()
    await waitFor(async () => { const row = await draft(secondary.id); return row.skippedAt && row.state === 'OPEN' ? row : null }, 'SKIP_NOT_DURABLE')
    await page.getByLabel('Stan dokumentów', { exact: true }).selectOption('OPEN')
    await selectFile(SECONDARY_FILE)
    await expect(listItem(SECONDARY_FILE)).toContainText('Pominięta')
    await assertBudget([primaryJobId, secondaryJobId], primaryJobId); await assertOneCost(invoiceId)
    await page.getByRole('button', { name: 'Archiwizuj szkic', exact: true }).click()
    const archived = await waitFor(async () => { const row = await draft(secondary.id); return row.state === 'ARCHIVED' ? row : null }, 'ARCHIVE_NOT_DURABLE')
    check(archived.latestAiJobId === null && (await db.aiJob.findUniqueOrThrow({ where: { id: secondaryJobId } })).status === 'CANCELLED', 'ARCHIVE_DID_NOT_CANCEL_UNCLAIMED_JOB')
    await expect(listItem(SECONDARY_FILE)).toHaveCount(0)
    await page.getByLabel('Stan dokumentów', { exact: true }).selectOption('ARCHIVED')
    await selectFile(SECONDARY_FILE)
    await expect(page.getByRole('button', { name: 'Przywróć szkic', exact: true })).toBeVisible()
    await originalBytes(secondaryFixture, archived, 'blank-archived-original')
    await screenshot('blank-in-archive-filter-original-preserved')
    await page.getByRole('button', { name: 'Przywróć szkic', exact: true }).click()
    const restored = await waitFor(async () => { const row = await draft(secondary.id); return row.state === 'OPEN' ? row : null }, 'RESTORE_NOT_DURABLE')
    await expect(listItem(SECONDARY_FILE)).toHaveCount(0)
    await page.getByLabel('Stan dokumentów', { exact: true }).selectOption('OPEN')
    await selectFile(SECONDARY_FILE)
    check(restored.latestAiJobId === null && restored.invoiceId === null && restored.attachmentId === secondary.attachmentId
      && restored.extractionRevision === secondary.extractionRevision && (await queue()).pauseReason === 'AUTH', 'RESTORE_CREATED_JOB_OR_CHANGED_ORIGINAL')
    await assertBudget([primaryJobId, secondaryJobId], primaryJobId); await assertOneCost(invoiceId)
    // Critical: EXTRACT resumes the paused queue. The one-use start permit has
    // already been consumed and positive stopped state is mandatory first.
    check(workerStopped && permit.count() === 1 && await stoppedState(), 'EXTRACT_REQUIRES_PERMANENTLY_STOPPED_WORKER')
    await page.getByRole('button', { name: 'Odczytaj ponownie', exact: true }).click()
    const reextracted = await waitFor(async () => {
      const row = await draft(secondary.id)
      return row.latestAiJobId && row.latestAiJobId !== secondaryJobId && row.extractionRevision === restored.extractionRevision + 1 ? row : null
    }, 'EXTRACT_DID_NOT_CREATE_NEW_REVISION_AND_JOB')
    const retryJobId = reextracted.latestAiJobId, expectedIds = [primaryJobId, secondaryJobId, retryJobId]
    check((await queue()).pauseReason === null && reextracted.invoiceId === null, 'EXTRACT_PAUSE_OR_INVOICE_INVALID')
    await assertBudget(expectedIds, primaryJobId); await assertOneCost(invoiceId)
    await page.getByRole('button', { name: 'Historia dokumentu', exact: true }).click()
    for (const label of ['Dodano dokument', 'Pominięto na teraz', 'Przeniesiono do archiwum', 'Przywrócono szkic', 'Zlecono odczyt']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }
    check(isDeepStrictEqual(reextracted.audits.map((audit) => audit.action), ['CREATED', 'SKIPPED', 'ARCHIVED', 'RESTORED', 'EXTRACTION_REQUESTED'])
      && Object.keys(JSON.parse(reextracted.dataJson)).length === 0, 'SECONDARY_HISTORY_OR_BLANK_DATA_INVALID')
    await screenshot('blank-restored-new-extraction-request-history')
    pass('UI_SKIP_ARCHIVE_FILTER_RESTORE_AND_NEW_EXTRACT_JOB_WITH_ZERO_SECONDARY_CLAIMS')

    stepCode = 'NEXT_ONLY_RESTART_PENDING_JOB_DURABILITY'
    const beforeRestart = { jobs: await readJobs(), primary: await draft(primary.id), secondary: await draft(secondary.id), queue: await queue() }
    await stopServer(); await startServer() // Deliberately no worker restart.
    await page.goto(workspaceUrl); await page.waitForLoadState('networkidle')
    // Import workspace is component state, not a routable URL; reopen via UI.
    await page.getByRole('button', { name: 'Dodaj faktury', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Import faktur', exact: true })).toBeVisible()
    await page.getByLabel('Stan dokumentów', { exact: true }).selectOption('OPEN')
    await selectFile(SECONDARY_FILE)
    const afterRestart = { jobs: await readJobs(), primary: await draft(primary.id), secondary: await draft(secondary.id), queue: await queue() }
    check(isDeepStrictEqual(afterRestart, beforeRestart), 'NEXT_RESTART_CHANGED_DURABLE_STATE')
    const readback = await page.request.get(`${baseUrl}/api/finance/invoice-import/drafts/${secondary.id}`)
    check(readback.status() === 200, 'PENDING_DRAFT_API_READ_FAILED')
    const readbackBody = await readback.json(), publicDraft = readbackBody.draft
    check(publicDraft?.id === secondary.id && publicDraft.extractionRevision === reextracted.extractionRevision
      && publicDraft.latestJob?.id === retryJobId && publicDraft.latestJob.status === 'QUEUED'
      && publicDraft.latestJob.attempts === 0 && publicDraft.latestJob.blockedReason === null, 'PENDING_DRAFT_RESTART_API_MISMATCH')
    await originalBytes(secondaryFixture, afterRestart.secondary, 'blank-after-next-restart-original')
    await screenshot('blank-pending-after-next-restart')
    await page.getByLabel('Stan dokumentów', { exact: true }).selectOption('APPROVED')
    const approvedItem = listItem(INVOICE_OAUTH_EXPECTED.invoiceNumber)
    await expect(approvedItem).toHaveCount(1); await approvedItem.click()
    await expect(page.getByRole('img', { name: PRIMARY_FILE, exact: true })).toBeVisible()
    await expect(page.getByLabel('Kwota brutto', { exact: true })).toHaveValue('123')
    await originalBytes(primaryFixture, afterRestart.primary, 'primary-after-next-restart-original')
    await page.goto(`${baseUrl}/dashboard?year=2026&month=9`); await page.waitForLoadState('networkidle')
    const recognized = page.getByRole('link', { name: /Koszty rozpoznane/ }).locator('xpath=..').locator('strong')
    await expect.poll(async () => invoiceManualPlnAmountMatches(await recognized.innerText())).toBe(true)
    await screenshot('dashboard-only-one-recognized-123-pln-cost')
    await page.goto(`${baseUrl}/finance/cost-events`); await page.waitForLoadState('networkidle')
    const costRow = page.getByRole('row').filter({ hasText: INVOICE_OAUTH_EXPECTED.invoiceNumber })
    await expect(costRow).toHaveCount(1); await expect(costRow).toContainText('JAG 100%')
    await expect(costRow.getByRole('cell', { name: '123 PLN', exact: true })).toHaveCount(1)
    await screenshot('ledger-one-cost-jag-123-pln')
    const finalBudget = await assertBudget(expectedIds, primaryJobId)
    check(await assertOneCost(invoiceId) === costId && permit.count() === 1 && await stoppedState(), 'FINAL_EXTRA_COST_OR_WORKER_START')
    check(!report.uncaughtPageErrors, 'UNCAUGHT_PAGE_ERRORS')
    const integrity = must(await command('/usr/bin/sqlite3', [databasePath, 'PRAGMA integrity_check; PRAGMA foreign_key_check;']), 'SQLITE_INTEGRITY_FAILED')
    check(integrity === 'ok', 'SQLITE_INTEGRITY_OR_FOREIGN_KEYS_FAILED')
    report.final = { primaryDraftId: primary.id, secondaryDraftId: secondary.id, invoiceId, costId,
      jobIds: expectedIds, queueClaims: finalBudget.claims, workerStarts: permit.count(), secondaryPendingAttempts: 0,
      pendingRevision: reextracted.extractionRevision, originalAttachments: 2, invoices: 1, costs: 1,
      recognizedGrossPLN: 123, noExtraClaimsAfterNextRestart: true, originalBytesPreserved: true,
      integrity: 'ok', foreignKeyViolations: 0 }
    pass('NEXT_RESTART_PRESERVED_UNCLAIMED_NEW_JOB_HISTORY_ORIGINAL_BYTES_AND_ONE_123_PLN_COST')
    report.status = 'PASS'
  } catch (error) {
    let stopped = false
    try { if (interruptStopPromise) await interruptStopPromise; else await stopWorker({ cleanup: true }); stopped = true } catch { /* Fail closed; cleanup retries. */ }
    report.status = 'FAIL'; report.failedStep = stepCode
    report.code = stopped ? signal.aborted ? 'INTERRUPTED' : error instanceof GateError ? error.code : 'GATE_CHECK_FAILED' : 'WORKER_STOP_UNVERIFIED'
    if (stopped && syntheticUiSafe && page && !page.isClosed()) {
      try { await screenshot(`failure-${stepCode.toLowerCase()}`) } catch { /* Diagnostic only. */ }
    }
  } finally {
    await cleanup()
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal)
    if (Object.entries(report.cleanup).some(([key, value]) => value === false && key !== 'ownerOAuthTouched')) {
      report.status = 'FAIL'; report.cleanupCode = 'CLEANUP_FAILED'
    }
    if (databasePath && report.cleanup.databaseDisconnected && report.cleanup.serverStopped) {
      try {
        must(await command('/usr/bin/sqlite3', [databasePath, 'PRAGMA wal_checkpoint(TRUNCATE);'], { cleanup: true }), 'SQLITE_CHECKPOINT_FAILED')
        await chmod(databasePath, 0o600)
        report.syntheticDatabaseSha256 = hash(await readFile(databasePath))
      } catch { report.status = 'FAIL'; report.databaseArtifactCode = 'DATABASE_HASH_UNAVAILABLE' }
    }
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 }); await chmod(artifactDirectory, 0o700)
    const reportPath = path.join(artifactDirectory, 'report.json')
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); await chmod(reportPath, 0o600)
    process.stdout.write(`${JSON.stringify({ status: report.status, code: report.code ?? report.cleanupCode ?? report.databaseArtifactCode ?? null, report: reportPath })}\n`)
    process.exitCode = report.status === 'PASS' ? 0 : 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error instanceof GateError ? error.code : 'GATE_START_FAILED' })}\n`)
    process.exitCode = 1
  })
}
