#!/usr/bin/env node
/**
 * MANUAL REAL-OAUTH GATE. Prepare/review before running; never runs on import.
 * Requires completed Linux isolation and synthetic three-call OAuth smoke gates.
 * node scripts/validate-ai-chat-oauth.mjs --confirm-synthetic-oauth \
 *   --image sha256:<exact-local-image-id> --oauth-volume <existing-dedicated-volume>
 *
 * Three model jobs maximum on the normal path. The fourth queue job tests ONLY
 * revocation of a fictional manager's application role (zero model attempts).
 * No OAuth reads/copies/revocation, stubbed protocol, provider overrides, image
 * builds, production data, owner credentials, API keys, or automatic retries.
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const DOCKER = '/usr/local/bin/docker'
const LOCAL_DOCKER = 'unix:///Users/piotr/.docker/run/docker.sock'
const MAX_MODEL_ATTEMPTS = 4
const JOB_DEADLINE_MS = 135_000 // Includes worker startup/HTTP around its fixed 120s runner deadline.
const HARDENING = [
  '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
  '--tmpfs', '/runtime:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=134217728',
]
const FINANCE_EXPECTED = Object.freeze({ year: 2026, month: 8, currency: 'PLN', revenue: 12345, costs: 0, costsConfirmed: false, result: 12345, complete: false, missingChannel: null, yoyAvailable: false })
const WIKI_EXPECTED = Object.freeze({ procedureCode: 'TEST-ALFA', waitingMinutes: 7, packageColour: null })
const FINANCE_QUESTION = 'To fikcyjny test. W answer zwróć wyłącznie JSON: year i month z period, currency, revenue, costs, costsConfirmed, result, complete z selected; missingChannel to kwota brakującego kanału (null gdy brak); yoyAvailable to boolean czy yoy istnieje. Nie zamieniaj braków na zero i nie potwierdzaj niepełnych kosztów.'
const WIKI_QUESTION = 'To fikcyjny test. Na podstawie tego artykułu w answer zwróć wyłącznie JSON: procedureCode (kod procedury), waitingMinutes (liczba minut oczekiwania), packageColour (kolor opakowania, null jeśli artykuł go nie podaje). Nie dopowiadaj brakujących faktów.'

class GateError extends Error {
  constructor(code) { super(code); this.code = code }
}
const check = (condition, code) => { if (!condition) throw new GateError(code) }

export function chatOAuthFixtureUsernames(runId) {
  check(typeof runId === 'string' && /^[0-9]{13}-[a-f0-9]{8}$/.test(runId), 'INVALID_FIXTURE_RUN_ID')
  const suffix = runId.replace('-', '')
  return Object.fromEntries(['admin', 'otheradmin', 'manager', 'employee'].map((role) => [role, `gate${role}${suffix}`]))
}

export function parseChatOAuthArgs(args) {
  check(Array.isArray(args) && args.includes('--confirm-synthetic-oauth'), 'CONFIRMATION_REQUIRED')
  const values = new Map()
  let confirmed = false
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--confirm-synthetic-oauth' && !confirmed) { confirmed = true; continue }
    check(['--image', '--oauth-volume'].includes(flag) && !values.has(flag) && typeof args[i + 1] === 'string', 'INVALID_CONFIG')
    values.set(flag, args[++i])
  }
  const image = values.get('--image')
  const oauthVolume = values.get('--oauth-volume')
  check(typeof image === 'string' && /^sha256:[a-f0-9]{64}$/.test(image), 'IMMUTABLE_LOCAL_IMAGE_REQUIRED')
  check(typeof oauthVolume === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/.test(oauthVolume), 'EXPLICIT_NAMED_VOLUME_REQUIRED')
  return { image, oauthVolume }
}

/** Arguments contain no secret value. Docker imports three explicit env names. */
export function chatOAuthWorkerArgs(config, name) {
  const validated = parseChatOAuthArgs(['--confirm-synthetic-oauth', '--image', config.image, '--oauth-volume', config.oauthVolume])
  check(/^wd-ai-oauth-chat-[a-zA-Z0-9-]+$/.test(name), 'INVALID_CONTAINER_NAME')
  return ['create', '--pull', 'never', '--name', name, ...HARDENING,
    '--mount', `type=volume,src=${validated.oauthVolume},dst=/oauth`,
    '--env', 'AI_WORKER_ENABLED', '--env', 'AI_WORKER_URL', '--env', 'AI_WORKER_SECRET',
    validated.image, 'worker']
}

