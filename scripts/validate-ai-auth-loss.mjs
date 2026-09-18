#!/usr/bin/env node
/**
 * MANUAL REAL MISSING-AUTH GATE. Prepare/review before running; never runs on import.
 * Usage: node scripts/validate-ai-auth-loss.mjs --confirm-missing-auth \
 *   --image sha256:<exact-local-image-id>
 *
 * This gate supplies a new empty tmpfs at /oauth. It never mounts, reads, copies,
 * changes, or tests an owner's OAuth credentials. It proves startup with missing
 * authentication, not remote credential revocation during an in-flight call and
 * not recovery after credentials are restored. There are no provider overrides,
 * API keys, model fallbacks, OAuth login operations, retries, or internal claim/finish
 * calls. Questions and data are fictional; the first real worker attempt must
 * block AUTH, and the second queued job must remain untouched behind that pause.
 */
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { chatOAuthBrowserLaunchOptions } from './validate-ai-chat-oauth.mjs'

const DOCKER = '/usr/local/bin/docker'
const LOCAL_DOCKER = 'unix:///Users/piotr/.docker/run/docker.sock'
const FIRST_FINISH_DEADLINE_MS = 60_000
const STOP_AFTER_FINISH_LIMIT_MS = 10_000
const HARDENING = [
  '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
  '--tmpfs', '/runtime:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=134217728',
]
const EMPTY_OAUTH_TMPFS = '/oauth:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=16777216'
const QUESTION_A = 'To wyłącznie fikcyjny test braku uwierzytelnienia AI. Odpowiedz jednym zdaniem, że zadanie A dotyczy syntetycznego okresu 2026-08.'
const QUESTION_B = 'To wyłącznie fikcyjny test wstrzymanej kolejki AI. Odpowiedz jednym zdaniem, że zadanie B dotyczy syntetycznego okresu 2026-08.'
const AUTH_MESSAGE = 'AI wymaga ponownego połączenia konta. Po przywróceniu dostępu możesz ponowić zadanie.'
const PAUSED_AUTH_MESSAGE = 'Kolejka jest wstrzymana. AI wymaga ponownego połączenia konta. Po przywróceniu dostępu ponów zadanie.'

class GateError extends Error {
  constructor(code) { super(code); this.code = code }
}
const check = (condition, code) => { if (!condition) throw new GateError(code) }

export function parseAuthLossArgs(args) {
  check(Array.isArray(args), 'INVALID_CONFIG')
  const values = new Map()
  let confirmed = false
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--confirm-missing-auth' && !confirmed) { confirmed = true; continue }
    check(flag === '--image' && !values.has(flag) && typeof args[index + 1] === 'string', 'INVALID_CONFIG')
    values.set(flag, args[++index])
  }
  check(confirmed, 'CONFIRMATION_REQUIRED')
  const image = values.get('--image')
  check(typeof image === 'string' && /^sha256:[a-f0-9]{64}$/.test(image), 'IMMUTABLE_LOCAL_IMAGE_REQUIRED')
  return { image }
}

/** Exactly three secret-free env names are imported; /oauth is a new empty tmpfs. */
export function authLossWorkerArgs(config, name) {
  const { image } = parseAuthLossArgs(['--confirm-missing-auth', '--image', config?.image])
  check(/^wd-ai-auth-loss-worker-[a-zA-Z0-9-]+$/.test(name), 'INVALID_CONTAINER_NAME')
  return [
    'create', '--pull', 'never', '--name', name,
    ...HARDENING, '--tmpfs', EMPTY_OAUTH_TMPFS, '--log-driver', 'none',
    '--env', 'AI_WORKER_ENABLED', '--env', 'AI_WORKER_URL', '--env', 'AI_WORKER_SECRET',
    image, 'worker',
  ]
}

/** IDs stay readable; login names already match the production canonical form. */
export function authLossAccountFixtures(runId) {
  check(typeof runId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(runId), 'INVALID_RUN_ID')
  const suffix = runId.toLowerCase().replace(/[^a-z0-9]/g, '')
  return {
    a: { id: `gate-admin-a-${runId}`, username: `gateadmina${suffix}` },
    b: { id: `gate-admin-b-${runId}`, username: `gateadminb${suffix}` },
  }
}

function controlledOutcome(error, fallback) {
  return { ok: false, code: error instanceof GateError ? error.code : fallback }
}

/**
 * Event gate for a live attach stream. Both rejected internals receive handlers
 * at construction time, before spawn can emit an early error. Public promises
 * always resolve to controlled outcomes, so no startup rejection can escape the
 * surrounding try/finally while its caller is still waiting for STARTED.
 */