export function chatOAuthBrowserLaunchOptions(directory) {
  check(typeof directory === 'string' && path.isAbsolute(directory), 'PRIVATE_BROWSER_DIRECTORY_REQUIRED')
  return { headless: true, env: {
    PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', HOME: directory, TMPDIR: directory,
  } }
}

/** Checks fixed facts; never persists/returns arbitrary provider text. */
export function assessChatEvidence(kind, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== 1 ||
    typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > 40_000) return { passed: false, code: 'INVALID_RESULT' }
  const expected = kind === 'FINANCE_CHAT' ? FINANCE_EXPECTED : kind === 'WIKI_CHAT' ? WIKI_EXPECTED : null
  if (!expected) return { passed: false, code: 'INVALID_KIND' }
  try {
    const answer = result.answer.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')
    if (!isDeepStrictEqual(JSON.parse(answer), expected)) return { passed: false, code: 'VALUE_MISMATCH' }
    return { passed: true, checked: { ...expected } }
  } catch { return { passed: false, code: 'INVALID_RESULT' } }
}

export function visibleChatAnswer(kind, answer) {
  // Finance uses individual spans separated by BR, which contributes no text
  // to Playwright's textContent matcher. Wiki instead renders Markdown.
  return kind === 'WIKI_CHAT' ? answer.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1')
    : answer.split('\n').map((line) => line.replace(/\*(.*?)\*/g, '$1')).join('')
}

export function chatAnswerMatchKey(kind, answer) {
  // Playwright text matching removes these invisible characters, trims, and
  // collapses whitespace even with exact:true. Use the identical count key.
  return visibleChatAnswer(kind, answer).replace(/[\u200b\u00ad]/g, '').trim().replace(/\s+/g, ' ')
}

export async function loadChatResultSchema() {
  const { tsImport } = await import('tsx/esm/api')
  const contracts = await tsImport('../src/lib/ai/contracts.ts', import.meta.url)
  const schema = contracts.aiChatResultSchema ?? contracts.default?.aiChatResultSchema
  check(schema && typeof schema.safeParse === 'function', 'PRODUCTION_RESULT_SCHEMA_UNAVAILABLE')
  return schema
}