export function createAuthLossWorkerEventGate({ stopWorker, now = () => Date.now() }) {
  check(typeof stopWorker === 'function' && typeof now === 'function', 'INVALID_EVENT_GATE')
  let resolveStartup, rejectStartup, resolveFinished, rejectFinished
  let started = false
  let finishObserved = false
  let failureObserved = false
  let expectedStop = false
  let fatal = null
  const rawStartup = new Promise((resolve, reject) => { resolveStartup = resolve; rejectStartup = reject })
  const rawFinished = new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject })
  const startup = rawStartup.catch((error) => controlledOutcome(error, 'WORKER_START_FAILED'))
  const finished = rawFinished.catch((error) => controlledOutcome(error, 'WORKER_FINISH_FAILED'))

  const fail = (code) => {
    if (failureObserved) return
    failureObserved = true
    fatal = code
    const error = new GateError(code)
    rejectStartup(error)
    rejectFinished(error)
  }

  const observeLine = (line) => {
    if (line === 'AI_SESSION_IN_USE' || line === 'AI_WORKER_START_FAILED') { fail(line); return }
    let event
    try { event = JSON.parse(line) } catch { return }
    if (event?.event === 'AI_WORKER_STARTED') {
      if (!started) { started = true; resolveStartup({ ok: true }) }
      return
    }
    if (event?.event !== 'AI_JOB_FINISHED' || !['succeeded', 'failed', 'lease_lost'].includes(event.status) || finishObserved) return
    finishObserved = true
    const observedAt = now()
    let stopping
    try { stopping = stopWorker() } catch (error) { rejectFinished(error); return }
    Promise.resolve(stopping).then(
      () => resolveFinished({ ok: true, value: { status: event.status, stopDelayMs: now() - observedAt } }),
      (error) => rejectFinished(error),
    )
  }

  return {
    startup, finished, observeLine, startedObserved: () => started, fatalCode: () => fatal,
    expectStop: () => { expectedStop = true },
    observeAttachError: () => fail('WORKER_ATTACH_FAILED'),
    observeOutputLimit: () => fail('WORKER_OUTPUT_LIMIT'),
    observeExit: () => { if (!expectedStop && (!started || !finishObserved)) fail('WORKER_EXITED') },
  }
}

/** Bounded wait whose losing timer is cleared and never keeps Node alive. */
export function waitForAuthLossOutcome(promise, timeoutMs, signal, timeoutCode = 'FIRST_FINISH_DEADLINE_REACHED') {
  check(promise && typeof promise.then === 'function' && Number.isFinite(timeoutMs) && timeoutMs > 0, 'INVALID_DEADLINE')
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      resolve(outcome)
    }
    const abort = () => finish({ ok: false, code: 'INTERRUPTED' })
    const timer = setTimeout(() => finish({ ok: false, code: timeoutCode }), timeoutMs)
    timer.unref?.()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    Promise.resolve(promise).then(
      (outcome) => finish(outcome),
      (error) => finish(controlledOutcome(error, 'WORKER_WAIT_FAILED')),
    )
  })
}

function leasesCleared(value) {
  return value?.workerId === null && value?.leaseToken === null && value?.leaseUntil === null
}

function authBlocked(value) {
  return value?.status === 'BLOCKED' && value?.attempts === 1 && value?.errorCode === 'AUTH' &&
    value?.resultJson === null && leasesCleared(value)
}

function authWaiting(value) {
  return value?.status === 'QUEUED' && value?.attempts === 0 && value?.errorCode === null &&
    value?.resultJson === null && leasesCleared(value)
}

/** Pure fail-closed review of the first real worker pass and both visible panels. */
export function assessAuthLossState(evidence) {
  const failures = []
  if (evidence?.firstFinished?.status !== 'failed') failures.push('WRONG_FIRST_EVENT')
  if (!Number.isFinite(evidence?.firstFinished?.stopDelayMs) || evidence.firstFinished.stopDelayMs < 0 || evidence.firstFinished.stopDelayMs >= STOP_AFTER_FINISH_LIMIT_MS) failures.push('WORKER_STOP_TOO_LATE')
  if (evidence?.maxObservedAttempts !== 1) failures.push('UNEXPECTED_RETRY_OR_CLAIM')
  if (!authBlocked(evidence?.jobA)) failures.push('FIRST_JOB_NOT_AUTH_BLOCKED')
  if (!authWaiting(evidence?.jobB)) failures.push('SECOND_JOB_NOT_PAUSED_QUEUED')
  if (evidence?.queue?.pauseReason !== 'AUTH') failures.push('QUEUE_NOT_AUTH_PAUSED')
  if (!leasesCleared(evidence?.jobA) || !leasesCleared(evidence?.jobB) || !leasesCleared(evidence?.queue) || evidence?.jobA?.resultJson !== null || evidence?.jobB?.resultJson !== null) failures.push('LEASE_OR_RESULT_RETAINED')
  if (evidence?.panelA?.authReasonVisible !== true || evidence?.panelA?.retryVisible !== true) failures.push('FIRST_UI_AUTH_NOT_VISIBLE')
  if (evidence?.panelB?.pausedAuthReasonVisible !== true || evidence?.panelB?.retryVisible !== true) failures.push('SECOND_UI_PAUSE_NOT_VISIBLE')
  return { passed: failures.length === 0, failures: [...new Set(failures)] }
}

/** The same stopped container must poll the still-paused queue after Next restart. */
export function assessAuthLossRestart(before, after) {
  const failures = []
  if (!before?.workerContainerId || before.workerContainerId !== after?.workerContainerId) failures.push('WORKER_CONTAINER_CHANGED')
  const beforeTime = Date.parse(before?.queueUpdatedAt ?? '')
  const afterTime = Date.parse(after?.queueUpdatedAt ?? '')
  if (!Number.isFinite(beforeTime) || !Number.isFinite(afterTime) || afterTime <= beforeTime) failures.push('PAUSED_CLAIM_NOT_OBSERVED')
  if (!isDeepStrictEqual(after?.jobA, before?.jobA) || !authBlocked(after?.jobA)) failures.push('BLOCKED_JOB_CHANGED_ON_RESTART')
  if (!isDeepStrictEqual(after?.jobB, before?.jobB) || !authWaiting(after?.jobB)) failures.push('WAITING_JOB_CHANGED_ON_RESTART')
  if (after?.queue?.pauseReason !== 'AUTH' || !leasesCleared(after?.queue)) failures.push('QUEUE_NOT_AUTH_PAUSED_AFTER_RESTART')
  if (after?.panelA?.authReasonVisible !== true || after?.panelA?.retryVisible !== true ||
      after?.panelB?.pausedAuthReasonVisible !== true || after?.panelB?.retryVisible !== true) failures.push('AUTH_WARNINGS_NOT_VISIBLE_AFTER_RESTART')
  if (after?.apiReadbackMatched !== true) failures.push('RESTART_API_READBACK_MISMATCH')
  return { passed: failures.length === 0, failures: [...new Set(failures)] }
}