async function main(args) {
  // Validate consent and all externally chosen targets before imports or I/O.
  const config = parseChatOAuthArgs(args)
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const artifactDirectory = path.join(repository, 'test-results', `ai-chat-oauth-${runId}`)
  const controller = new AbortController()
  const signal = controller.signal
  const childEnvironment = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' }
  const report = {
    status: 'RUNNING', runId, imageId: config.image, oauthVolume: config.oauthVolume,
    scope: 'Real pinned OAuth worker, real local Next production UI/API, migrated clean synthetic SQLite. No production changes.',
    limits: { plannedModelCalls: 3, maxObservedModelAttempts: MAX_MODEL_ATTEMPTS, runnerCallDeadlineMs: 120_000, jobDeadlineMs: JOB_DEADLINE_MS, providerRequestCount: 'Not observable: counts below are queue execution attempts, not internal provider HTTP requests.' },
    restartBoundary: 'The existing authenticated page remains open across clean Next and worker restart; its pending job is resumed by GET through the visible UI. No page reload/history restoration is claimed.',
    oauthRevocationTested: false, quotaSimulationUsed: false, passed: [], jobs: {}, workerEvents: [], screenshots: [], cleanup: {},
  }
  let directory, db, browser, server, workerAttach, workerName, probeName, serverReady = false
  let cleanupPromise, currentStep = 'PREFLIGHT', workerFailure, workerStarted = false
  const resources = new Set()
  const processAlive = (child) => child && child.exitCode === null && child.signalCode === null
  const assertNotAborted = () => check(!signal.aborted, 'INTERRUPTED')
  const step = (code) => { report.passed.push(code); process.stdout.write(`PASS ${code}\n`) }

  // Never print/store stderr, command arguments, credentials, environment, full
  // container inspection, auth contents, model prose, or unfiltered logs.
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
    try { await closed } finally { clearTimeout(timer) }
    serverReady = false
  }
  async function stopWorker({ final = false } = {}) {
    if (!workerName) return
    const stopped = await docker(['stop', '--time', '30', workerName], { timeoutMs: 40_000, cleanup: final })
    check(stopped.code === 0, 'WORKER_STOP_FAILED')
    const state = must(await docker(['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', workerName], { cleanup: final }), 'WORKER_STATE_FAILED')
    check(state === 'false 0', 'WORKER_DID_NOT_STOP_CLEANLY')
    if (processAlive(workerAttach)) {
      await Promise.race([new Promise((resolve) => workerAttach.once('close', resolve)), delay(2000)])
      check(!processAlive(workerAttach), 'WORKER_ATTACH_NOT_CLOSED')
    }
    workerStarted = false
  }
  async function cleanup() {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      // On any error or signal stop inference before the browser/server.
      if (workerName) {
        try { await stopWorker({ final: true }); report.cleanup.workerStopped = true }
        catch { report.cleanup.workerStopped = false }
      }
      for (const name of resources) {
        try { report.cleanup[name] = (await docker(['rm', '--force', name], { cleanup: true })).code === 0 }
        catch { report.cleanup[name] = false }
      }
      if (processAlive(workerAttach)) workerAttach.kill('SIGKILL')
      try { await browser?.close(); report.cleanup.browserClosed = true } catch { report.cleanup.browserClosed = false }
      try { await stopServer(); report.cleanup.serverStopped = true } catch { report.cleanup.serverStopped = false }
      try { await db?.$disconnect(); report.cleanup.databaseDisconnected = true } catch { report.cleanup.databaseDisconnected = false }
      report.cleanup.oauthVolumeRemoved = false // There is deliberately no volume-removal code.
      report.cleanup.syntheticDirectoryRetained = directory ?? null
    })()
    return cleanupPromise
  }
  const onSignal = () => {
    controller.abort()
    // Interrupt inference promptly, but do not memoize the final cleanup yet:
    // an interrupted Docker create may settle after this signal handler.
    if (workerName) void docker(['stop', '--time', '30', workerName], { timeoutMs: 40_000, cleanup: true }).catch(() => {})
    void browser?.close().catch(() => {})
  }
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
  try {
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
    const imageMetadata = must(await docker(['image', 'inspect', '--format', '{{.Id}}|{{.Os}}|{{.Config.User}}|{{json .Config.Entrypoint}}', config.image]), 'LOCAL_IMAGE_NOT_FOUND')
    check(imageMetadata === `${config.image}|linux|node|["/usr/bin/tini","--","/opt/ai/worker/ai/entrypoint.sh"]`, 'UNEXPECTED_IMAGE_BOUNDARY')
    const volumeMetadata = must(await docker(['volume', 'inspect', '--format', '{{.Name}}|{{.Driver}}|{{json .Options}}', config.oauthVolume]), 'EXISTING_OAUTH_VOLUME_REQUIRED')
    check([`${config.oauthVolume}|local|null`, `${config.oauthVolume}|local|{}`].includes(volumeMetadata), 'PLAIN_LOCAL_VOLUME_REQUIRED')
    // Inspect only metadata above. Never read, copy, repair or create auth files.
    const buildId = (await readFile(path.join(repository, '.next/BUILD_ID'), 'utf8')).trim()
    check(/^[a-zA-Z0-9_-]+$/.test(buildId), 'PRODUCTION_BUILD_REQUIRED')
    report.buildId = buildId
    directory = await mkdtemp(path.join(tmpdir(), 'wd-ai-oauth-chat-'))
    const databasePath = path.join(directory, 'synthetic.sqlite')
    const databaseUrl = `file:${databasePath}`
    const password = randomBytes(24).toString('base64url')
    const workerSecret = randomBytes(48).toString('base64url')
    const portProbe = createServer()
    await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve) })
    const port = portProbe.address().port
    await new Promise((resolve) => portProbe.close(resolve))
    const baseUrl = `http://127.0.0.1:${port}`
    const environment = { ...childEnvironment, NODE_ENV: 'production', DATABASE_URL: databaseUrl, NEXTAUTH_URL: baseUrl,
      NEXTAUTH_SECRET: randomBytes(48).toString('base64url'), AI_WORKER_SECRET: workerSecret, NEXT_TELEMETRY_DISABLED: '1' }
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
    must(await command(process.execPath, [path.join(repository, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(directory, 'prisma/schema.prisma')], { timeoutMs: 30_000, env: environment, cwd: directory }), 'SYNTHETIC_MIGRATION_FAILED')
    const [{ default: bcrypt }, { chromium, expect }, { PrismaClient }, aiChatResultSchema] = await Promise.all([
      import('bcryptjs'), import('@playwright/test'), import('../src/generated/prisma/index.js'), loadChatResultSchema(),
    ])
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    const hash = await bcrypt.hash(password, 10)
    const users = chatOAuthFixtureUsernames(runId)
    for (const [role, username] of Object.entries(users)) await db.user.create({ data: {
      id: username, username, email: `${username}@example.test`, name: `SYNTHETIC ${role}`, passwordHash: hash,
      role: role.includes('admin') ? 'ADMIN' : role.toUpperCase(),
    } })
    for (const [id, name] of [['PUL', 'Fikcyjny Salon B'], ['JAG', 'Fikcyjny Salon A'], ['GLOBAL', 'Fikcyjne wspólne']]) await db.costCenter.create({ data: { id, name } })
    await db.revenue.create({ data: { year: 2026, month: 8, amount: 12345, costCenterId: 'PUL', channel: 'SALON', asOfDate: '2026-08-31' } })
    const articleSlug = `synthetic-oauth-${runId}`
    await db.article.create({ data: { id: articleSlug, slug: articleSlug, title: 'Fikcyjna procedura TEST-ALFA', category: 'processes', visibility: 'public', type: 'procedure',
      content: 'WYŁĄCZNIE FIKCYJNY TEST procedury TEST-ALFA. Odczekaj dokładnie 7 minut. Nie podano koloru opakowania. To nie jest instrukcja operacyjna firmy.' } })

    async function startServer() {
      assertNotAborted()
      serverReady = false
      let addressConflict = false
      server = spawn(process.execPath, [path.join(repository, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
        cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      })
      const consume = (chunk) => { const text = chunk.toString(); if (text.includes('Ready in')) serverReady = true; if (text.includes('EADDRINUSE')) addressConflict = true }
      server.stdout.on('data', consume); server.stderr.on('data', consume)
      server.once('error', () => { addressConflict = true })
      for (let i = 0; i < 200; i++) {
        assertNotAborted()
        check(processAlive(server) && !addressConflict, 'LOOPBACK_NEXT_START_FAILED')
        if (serverReady && await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000), redirect: 'error' }).then((res) => res.ok).catch(() => false)) return
        await delay(100, undefined, { signal })
      }
      throw new GateError('LOOPBACK_NEXT_START_TIMEOUT')
    }
    async function startWorker() {
      assertNotAborted()
      workerFailure = undefined; workerStarted = false
      workerAttach = spawn(DOCKER, ['--host', LOCAL_DOCKER, 'start', '--attach', workerName], { env: childEnvironment, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      let pending = ''
      const consume = (chunk) => {
        pending += chunk.toString()
        if (pending.length > 64_000) { workerFailure = 'WORKER_OUTPUT_LIMIT'; return }
        const lines = pending.split('\n'); pending = lines.pop()
        for (const line of lines) {
          if (line === 'AI_SESSION_IN_USE') workerFailure = 'AI_SESSION_IN_USE'
          if (line === 'AI_WORKER_START_FAILED') workerFailure = 'AI_WORKER_START_FAILED'
          try {
            const event = JSON.parse(line)
            if (event.event === 'AI_WORKER_STARTED') { workerStarted = true; report.workerEvents.push({ event: 'AI_WORKER_STARTED' }) }
            if (event.event === 'AI_JOB_FINISHED' && ['succeeded', 'failed', 'lease_lost'].includes(event.status)) {
              report.workerEvents.push({ event: 'AI_JOB_FINISHED', status: event.status })
              if (event.status !== 'succeeded') workerFailure = `WORKER_${event.status.toUpperCase()}`
            }
          } catch { /* Unknown lines are discarded, never reported. */ }
        }
      }
      workerAttach.stdout.on('data', consume); workerAttach.stderr.on('data', consume)
      workerAttach.once('error', () => { workerFailure = 'WORKER_ATTACH_FAILED' })
      for (let i = 0; i < 150; i++) {
        assertNotAborted()
        check(!workerFailure && processAlive(workerAttach), workerFailure ?? 'WORKER_EXITED')
        if (workerStarted) return
        await delay(100, undefined, { signal })
      }
      throw new GateError('WORKER_START_TIMEOUT')
    }
    async function readJob(page, id) {
      const response = await page.request.get(`${baseUrl}/api/ai/jobs/${id}`, { timeout: 10_000 })
      check(response.status() === 200, 'OWNER_JOB_READ_FAILED')
      check(response.headers()['cache-control'] === 'private, no-store', 'JOB_CACHE_BOUNDARY_FAILED')
      const { job } = await response.json()
      check(job && !Object.hasOwn(job, 'payloadJson') && !Object.hasOwn(job, 'leaseToken'), 'PUBLIC_JOB_SECRET_BOUNDARY_FAILED')
      return job
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
    async function submit(page, kind, question, label) {
      check(!workerStarted, 'SUBMIT_REQUIRES_STOPPED_WORKER')
      check(await db.aiJob.count() < 4, 'QUEUE_JOB_LIMIT')
      const input = page.getByPlaceholder(kind === 'FINANCE_CHAT' ? 'Zadaj pytanie o finanse...' : 'Zadaj pytanie o ten artykuł...')
      const endpoint = kind === 'FINANCE_CHAT' ? '/api/ai/chat' : '/api/knowledge/ai'
      await input.fill(question)
      const posted = page.waitForResponse((res) => new URL(res.url()).pathname === endpoint && res.request().method() === 'POST')
      await input.press('Enter')
      const response = await posted
      check(response.status() === 202, 'UI_SUBMIT_FAILED')
      const { job } = await response.json()
      check(job?.kind === kind && job.status === 'QUEUED' && job.attempts === 0 && job.result === null, 'INITIAL_QUEUED_STATE_INVALID')
      await expect(page.getByRole('status').filter({ hasText: 'W kolejce' })).toBeVisible()
      report.jobs[label] = { id: job.id, kind, initialStatus: job.status, attempts: 0 }
      return job
    }
    async function screenshot(page, label) {
      const target = path.join(artifactDirectory, `${label}.png`)
      await page.screenshot({ path: target, fullPage: true })
      report.screenshots.push(target)
    }
    const displayedAnswers = new Map()
    async function awaitAnswer(page, initial, label) {
      const deadline = Date.now() + JOB_DEADLINE_MS
      let sawRunning = false
      while (Date.now() < deadline) {
        assertNotAborted()
        check(!workerFailure && processAlive(workerAttach), workerFailure ?? 'WORKER_EXITED')
        const rows = await db.aiJob.findMany({ select: { id: true, attempts: true, status: true } })
        const totalAttempts = rows.reduce((sum, row) => sum + row.attempts, 0)
        report.observedModelAttempts = totalAttempts
        // One expected run per real job. Abort on the first unexpected retry,
        // rather than letting the queue consume the full per-job retry budget.
        check(totalAttempts <= MAX_MODEL_ATTEMPTS && rows.every((row) => row.attempts <= 1), 'UNEXPECTED_RETRY_OR_CALL_LIMIT')
        const job = await readJob(page, initial.id)
        report.jobs[label].status = job.status
        report.jobs[label].attempts = job.attempts
        check(!['FAILED', 'BLOCKED', 'CANCELLED'].includes(job.status), `JOB_${job.status}_${/^[A-Z_]{1,40}$/.test(job.errorCode ?? '') ? job.errorCode : 'STOP'}`)
        check(!(sawRunning && job.status === 'QUEUED'), 'UNEXPECTED_REQUEUE')
        if (job.status === 'RUNNING') sawRunning = true
        if (job.status === 'SUCCEEDED') {
          check(job.attempts === 1 && aiChatResultSchema.safeParse(job.result).success, 'PRODUCTION_RESULT_SCHEMA_FAILED')
          const evidence = assessChatEvidence(initial.kind, job.result)
          check(evidence.passed, evidence.code)
          // The UI may stop polling after an actual outage or its own bounded
          // polling deadline. This is an explicit GET resume, never a retry POST.
          const resume = page.getByRole('button', { name: 'Sprawdź ponownie', exact: true })
          if (await resume.isVisible()) { await resume.click(); report.jobs[label].uiGetResumed = true }
          const visibleText = visibleChatAnswer(initial.kind, job.result.answer)
          const matchKey = chatAnswerMatchKey(initial.kind, job.result.answer)
          const priorAnswers = displayedAnswers.get(page) ?? []
          const rendered = page.getByText(visibleText, { exact: true })
          // A repeated wiki answer is not evidence of the new job finishing in
          // the UI. Require one more instance than this page showed before.
          await expect(rendered).toHaveCount(priorAnswers.filter((text) => text === matchKey).length + 1, { timeout: 15_000 })
          await expect(rendered.last()).toBeVisible()
          displayedAnswers.set(page, [...priorAnswers, matchKey])
          report.jobs[label].checked = evidence.checked
          report.jobs[label].answerSha256 = createHash('sha256').update(job.result.answer).digest('hex')
          report.jobs[label].visibleAnswer = true
          report.jobs[label].observedRunning = sawRunning
          await screenshot(page, `${label}-answer`)
          return job
        }
        await delay(500, undefined, { signal })
      }
      throw new GateError('JOB_DEADLINE_REACHED')
    }

    currentStep = 'LOOPBACK_CONTAINER_HEALTH'
    await startServer()
    probeName = `wd-ai-oauth-chat-probe-${runId}`
    resources.add(probeName)
    // No OAuth mount and no worker entrypoint in this connectivity-only probe.
    // Success requires Docker Desktop's host gateway to reach a loopback-only
    // server. On failure we NEVER widen the bind or publish a host port.
    const healthCode = `fetch(${JSON.stringify(`http://host.docker.internal:${port}/api/health`)},{signal:AbortSignal.timeout(5000),redirect:'error'}).then(async r=>{if(!r.ok)process.exit(1);else process.stdout.write('LOOPBACK_HEALTH_OK')}).catch(()=>process.exit(1))`
    const health = await docker(['run', '--pull', 'never', '--name', probeName, ...HARDENING, '--entrypoint', '/usr/local/bin/node', config.image, '-e', healthCode], { timeoutMs: 10_000 })
    check(health.code === 0 && health.stdout === 'LOOPBACK_HEALTH_OK', 'HOST_GATEWAY_CANNOT_REACH_LOOPBACK_NO_WIDER_BIND_ALLOWED')
    must(await docker(['rm', probeName]), 'PROBE_CLEANUP_FAILED'); resources.delete(probeName)
    workerName = `wd-ai-oauth-chat-worker-${runId}`
    resources.add(workerName)
    must(await docker(chatOAuthWorkerArgs(config, workerName), { env: { ...childEnvironment, AI_WORKER_ENABLED: 'true', AI_WORKER_URL: `http://host.docker.internal:${port}/api/internal/ai-worker`, AI_WORKER_SECRET: workerSecret } }), 'WORKER_CREATE_FAILED')
    step('SYNTHETIC_DB_MIGRATED_AND_LOOPBACK_REACHABLE')

    currentStep = 'AUTHORIZATION_UI'
    browser = await chromium.launch(chatOAuthBrowserLaunchOptions(directory))
    const admin = await login(users.admin), otherAdmin = await login(users.otheradmin), manager = await login(users.manager), employee = await login(users.employee)
    for (const endpoint of ['/api/ai/chat', '/api/knowledge/ai']) check((await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) })).status === 401, 'ANONYMOUS_ACCESS_ALLOWED')
    for (const page of [manager, employee]) {
      check((await page.request.post(`${baseUrl}/api/ai/chat`, { data: { question: 'Fikcyjna kontrola roli', year: 2026, month: 8 } })).status() === 403, 'FINANCE_ROLE_BOUNDARY_FAILED')
      await expect(page.getByTitle('AI Analyst', { exact: true })).toHaveCount(0)
    }
    check((await employee.request.post(`${baseUrl}/api/knowledge/ai`, { data: { question: 'Fikcyjna kontrola roli' } })).status() === 403, 'WIKI_ROLE_BOUNDARY_FAILED')
    check(await db.aiJob.count() === 0, 'DENIED_REQUEST_CREATED_JOB')
    step('ANONYMOUS_AND_ROLE_BOUNDARIES')

    currentStep = 'REAL_FINANCE_UI'
    await admin.goto(`${baseUrl}/dashboard?year=2026&month=8`); await admin.waitForLoadState('networkidle')
    await admin.getByTitle('AI Analyst', { exact: true }).click()
    await admin.getByLabel('Rok danych', { exact: true }).selectOption('2026')
    await admin.getByLabel('Miesiąc danych', { exact: true }).selectOption('8')
    const finance = await submit(admin, 'FINANCE_CHAT', FINANCE_QUESTION, 'finance')
    for (const page of [otherAdmin, manager]) check((await page.request.get(`${baseUrl}/api/ai/jobs/${finance.id}`)).status() === 404, 'JOB_OWNER_BOUNDARY_FAILED')
    await startWorker()
    const financeDone = await awaitAnswer(admin, finance, 'finance')
    await stopWorker()
    step('REAL_FINANCE_SCHEMA_FACTS_AND_VISIBLE_ANSWER')

    currentStep = 'REAL_WIKI_UI'
    const articleUrl = `${baseUrl}/knowledge/${articleSlug}`
    await manager.goto(articleUrl); await manager.waitForLoadState('networkidle')
    await expect(manager.getByRole('heading', { name: 'Fikcyjna procedura TEST-ALFA', exact: true })).toBeVisible()
    await manager.getByTitle('AI Asystent wiedzy', { exact: true }).click()
    await employee.goto(articleUrl); await employee.waitForLoadState('networkidle')
    await expect(employee.getByTitle('AI Asystent wiedzy', { exact: true })).toHaveCount(0)
    const wiki = await submit(manager, 'WIKI_CHAT', WIKI_QUESTION, 'wiki')
    check((await admin.request.get(`${baseUrl}/api/ai/jobs/${wiki.id}`)).status() === 404, 'WIKI_OWNER_BOUNDARY_FAILED')
    await startWorker(); await awaitAnswer(manager, wiki, 'wiki'); await stopWorker()
    step('REAL_WIKI_SCHEMA_FACTS_AND_VISIBLE_ANSWER')

    currentStep = 'NEXT_AND_WORKER_RESTART'
    const pending = await submit(manager, 'WIKI_CHAT', `Po restarcie odpowiedz jeszcze raz. ${WIKI_QUESTION}`, 'restart')
    const before = await readJob(manager, pending.id)
    await stopServer()
    // Deliberate real outage: wait for this exact open panel to notice its GET
    // failed; no routing stubs, fake responses or page reloads are used.
    await expect(manager.getByRole('button', { name: 'Sprawdź ponownie', exact: true })).toBeVisible({ timeout: 25_000 })
    await startServer()
    check(isDeepStrictEqual(await readJob(manager, pending.id), before), 'QUEUED_JOB_NOT_DURABLE')
    check(isDeepStrictEqual(await readJob(admin, finance.id), financeDone), 'PRIOR_RESULT_NOT_DURABLE')
    await manager.getByRole('button', { name: 'Sprawdź ponownie', exact: true }).click()
    await expect(manager.getByRole('status').filter({ hasText: 'W kolejce' })).toBeVisible()
    report.jobs.restart.uiGetResumed = true
    await startWorker(); const restartDone = await awaitAnswer(manager, pending, 'restart'); await stopWorker()
    await stopServer(); await startServer()
    check(isDeepStrictEqual(await readJob(manager, pending.id), restartDone), 'COMPLETED_RESULT_NOT_DURABLE')
    step('OPEN_PENDING_UI_RESUMED_THROUGH_REAL_SERVER_AND_WORKER_RESTART')

    currentStep = 'SYNTHETIC_APPLICATION_ACCESS_REVOCATION'
    const revoked = await submit(manager, 'WIKI_CHAT', 'Fikcyjny test cofnięcia uprawnień aplikacji; nie wykonuj tego zadania po utracie roli.', 'revoked')
    // Only this disposable DB user is modified. No OAuth credential is touched.
    check((await db.aiJob.findUniqueOrThrow({ where: { id: revoked.id } })).status === 'QUEUED' && !workerStarted, 'REVOCATION_REQUIRES_STOPPED_QUEUED_JOB')
    await db.user.update({ where: { id: users.manager }, data: { role: 'EMPLOYEE' } })
    check((await manager.request.get(`${baseUrl}/api/ai/jobs/${revoked.id}`)).status() === 403, 'REVOKED_OWNER_NOT_DENIED')
    await expect(manager.getByRole('alert').filter({ hasText: 'Nie masz dostępu do tego zadania lub jego danych.' })).toBeVisible({ timeout: 12_000 })
    await startWorker()
    const revocationDeadline = Date.now() + 12_000
    let revokedRow
    while (Date.now() < revocationDeadline) {
      assertNotAborted(); check(!workerFailure && processAlive(workerAttach), workerFailure ?? 'WORKER_EXITED')
      revokedRow = await db.aiJob.findUniqueOrThrow({ where: { id: revoked.id }, select: { status: true, errorCode: true, attempts: true, resultJson: true } })
      check(revokedRow.attempts === 0, 'REVOKED_JOB_ENTERED_MODEL')
      if (revokedRow.status === 'FAILED') break
      await delay(250, undefined, { signal })
    }
    check(revokedRow?.status === 'FAILED' && revokedRow.errorCode === 'ACCESS_REVOKED' && revokedRow.attempts === 0 && revokedRow.resultJson === null, 'REAL_CLAIM_DID_NOT_REJECT_REVOKED_OWNER')
    Object.assign(report.jobs.revoked, revokedRow, { uiDenied: true })
    await stopWorker()
    check((await manager.request.post(`${baseUrl}/api/knowledge/ai`, { data: { question: 'Fikcyjna kontrola po cofnięciu roli' } })).status() === 403, 'REVOKED_USER_CAN_SUBMIT')
    step('ACTUAL_CLAIM_ACCESS_REVOKED_WITH_ZERO_MODEL_ATTEMPTS_AND_UI_DENIAL')

    currentStep = 'FINAL_READBACK'
    const finalJobs = await db.aiJob.findMany({ select: { id: true, status: true, attempts: true } })
    report.observedModelAttempts = finalJobs.reduce((sum, row) => sum + row.attempts, 0)
    check(finalJobs.length === 4 && report.observedModelAttempts === 3 && finalJobs.filter((row) => row.status === 'SUCCEEDED').length === 3, 'FINAL_JOB_COUNTS_INVALID')
    check(await db.revenue.count() === 1 && (await db.revenue.findFirstOrThrow()).amount === 12345, 'FINANCE_FIXTURE_CHANGED')
    check(await db.ksefInvoice.count() === 0 && await db.costEvent.count() === 0, 'CHAT_CREATED_FINANCE_DOCUMENTS')
    const integrity = must(await command('/usr/bin/sqlite3', [databasePath, 'PRAGMA integrity_check; PRAGMA foreign_key_check;']), 'SQLITE_INTEGRITY_COMMAND_FAILED')
    check(integrity === 'ok', 'SQLITE_INTEGRITY_OR_FOREIGN_KEYS_FAILED')
    report.financeReadback = { revenues: 1, revenueAmount: 12345, ksefInvoices: 0, costEvents: 0, integrity: 'ok', foreignKeyViolations: 0 }
    check(!report.uncaughtPageErrors, 'UNCAUGHT_PAGE_ERRORS')
    check((await stat(databasePath)).isFile(), 'SYNTHETIC_DB_MISSING')
    report.status = 'PASS'
  } catch (error) {
    report.status = 'FAIL'
    report.failedStep = currentStep
    report.code = signal.aborted ? 'INTERRUPTED' : error instanceof GateError ? error.code : 'GATE_CHECK_FAILED'
    if (report.code === 'HOST_GATEWAY_CANNOT_REACH_LOOPBACK_NO_WIDER_BIND_ALLOWED') report.actionRequired = 'Docker host.docker.internal cannot reach 127.0.0.1. Gate stopped; widening the bind requires separate explicit operator approval.'
  } finally {
    await cleanup()
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal)
    const cleanupFailed = Object.entries(report.cleanup).some(([key, value]) => value === false && key !== 'oauthVolumeRemoved')
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