async function main(args) {
  // Consent and all external targets are validated before any I/O.
  const config = parseAuthLossArgs(args)
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const artifactDirectory = path.join(repository, 'test-results', `ai-auth-loss-${runId}`)
  const controller = new AbortController()
  const signal = controller.signal
  const childEnvironment = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' }
  const report = {
    status: 'RUNNING', runId, imageId: config.image,
    scope: 'Pinned real worker with an empty disposable /oauth tmpfs, local production UI/API and migrated synthetic SQLite only.',
    boundary: 'Proves missing authentication at worker startup. Does not test owner credentials, remote revocation during a call, provider request count, restored-credential recovery, or production data.',
    uiNetworkRecoveryTested: false,
    limits: { plannedQueueExecutionAttempts: 1, maxObservedQueueAttempts: 1, firstFinishDeadlineMs: FIRST_FINISH_DEADLINE_MS, stopAfterFinishLimitMs: STOP_AFTER_FINISH_LIMIT_MS, providerHttpCount: 'NOT_OBSERVED' },
    jobs: {}, workerEvents: [], screenshots: [], passed: [], cleanup: {},
  }
  let directory, databasePath, db, browser, server, serverReady = false
  let workerAttach, workerName, probeName, workerRunning = false, activeWorkerLifecycle, cleanupPromise
  let currentStep = 'PREFLIGHT'
  const resources = new Set()
  const processAlive = (child) => child && child.exitCode === null && child.signalCode === null
  const assertNotAborted = () => check(!signal.aborted, 'INTERRUPTED')
  const step = (code) => { report.passed.push(code); process.stdout.write(`PASS ${code}\n`) }

  // Never print or persist stderr, raw command arguments, environment, cookies,
  // passwords, auth contents, lease tokens, model prose, or unfiltered logs.
  async function command(binary, commandArgs, { timeoutMs = 20_000, env = childEnvironment, cleanup = false, cwd } = {}) {
    if (!cleanup) assertNotAborted()
    return new Promise((resolve, reject) => {
      const child = spawn(binary, commandArgs, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', size = 0, timedOut = false
      const stop = () => child.kill('SIGKILL')
      const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
      if (!cleanup) signal.addEventListener('abort', stop, { once: true })
      child.stdout.on('data', (chunk) => { size += chunk.length; if (size > 1024 * 1024) stop(); else stdout += chunk.toString() })
      child.stderr.on('data', (chunk) => { size += chunk.length; if (size > 1024 * 1024) stop() })
      child.once('error', () => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(new GateError('COMMAND_START_FAILED')) })
      child.once('close', (code) => {
        clearTimeout(timer); signal.removeEventListener('abort', stop)
        if (timedOut || size > 1024 * 1024) reject(new GateError(timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_OUTPUT_LIMIT'))
        else resolve({ code, stdout })
      })
    })
  }
  const docker = (commandArgs, options) => command(DOCKER, ['--host', LOCAL_DOCKER, ...commandArgs], options)
  const must = (result, code) => { check(result.code === 0, code); return result.stdout.trim() }

  async function stopServer() {
    if (!processAlive(server)) return
    const child = server
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    try { await closed } finally { clearTimeout(timer); serverReady = false }
  }

  async function stopWorker({ cleanup = false } = {}) {
    if (!workerName || !workerRunning) return
    activeWorkerLifecycle?.expectStop()
    const stopped = await docker(['stop', '--time', '5', workerName], { timeoutMs: 9_000, cleanup })
    check(stopped.code === 0, 'WORKER_STOP_FAILED')
    const state = must(await docker(['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', workerName], { cleanup }), 'WORKER_STATE_FAILED')
    check(state === 'false 0', 'WORKER_DID_NOT_STOP_CLEANLY')
    if (processAlive(workerAttach)) {
      await Promise.race([new Promise((resolve) => workerAttach.once('close', resolve)), delay(1000)])
      check(!processAlive(workerAttach), 'WORKER_ATTACH_NOT_CLOSED')
    }
    workerRunning = false
  }

  async function cleanup() {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      try { await stopWorker({ cleanup: true }); report.cleanup.workerStopped = true } catch { report.cleanup.workerStopped = false }
      for (const name of resources) {
        try { report.cleanup[name] = (await docker(['rm', '--force', name], { cleanup: true })).code === 0 }
        catch { report.cleanup[name] = false }
      }
      if (processAlive(workerAttach)) workerAttach.kill('SIGKILL')
      try { await browser?.close(); report.cleanup.browserClosed = true } catch { report.cleanup.browserClosed = false }
      try { await stopServer(); report.cleanup.serverStopped = true } catch { report.cleanup.serverStopped = false }
      try { await db?.$disconnect(); report.cleanup.databaseDisconnected = true } catch { report.cleanup.databaseDisconnected = false }
      report.cleanup.oauthVolumeCreatedOrRemoved = false
      report.cleanup.syntheticDirectoryRetained = directory ?? null
    })()
    return cleanupPromise
  }

  const onSignal = () => {
    controller.abort()
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  function selectedJob(row) {
    return {
      id: row.id, status: row.status, attempts: row.attempts, errorCode: row.errorCode,
      resultJson: row.resultJson, workerId: row.workerId, leaseToken: row.leaseToken, leaseUntil: row.leaseUntil,
    }
  }

  try {
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
    const imageMetadata = must(await docker(['image', 'inspect', '--format', '{{.Id}}|{{.Os}}|{{.Config.User}}|{{json .Config.Entrypoint}}', config.image]), 'LOCAL_IMAGE_NOT_FOUND')
    check(imageMetadata === `${config.image}|linux|node|["/usr/bin/tini","--","/opt/ai/worker/ai/entrypoint.sh"]`, 'UNEXPECTED_IMAGE_BOUNDARY')
    const buildId = (await readFile(path.join(repository, '.next/BUILD_ID'), 'utf8')).trim()
    check(/^[a-zA-Z0-9_-]+$/.test(buildId), 'PRODUCTION_BUILD_REQUIRED')
    report.buildId = buildId

    directory = await mkdtemp(path.join(tmpdir(), 'wd-ai-auth-loss-'))
    databasePath = path.join(directory, 'synthetic.sqlite')
    const databaseUrl = `file:${databasePath}`
    const password = randomBytes(24).toString('base64url')
    const workerSecret = randomBytes(48).toString('base64url')
    const portProbe = createServer()
    await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve) })
    const port = portProbe.address().port
    await new Promise((resolve) => portProbe.close(resolve))
    const baseUrl = `http://127.0.0.1:${port}`
    const environment = {
      ...childEnvironment, NODE_ENV: 'production', DATABASE_URL: databaseUrl, NEXTAUTH_URL: baseUrl,
      NEXTAUTH_SECRET: randomBytes(48).toString('base64url'), AI_WORKER_SECRET: workerSecret,
      NEXT_TELEMETRY_DISABLED: '1',
    }
    report.baseUrl = baseUrl
    report.syntheticDatabase = databasePath

    for (const name of ['node_modules', 'public']) await symlink(path.join(repository, name), path.join(directory, name), 'dir')
    const buildDirectory = path.join(repository, '.next')
    await cp(buildDirectory, path.join(directory, '.next'), { recursive: true, filter(source) {
      return !['cache', 'standalone'].includes(path.relative(buildDirectory, source).split(path.sep)[0])
    } })
    await mkdir(path.join(directory, 'prisma'))
    await cp(path.join(repository, 'prisma/schema.prisma'), path.join(directory, 'prisma/schema.prisma'))
    await cp(path.join(repository, 'prisma/migrations'), path.join(directory, 'prisma/migrations'), { recursive: true })
    must(await command('/usr/bin/sqlite3', [databasePath, 'VACUUM;']), 'SYNTHETIC_DATABASE_CREATE_FAILED')
    must(await command(process.execPath, [path.join(repository, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(directory, 'prisma/schema.prisma')], {
      timeoutMs: 30_000, env: environment, cwd: directory,
    }), 'SYNTHETIC_MIGRATION_FAILED')

    const [{ default: bcrypt }, { chromium, expect }, { PrismaClient }] = await Promise.all([
      import('bcryptjs'), import('@playwright/test'), import('../src/generated/prisma/index.js'),
    ])
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    const passwordHash = await bcrypt.hash(password, 10)
    const users = authLossAccountFixtures(runId)
    for (const [label, account] of Object.entries(users)) await db.user.create({ data: {
      id: account.id, username: account.username, email: `${account.username}@example.test`, name: `SYNTHETIC ADMIN ${label.toUpperCase()}`,
      passwordHash, role: 'ADMIN', mustChangePassword: false, isActive: true,
    } })
    for (const [id, name] of [['PUL', 'Fikcyjny Salon B'], ['JAG', 'Fikcyjny Salon A'], ['GLOBAL', 'Fikcyjne wspólne']]) {
      await db.costCenter.create({ data: { id, name } })
    }
    await db.revenue.create({ data: { year: 2026, month: 8, amount: 12345, costCenterId: 'PUL', channel: 'SALON', asOfDate: '2026-08-31' } })

    async function startServer() {
      assertNotAborted()
      serverReady = false
      let addressConflict = false
      server = spawn(process.execPath, [path.join(repository, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
        cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      })
      const consume = (chunk) => {
        const text = chunk.toString()
        if (text.includes('Ready in')) serverReady = true
        if (text.includes('EADDRINUSE')) addressConflict = true
      }
      server.stdout.on('data', consume)
      server.stderr.on('data', consume)
      server.once('error', () => { addressConflict = true })
      for (let attempt = 0; attempt < 200; attempt++) {
        assertNotAborted()
        check(processAlive(server) && !addressConflict, 'LOOPBACK_NEXT_START_FAILED')
        if (serverReady && await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000), redirect: 'error' }).then((response) => response.ok).catch(() => false)) return
        await delay(100, undefined, { signal })
      }
      throw new GateError('LOOPBACK_NEXT_START_TIMEOUT')
    }

    async function startWorker() {
      assertNotAborted()
      check(!workerRunning, 'WORKER_ALREADY_RUNNING')
      const lifecycle = createAuthLossWorkerEventGate({ stopWorker, now: () => Date.now() })
      activeWorkerLifecycle = lifecycle
      workerAttach = spawn(DOCKER, ['--host', LOCAL_DOCKER, 'start', '--attach', workerName], {
        env: childEnvironment, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      })
      workerRunning = true
      let pending = '', outputSize = 0
      const consume = (chunk) => {
        outputSize += chunk.length
        if (outputSize > 64_000) { lifecycle.observeOutputLimit(); return }
        pending += chunk.toString()
        const lines = pending.split('\n')
        pending = lines.pop()
        for (const line of lines) {
          try {
            const event = JSON.parse(line)
            if (event?.event === 'AI_WORKER_STARTED') report.workerEvents.push({ event: 'AI_WORKER_STARTED' })
            if (event?.event === 'AI_JOB_FINISHED' && ['succeeded', 'failed', 'lease_lost'].includes(event.status)) report.workerEvents.push({ event: 'AI_JOB_FINISHED', status: event.status })
          } catch { /* Only fixed recognized events are reported. */ }
          lifecycle.observeLine(line)
        }
      }
      workerAttach.stdout.on('data', consume)
      workerAttach.stderr.on('data', consume)
      workerAttach.once('error', lifecycle.observeAttachError)
      workerAttach.once('close', lifecycle.observeExit)
      const startup = await waitForAuthLossOutcome(lifecycle.startup, 15_000, signal, 'WORKER_START_TIMEOUT')
      check(startup.ok && lifecycle.startedObserved(), startup.code ?? 'WORKER_START_FAILED')
      check(!lifecycle.fatalCode(), lifecycle.fatalCode() ?? 'WORKER_START_FAILED')
      return lifecycle
    }

    async function login(username) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      const page = await context.newPage()
      page.setDefaultTimeout(12_000)
      page.on('pageerror', () => { report.uncaughtPageErrors = (report.uncaughtPageErrors ?? 0) + 1 })
      await page.goto(`${baseUrl}/login`)
      await page.waitForLoadState('networkidle')
      await page.getByLabel('Login', { exact: true }).fill(username)
      await page.getByLabel('Hasło', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
      await page.waitForURL((url) => !url.pathname.includes('login'))
      await page.waitForLoadState('networkidle')
      return page
    }

    async function openFinance(page) {
      await page.goto(`${baseUrl}/dashboard?year=2026&month=8`)
      await page.waitForLoadState('networkidle')
      await page.getByTitle('AI Analyst', { exact: true }).click()
      await page.getByLabel('Rok danych', { exact: true }).selectOption('2026')
      await page.getByLabel('Miesiąc danych', { exact: true }).selectOption('8')
    }

    async function submit(page, question, label) {
      check(!workerRunning, 'SUBMIT_REQUIRES_STOPPED_WORKER')
      const input = page.getByPlaceholder('Zadaj pytanie o finanse...')
      await input.fill(question)
      const posted = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/ai/chat' && response.request().method() === 'POST')
      await input.press('Enter')
      const response = await posted
      check(response.status() === 202, 'UI_SUBMIT_FAILED')
      const { job } = await response.json()
      check(job?.kind === 'FINANCE_CHAT' && job.status === 'QUEUED' && job.attempts === 0 && job.result === null, 'INITIAL_QUEUED_STATE_INVALID')
      await expect(page.getByRole('status').filter({ hasText: 'W kolejce' })).toBeVisible()
      report.jobs[label] = { id: job.id, kind: job.kind, initialStatus: job.status, attempts: job.attempts }
      return job.id
    }

    async function screenshot(page, label) {
      const target = path.join(artifactDirectory, `${label}.png`)
      await page.screenshot({ path: target, fullPage: true })
      await chmod(target, 0o600)
      report.screenshots.push(target)
    }

    currentStep = 'LOOPBACK_CONTAINER_HEALTH'
    await startServer()
    probeName = `wd-ai-auth-loss-probe-${runId}`
    resources.add(probeName)
    const healthCode = `fetch(${JSON.stringify(`http://host.docker.internal:${port}/api/health`)},{signal:AbortSignal.timeout(5000),redirect:'error'}).then(r=>{if(!r.ok)process.exit(1);process.stdout.write('LOOPBACK_HEALTH_OK')}).catch(()=>process.exit(1))`
    const health = await docker(['run', '--pull', 'never', '--name', probeName, ...HARDENING, '--entrypoint', '/usr/local/bin/node', config.image, '-e', healthCode], { timeoutMs: 10_000 })
    check(health.code === 0 && health.stdout === 'LOOPBACK_HEALTH_OK', 'HOST_GATEWAY_CANNOT_REACH_LOOPBACK_NO_WIDER_BIND_ALLOWED')
    must(await docker(['rm', probeName]), 'PROBE_CLEANUP_FAILED')
    resources.delete(probeName)

    workerName = `wd-ai-auth-loss-worker-${runId}`
    resources.add(workerName)
    must(await docker(authLossWorkerArgs(config, workerName), { env: {
      ...childEnvironment, AI_WORKER_ENABLED: 'true',
      AI_WORKER_URL: `http://host.docker.internal:${port}/api/internal/ai-worker`,
      AI_WORKER_SECRET: workerSecret,
    } }), 'WORKER_CREATE_FAILED')
    const workerContainerId = must(await docker(['inspect', '--format', '{{.Id}}', workerName]), 'WORKER_ID_FAILED')
    check(/^[a-f0-9]{64}$/.test(workerContainerId), 'WORKER_ID_INVALID')
    step('SYNTHETIC_DB_MIGRATED_EMPTY_OAUTH_WORKER_CREATED_LOOPBACK_REACHABLE')

    currentStep = 'TWO_FINANCE_UI_JOBS'
    browser = await chromium.launch(chatOAuthBrowserLaunchOptions(directory))
    const pageA = await login(users.a.username)
    const pageB = await login(users.b.username)
    await openFinance(pageA)
    await openFinance(pageB)
    const jobAId = await submit(pageA, QUESTION_A, 'a')
    await delay(20, undefined, { signal })
    const jobBId = await submit(pageB, QUESTION_B, 'b')
    check(await db.aiJob.count() === 2, 'UNEXPECTED_JOB_COUNT')
    const queuedOrder = await db.aiJob.findMany({ where: { status: 'QUEUED' }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }], select: { id: true } })
    check(isDeepStrictEqual(queuedOrder.map(({ id }) => id), [jobAId, jobBId]), 'FIRST_JOB_ORDER_NOT_DETERMINISTIC')
    step('TWO_SEPARATE_FINANCE_UI_JOBS_QUEUED_WHILE_WORKER_STOPPED')

    currentStep = 'REAL_MISSING_AUTH_ATTEMPT'
    const firstLifecycle = await startWorker()
    check(!firstLifecycle.fatalCode(), firstLifecycle.fatalCode() ?? 'WORKER_FAILED_AFTER_START')
    const finished = await waitForAuthLossOutcome(firstLifecycle.finished, FIRST_FINISH_DEADLINE_MS, signal)
    check(finished.ok, finished.code ?? 'WORKER_FINISH_FAILED')
    check(!firstLifecycle.fatalCode(), firstLifecycle.fatalCode() ?? 'WORKER_FAILED_AFTER_FINISH')
    const finishOutcome = finished.value
    check(!workerRunning && finishOutcome.stopDelayMs < STOP_AFTER_FINISH_LIMIT_MS, 'WORKER_STOP_TOO_LATE')

    const [rowA, rowB, queue] = await Promise.all([
      db.aiJob.findUniqueOrThrow({ where: { id: jobAId } }),
      db.aiJob.findUniqueOrThrow({ where: { id: jobBId } }),
      db.aiQueueLease.findUniqueOrThrow({ where: { id: 'shared-ai' } }),
    ])
    const controlledFailures = new Set(['AUTH', 'QUOTA', 'MODEL_UNAVAILABLE', 'TIMEOUT', 'RUNNER_ERROR', 'INVALID_RESULT', 'LEASE_EXPIRED', 'ACCESS_REVOKED', 'PAYLOAD_INVALID'])
    report.actualFailureCode = controlledFailures.has(rowA.errorCode) ? rowA.errorCode : 'UNCONTROLLED'
    report.jobs.a = { ...report.jobs.a, status: rowA.status, attempts: rowA.attempts, errorCode: report.actualFailureCode }
    report.jobs.b = { ...report.jobs.b, status: rowB.status, attempts: rowB.attempts, blockedReason: queue.pauseReason }
    check(rowA.errorCode === 'AUTH', `ACTUAL_FAILURE_${report.actualFailureCode}`)

    await expect(pageA.getByRole('alert').filter({ hasText: AUTH_MESSAGE })).toBeVisible({ timeout: 15_000 })
    await expect(pageA.getByRole('button', { name: 'Ponów zadanie', exact: true })).toBeVisible()
    await expect(pageB.getByRole('alert').filter({ hasText: PAUSED_AUTH_MESSAGE })).toBeVisible({ timeout: 15_000 })
    await expect(pageB.getByRole('button', { name: 'Ponów zadanie', exact: true })).toBeVisible()
    const maxObservedAttempts = Math.max(rowA.attempts, rowB.attempts)
    const stateEvidence = {
      firstFinished: finishOutcome,
      maxObservedAttempts,
      jobA: selectedJob(rowA), jobB: selectedJob(rowB),
      queue: { pauseReason: queue.pauseReason, workerId: queue.workerId, leaseToken: queue.leaseToken, leaseUntil: queue.leaseUntil },
      panelA: { authReasonVisible: true, retryVisible: true },
      panelB: { pausedAuthReasonVisible: true, retryVisible: true },
    }
    const initialAssessment = assessAuthLossState(stateEvidence)
    check(initialAssessment.passed, initialAssessment.failures[0] ?? 'AUTH_LOSS_STATE_FAILED')
    await screenshot(pageA, 'job-a-auth-blocked')
    await screenshot(pageB, 'job-b-queue-paused')
    step('REAL_EMPTY_OAUTH_AUTH_BLOCK_STOPPED_BEFORE_SECOND_CLAIM_AND_VISIBLE_IN_UI')

    currentStep = 'NEXT_AND_SAME_WORKER_RESTART'
    const beforeRestart = {
      workerContainerId: `sha256:${workerContainerId}`,
      queueUpdatedAt: queue.updatedAt.toISOString(),
      jobA: selectedJob(rowA), jobB: selectedJob(rowB),
    }
    async function readPublicJob(page, jobId) {
      const response = await page.request.get(`${baseUrl}/api/ai/jobs/${jobId}`, { timeout: 10_000 })
      check(response.status() === 200, 'OWNER_JOB_READ_FAILED')
      check(response.headers()['cache-control'] === 'private, no-store', 'JOB_CACHE_BOUNDARY_FAILED')
      const body = await response.json()
      check(body?.job && !Object.hasOwn(body.job, 'payloadJson') && !Object.hasOwn(body.job, 'leaseToken'), 'PUBLIC_JOB_SECRET_BOUNDARY_FAILED')
      return body.job
    }
    const apiBeforeA = await readPublicJob(pageA, jobAId)
    const apiBeforeB = await readPublicJob(pageB, jobBId)
    check(apiBeforeA.status === 'BLOCKED' && apiBeforeA.attempts === 1 && apiBeforeA.errorCode === 'AUTH' && apiBeforeA.blockedReason === 'AUTH' && apiBeforeA.result === null, 'FIRST_API_AUTH_STATE_MISMATCH')
    check(apiBeforeB.status === 'QUEUED' && apiBeforeB.attempts === 0 && apiBeforeB.errorCode === null && apiBeforeB.blockedReason === 'AUTH' && apiBeforeB.result === null, 'SECOND_API_PAUSED_STATE_MISMATCH')
    check((await pageB.request.get(`${baseUrl}/api/ai/jobs/${jobAId}`)).status() === 404, 'FIRST_JOB_OWNER_BOUNDARY_FAILED')
    check((await pageA.request.get(`${baseUrl}/api/ai/jobs/${jobBId}`)).status() === 404, 'SECOND_JOB_OWNER_BOUNDARY_FAILED')
    await stopServer()
    await startServer()
    // The terminal panels have no GET-resume control: their only button is a
    // retry POST and is deliberately not clicked. We prove that the warnings
    // remain visible, while separate authenticated owner GETs recover identical
    // private/no-store API content after the real Next restart.
    const apiAfterA = await readPublicJob(pageA, jobAId)
    const apiAfterB = await readPublicJob(pageB, jobBId)
    const apiReadbackMatched = isDeepStrictEqual(apiAfterA, apiBeforeA) && isDeepStrictEqual(apiAfterB, apiBeforeB)
    check(apiReadbackMatched, 'RESTART_API_READBACK_MISMATCH')
    check((await pageB.request.get(`${baseUrl}/api/ai/jobs/${jobAId}`)).status() === 404, 'FIRST_JOB_OWNER_BOUNDARY_AFTER_RESTART_FAILED')
    check((await pageA.request.get(`${baseUrl}/api/ai/jobs/${jobBId}`)).status() === 404, 'SECOND_JOB_OWNER_BOUNDARY_AFTER_RESTART_FAILED')
    await expect(pageA.getByRole('alert').filter({ hasText: AUTH_MESSAGE })).toBeVisible()
    await expect(pageA.getByRole('button', { name: 'Ponów zadanie', exact: true })).toBeVisible()
    await expect(pageB.getByRole('alert').filter({ hasText: PAUSED_AUTH_MESSAGE })).toBeVisible()
    await expect(pageB.getByRole('button', { name: 'Ponów zadanie', exact: true })).toBeVisible()

    const restartLifecycle = await startWorker()
    check(!restartLifecycle.fatalCode(), restartLifecycle.fatalCode() ?? 'RESTART_WORKER_FAILED_AFTER_START')
    const pausedPollDeadline = Date.now() + 12_000
    let advancedQueue
    while (Date.now() < pausedPollDeadline) {
      assertNotAborted()
      check(!restartLifecycle.fatalCode(), restartLifecycle.fatalCode() ?? 'RESTART_WORKER_FAILED_DURING_POLL')
      advancedQueue = await db.aiQueueLease.findUniqueOrThrow({ where: { id: 'shared-ai' } })
      if (advancedQueue.updatedAt > queue.updatedAt) break
      await delay(100, undefined, { signal })
    }
    check(!restartLifecycle.fatalCode(), restartLifecycle.fatalCode() ?? 'RESTART_WORKER_FAILED_DURING_POLL')
    check(advancedQueue?.updatedAt > queue.updatedAt, 'PAUSED_CLAIM_NOT_OBSERVED')
    await stopWorker()
    check(!restartLifecycle.fatalCode(), restartLifecycle.fatalCode() ?? 'RESTART_WORKER_FAILED_ON_STOP')
    const [restartA, restartB, restartQueue] = await Promise.all([
      db.aiJob.findUniqueOrThrow({ where: { id: jobAId } }),
      db.aiJob.findUniqueOrThrow({ where: { id: jobBId } }),
      db.aiQueueLease.findUniqueOrThrow({ where: { id: 'shared-ai' } }),
    ])
    const afterWorkerContainerId = must(await docker(['inspect', '--format', '{{.Id}}', workerName]), 'WORKER_ID_FAILED')
    const afterRestart = {
      workerContainerId: `sha256:${afterWorkerContainerId}`,
      queueUpdatedAt: restartQueue.updatedAt.toISOString(),
      jobA: selectedJob(restartA), jobB: selectedJob(restartB),
      queue: { pauseReason: restartQueue.pauseReason, workerId: restartQueue.workerId, leaseToken: restartQueue.leaseToken, leaseUntil: restartQueue.leaseUntil },
      panelA: { authReasonVisible: true, retryVisible: true },
      panelB: { pausedAuthReasonVisible: true, retryVisible: true },
      apiReadbackMatched,
    }
    const restartAssessment = assessAuthLossRestart(beforeRestart, afterRestart)
    check(restartAssessment.passed, restartAssessment.failures[0] ?? 'AUTH_LOSS_RESTART_FAILED')
    check(!restartLifecycle.fatalCode(), restartLifecycle.fatalCode() ?? 'RESTART_WORKER_FAILED_BEFORE_REPORT')
    report.restart = {
      sameWorkerContainer: true, queueLeaseUpdatedAtAdvanced: true,
      pendingJobsDurable: [
        { id: restartA.id, status: restartA.status, attempts: restartA.attempts },
        { id: restartB.id, status: restartB.status, attempts: restartB.attempts },
      ],
      explicitRetryPosts: 0, restoredCredentialsTested: false,
      authWarningsRemainVisible: true, authenticatedOwnerApiReadbackMatched: true,
      ownerBoundaryVerified: true, privateNoStoreVerified: true, uiNetworkRecoveryTested: false,
    }
    step('NEXT_RESTART_AND_SAME_EMPTY_OAUTH_WORKER_POLL_PRESERVED_AUTH_PAUSE')

    currentStep = 'FINAL_READBACK'
    check(await db.revenue.count() === 1 && (await db.revenue.findFirstOrThrow()).amount === 12345, 'FINANCE_FIXTURE_CHANGED')
    check(await db.ksefInvoice.count() === 0 && await db.costEvent.count() === 0, 'AUTH_GATE_CREATED_FINANCE_DOCUMENTS')
    const integrity = must(await command('/usr/bin/sqlite3', [databasePath, 'PRAGMA integrity_check; PRAGMA foreign_key_check;']), 'SQLITE_INTEGRITY_COMMAND_FAILED')
    check(integrity === 'ok', 'SQLITE_INTEGRITY_OR_FOREIGN_KEYS_FAILED')
    check(!report.uncaughtPageErrors, 'UNCAUGHT_PAGE_ERRORS')
    check((await stat(databasePath)).isFile(), 'SYNTHETIC_DB_MISSING')
    report.observedQueueExecutionAttempts = restartA.attempts + restartB.attempts
    check(report.observedQueueExecutionAttempts === 1, 'UNEXPECTED_RETRY_OR_CLAIM')
    check(!firstLifecycle.fatalCode() && !restartLifecycle.fatalCode(), firstLifecycle.fatalCode() ?? restartLifecycle.fatalCode() ?? 'WORKER_LIFECYCLE_FAILED')
    report.financeReadback = { revenues: 1, revenueAmount: 12345, ksefInvoices: 0, costEvents: 0, integrity: 'ok', foreignKeyViolations: 0 }
    report.status = 'PASS'
  } catch (error) {
    report.status = 'FAIL'
    report.failedStep = currentStep
    report.code = signal.aborted ? 'INTERRUPTED' : error instanceof GateError ? error.code : 'GATE_CHECK_FAILED'
    if (report.code === 'HOST_GATEWAY_CANNOT_REACH_LOOPBACK_NO_WIDER_BIND_ALLOWED') {
      report.actionRequired = 'Docker host.docker.internal cannot reach 127.0.0.1. The gate stopped; it never widens the bind to 0.0.0.0.'
    }
  } finally {
    await cleanup()
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    const cleanupFailed = Object.entries(report.cleanup).some(([key, value]) => value === false && key !== 'oauthVolumeCreatedOrRemoved')
    if (cleanupFailed) { report.status = 'FAIL'; report.cleanupCode = 'CLEANUP_FAILED' }
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(artifactDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    process.stdout.write(`${JSON.stringify({ status: report.status, code: report.code ?? report.cleanupCode ?? null, report: path.join(artifactDirectory, 'report.json') })}\n`)
    process.exitCode = report.status === 'PASS' ? 0 : 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error instanceof GateError ? error.code : 'GATE_START_FAILED' })}\n`)
    process.exitCode = 1
  })
}
