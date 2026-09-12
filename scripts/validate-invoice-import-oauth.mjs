#!/usr/bin/env node
/**
 * MANUAL REAL-OAUTH INVOICE GATE. Prepare/review before running; never runs on import.
 *
 * node scripts/validate-invoice-import-oauth.mjs --confirm-synthetic-oauth \
 *   --image sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab \
 *   --oauth-volume wd-ai-oauth-piotr-local-20260911
 *
 * Exactly one synthetic invoice model attempt is allowed. There is no provider
 * fallback and no automatic harness retry. The named OAuth volume is mounted but
 * never inspected, copied, repaired, created, or removed by this script.
 */
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import {
  chatOAuthBrowserLaunchOptions,
  chatOAuthFixtureUsernames,
  chatOAuthWorkerArgs,
  parseChatOAuthArgs,
} from './validate-ai-chat-oauth.mjs'

const DOCKER = '/usr/local/bin/docker'
const LOCAL_DOCKER = 'unix:///Users/piotr/.docker/run/docker.sock'
const REVIEWED_IMAGE = 'sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab'
const REVIEWED_OAUTH_VOLUME = 'wd-ai-oauth-piotr-local-20260911'
const JOB_DEADLINE_MS = 150_000
const MAX_MODEL_ATTEMPTS = 1
const FIXTURE_NAME = 'synthetic-invoice-oauth.png'

export const INVOICE_OAUTH_EXPECTED = Object.freeze({
  documentType: 'INVOICE',
  supplierName: 'SYNTHETIC SUPPLIER',
  taxId: 'PL1234567890',
  invoiceNumber: 'FV/TEST/2026/09/01',
  issueDate: '2026-09-10',
  dueDate: '2026-09-24',
  currency: 'PLN',
  gross: 123,
  net: 100,
  vat: 23,
  bankAccount: null,
  paymentStatus: 'UNPAID',
})

class GateError extends Error {
  constructor(code) { super(code); this.code = code }
}
const check = (condition, code) => { if (!condition) throw new GateError(code) }

export function parseInvoiceOAuthArgs(args) {
  const parsed = parseChatOAuthArgs(args)
  check(parsed.image === REVIEWED_IMAGE, 'REVIEWED_IMAGE_REQUIRED')
  check(parsed.oauthVolume === REVIEWED_OAUTH_VOLUME, 'REVIEWED_OAUTH_VOLUME_REQUIRED')
  return parsed
}

export function invoiceOAuthWorkerArgs(config, runId) {
  check(typeof runId === 'string' && /^[0-9]{13}-[a-f0-9]{8}$/.test(runId), 'INVALID_FIXTURE_RUN_ID')
  const name = `wd-ai-oauth-chat-invoice-${runId}`
  return { name, args: chatOAuthWorkerArgs(parseInvoiceOAuthArgs([
    '--confirm-synthetic-oauth', '--image', config.image, '--oauth-volume', config.oauthVolume,
  ]), name) }
}

/**
 * Stops one exact harness-owned worker and returns only after Docker positively
 * reports Running=false. Failed, timed-out, nonzero, or malformed inspections
 * are unknown states, never evidence that inference stopped.
 */
export async function ensureOwnedWorkerStopped(docker, name) {
  check(typeof docker === 'function'
    && /^wd-ai-oauth-chat-invoice-[0-9]{13}-[a-f0-9]{8}$/.test(name), 'INVALID_OWNED_WORKER')
  const inspect = async () => {
    try {
      const result = await docker(['inspect', '--format', '{{.State.Running}} {{.State.ExitCode}}', name], {
        timeoutMs: 10_000, cleanup: true,
      })
      if (!result || result.code !== 0 || typeof result.stdout !== 'string') return null
      const match = /^(true|false) (-?\d+)$/.exec(result.stdout.trim())
      return match ? { running: match[1] === 'true', exitCode: Number(match[2]) } : null
    } catch { return null }
  }
  const initial = await inspect()
  if (initial && !initial.running) {
    return { stopped: true, clean: initial.exitCode === 0, forced: false }
  }
  try {
    await docker(['stop', '--time', '30', name], { timeoutMs: 40_000, cleanup: true })
  } catch { /* Inspection below decides; command failure is not stopped evidence. */ }
  const afterGraceful = await inspect()
  if (afterGraceful && !afterGraceful.running) {
    return { stopped: true, clean: afterGraceful.exitCode === 0, forced: false }
  }
  try {
    await docker(['kill', name], { timeoutMs: 10_000, cleanup: true })
  } catch { /* Final inspection remains mandatory. */ }
  const afterForced = await inspect()
  if (afterForced && !afterForced.running) {
    return { stopped: true, clean: false, forced: true }
  }
  throw new GateError('WORKER_STOP_UNVERIFIED')
}

export function invoiceOAuthServerEnvironment(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_SERVER_ENVIRONMENT')
  const required = ['databaseUrl', 'baseUrl', 'nextAuthSecret', 'workerSecret', 'originalsDirectory', 'processingDirectory']
  check(Object.keys(input).length === required.length && required.every((key) => typeof input[key] === 'string'), 'INVALID_SERVER_ENVIRONMENT')
  check(/^file:\/.+/.test(input.databaseUrl), 'INVALID_SERVER_ENVIRONMENT')
  check(/^http:\/\/127\.0\.0\.1:\d+$/.test(input.baseUrl), 'INVALID_SERVER_ENVIRONMENT')
  check(input.nextAuthSecret.length >= 32 && input.workerSecret.length >= 32, 'INVALID_SERVER_ENVIRONMENT')
  check(path.isAbsolute(input.originalsDirectory) && path.isAbsolute(input.processingDirectory)
    && input.originalsDirectory !== input.processingDirectory, 'INVALID_SERVER_ENVIRONMENT')
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    NODE_ENV: 'production',
    DATABASE_URL: input.databaseUrl,
    NEXTAUTH_URL: input.baseUrl,
    NEXTAUTH_SECRET: input.nextAuthSecret,
    AI_WORKER_SECRET: input.workerSecret,
    NEXT_TELEMETRY_DISABLED: '1',
    INVOICE_ORIGINALS_DIR: input.originalsDirectory,
    INVOICE_PROCESSING_DIR: input.processingDirectory,
  }
}

export async function loadInvoiceResultSchema() {
  const { tsImport } = await import('tsx/esm/api')
  const contracts = await tsImport('../src/lib/ai/contracts.ts', import.meta.url)
  const schema = contracts.aiInvoiceResultSchema ?? contracts.default?.aiInvoiceResultSchema
  check(schema && typeof schema.safeParse === 'function', 'PRODUCTION_RESULT_SCHEMA_UNAVAILABLE')
  return schema
}

/** Validates the production schema first, then every fact printed on the fixture. */
export function assessInvoiceOAuthEvidence(result, schema) {
  if (!schema || typeof schema.safeParse !== 'function' || !schema.safeParse(result).success) {
    return { passed: false, code: 'INVALID_RESULT_SCHEMA' }
  }
  const facts = Object.fromEntries(Object.keys(INVOICE_OAUTH_EXPECTED).map((key) => [key, result[key]]))
  if (!isDeepStrictEqual(facts, INVOICE_OAUTH_EXPECTED)) return { passed: false, code: 'VALUE_MISMATCH' }
  return { passed: true, checked: INVOICE_OAUTH_EXPECTED }
}

export async function createSyntheticInvoicePng(target) {
  check(typeof target === 'string' && path.isAbsolute(target), 'PRIVATE_FIXTURE_PATH_REQUIRED')
  const svg = `
  <svg width="1600" height="2000" viewBox="0 0 1600 2000" xmlns="http://www.w3.org/2000/svg">
    <rect width="1600" height="2000" fill="#ffffff"/>
    <rect x="70" y="70" width="1460" height="1860" rx="8" fill="none" stroke="#111111" stroke-width="5"/>
    <g font-family="DejaVu Sans" fill="#111111">
      <text x="120" y="160" font-size="42" font-weight="700">TEST FIKCYJNY — DOKUMENT WYŁĄCZNIE DO WALIDACJI</text>
      <text x="120" y="290" font-size="74" font-weight="700">FAKTURA VAT</text>
      <text x="120" y="390" font-size="44">Numer: FV/TEST/2026/09/01</text>
      <text x="120" y="470" font-size="44">Data wystawienia: 2026-09-10</text>
      <text x="120" y="550" font-size="44">Termin płatności: 2026-09-24</text>
      <line x1="120" y1="620" x2="1480" y2="620" stroke="#111111" stroke-width="3"/>
      <text x="120" y="720" font-size="34" font-weight="700">SPRZEDAWCA / SUPPLIER</text>
      <text x="120" y="800" font-size="52" font-weight="700">SYNTHETIC SUPPLIER</text>
      <text x="120" y="880" font-size="46">NIP: PL1234567890</text>
      <line x1="120" y1="950" x2="1480" y2="950" stroke="#111111" stroke-width="3"/>
      <text x="120" y="1060" font-size="38" font-weight="700">Pozycja testowa</text>
      <text x="120" y="1160" font-size="44">Netto</text><text x="1170" y="1160" font-size="52" font-weight="700">100,00 PLN</text>
      <text x="120" y="1260" font-size="44">VAT 23%</text><text x="1170" y="1260" font-size="52" font-weight="700">23,00 PLN</text>
      <text x="120" y="1380" font-size="52" font-weight="700">BRUTTO</text><text x="1120" y="1380" font-size="64" font-weight="700">123,00 PLN</text>
      <line x1="120" y1="1460" x2="1480" y2="1460" stroke="#111111" stroke-width="3"/>
      <text x="120" y="1570" font-size="46" font-weight="700">STATUS PŁATNOŚCI: NIEZAPŁACONA / UNPAID</text>
      <text x="120" y="1710" font-size="34">To nie jest prawdziwa faktura ani dokument księgowy.</text>
      <text x="120" y="1780" font-size="34">Wszystkie dane są syntetyczne i nie dotyczą żadnej osoby ani firmy.</text>
    </g>
  </svg>`
  const sharpModule = await import('sharp')
  const sharp = sharpModule.default ?? sharpModule
  const bytes = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
  await chmod(target, 0o600)
  return {
    path: target,
    mimeType: 'image/png',
    byteSize: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export function invoiceOAuthMultipartPayload(batchId, bytes) {
  check(typeof batchId === 'string' && batchId.trim().length > 0 && batchId.length <= 191,
    'INVALID_MULTIPART_FIXTURE')
  check(Buffer.isBuffer(bytes) && bytes.byteLength >= 8 && bytes.byteLength <= 10 * 1024 * 1024
    && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'INVALID_MULTIPART_FIXTURE')
  return {
    batchId,
    file: { name: 'denied-synthetic-invoice.png', mimeType: 'image/png', buffer: Buffer.from(bytes) },
  }
}

/** Marks a shutdown rejection as handled immediately without replacing it. */
export function retainHandledRejection(promise) {
  check(promise && typeof promise.then === 'function' && typeof promise.catch === 'function',
    'INVALID_INTERRUPT_PROMISE')
  void promise.catch(() => {})
  return promise
}

/** Captures one synthetic UI artifact with private permissions. */
export async function captureSyntheticScreenshot(page, artifactDirectory, label, screenshots) {
  check(page && typeof page.screenshot === 'function'
    && typeof artifactDirectory === 'string' && path.isAbsolute(artifactDirectory)
    && typeof label === 'string' && /^[a-z0-9][a-z0-9-]{0,120}$/.test(label)
    && Array.isArray(screenshots), 'INVALID_SCREENSHOT_CAPTURE')
  const target = path.join(artifactDirectory, `${label}.png`)
  await page.screenshot({ path: target, fullPage: true })
  await chmod(target, 0o600)
  screenshots.push(target)
  return target
}

async function main(args) {
  // Validate explicit consent and fixed external targets before any I/O.
  const config = parseInvoiceOAuthArgs(args)
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const artifactDirectory = path.join(repository, 'test-results', `invoice-import-oauth-${runId}`)
  const controller = new AbortController()
  const signal = controller.signal
  const childEnvironment = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' }
  const report = {
    status: 'RUNNING', runId, imageId: config.image, oauthVolume: config.oauthVolume,
    scope: 'One real pinned OAuth invoice extraction against a clean synthetic SQLite and private synthetic PNG through the production UI/API.',
    limits: { plannedModelAttempts: 1, maximumModelAttempts: 1, providerFallback: false,
      automaticHarnessRetry: false, runnerDeadlineMs: 120_000, jobDeadlineMs: JOB_DEADLINE_MS,
      providerRequestCount: 'Not observable; observed attempts are durable queue claims.' },
    workerBoundary: { oauthContentsRead: false, oauthVolumeRemoved: false, dockerSocketMounted: false,
      repositoryMounted: false, hostHomeMounted: false },
    passed: [], screenshots: [], downloads: [], workerEvents: [], cleanup: {},
  }
  let directory, databasePath, db, browser, server, workerAttach, workerName, probeName
  let serverReady = false, workerStarted = false, workerFailure, cleanupPromise, interruptStopPromise
  let currentStep = 'PREFLIGHT', syntheticUiSafe = false, activePage
  const resources = new Set()
  const processAlive = (child) => child && child.exitCode === null && child.signalCode === null
  const assertNotAborted = () => check(!signal.aborted, 'INTERRUPTED')
  const step = (code) => { report.passed.push(code); process.stdout.write(`PASS ${code}\n`) }
  const screenshot = (page, label) => captureSyntheticScreenshot(
    page, artifactDirectory, label, report.screenshots,
  )

  // Never print/store stderr, arguments, environment, credentials, raw Docker
  // inspection, auth contents, provider prose, or unfiltered worker logs.
  async function command(binary, commandArgs, { timeoutMs = 20_000, env = childEnvironment, cleanup = false, cwd } = {}) {
    if (!cleanup) assertNotAborted()
    return new Promise((resolve, reject) => {
      const child = spawn(binary, commandArgs, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = '', outputBytes = 0, timedOut = false
      const stop = () => child.kill('SIGKILL')
      const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
      if (!cleanup) signal.addEventListener('abort', stop, { once: true })
      child.stdout.on('data', (chunk) => {
        outputBytes += chunk.length
        if (outputBytes > 1024 * 1024) stop()
        else stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => { outputBytes += chunk.length; if (outputBytes > 1024 * 1024) stop() })
      child.once('error', () => {
        clearTimeout(timer); signal.removeEventListener('abort', stop)
        reject(new GateError('COMMAND_START_FAILED'))
      })
      child.once('close', (code) => {
        clearTimeout(timer); signal.removeEventListener('abort', stop)
        if (timedOut || outputBytes > 1024 * 1024) reject(new GateError(timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_OUTPUT_LIMIT'))
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

  async function stopWorker({ cleanup = false, requireClean = !cleanup } = {}) {
    if (!workerName) return { stopped: true, clean: true, forced: false }
    const outcome = await ensureOwnedWorkerStopped((commandArgs, options) => docker(commandArgs, {
      ...options, cleanup,
    }), workerName)
    if (processAlive(workerAttach)) {
      await Promise.race([new Promise((resolve) => workerAttach.once('close', resolve)), delay(2_000)])
      check(!processAlive(workerAttach), 'WORKER_ATTACH_NOT_CLOSED')
    }
    workerStarted = false
    check(!requireClean || outcome.clean, 'WORKER_DID_NOT_STOP_CLEANLY')
    return outcome
  }

  async function cleanup() {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      // Inference is stopped before every browser/server/database cleanup.
      try { await stopWorker({ cleanup: true }); report.cleanup.workerStopped = true }
      catch { report.cleanup.workerStopped = false }
      for (const name of resources) {
        try { report.cleanup[name] = (await docker(['rm', '--force', name], { cleanup: true })).code === 0 }
        catch { report.cleanup[name] = false }
      }
      if (processAlive(workerAttach)) workerAttach.kill('SIGKILL')
      try { await browser?.close(); report.cleanup.browserClosed = true } catch { report.cleanup.browserClosed = false }
      try { await stopServer(); report.cleanup.serverStopped = true } catch { report.cleanup.serverStopped = false }
      try { await db?.$disconnect(); report.cleanup.databaseDisconnected = true } catch { report.cleanup.databaseDisconnected = false }
      report.cleanup.oauthVolumeRemoved = false
      report.cleanup.syntheticDirectoryRetained = directory ?? null
    })()
    return cleanupPromise
  }

  const onSignal = () => {
    controller.abort()
    // Preserve the same shutdown order on interruption: inference first, then UI.
    if (!interruptStopPromise) {
      const originalStopPromise = (async () => {
        await stopWorker({ cleanup: true })
        try { await browser?.close() } catch { /* Final cleanup records the failure. */ }
      })()
      interruptStopPromise = retainHandledRejection(originalStopPromise)
    }
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
    await chmod(artifactDirectory, 0o700)
    const imageMetadata = must(await docker(['image', 'inspect', '--format', '{{.Id}}|{{.Os}}|{{.Architecture}}|{{.Config.User}}|{{json .Config.Entrypoint}}', config.image]), 'LOCAL_IMAGE_NOT_FOUND')
    check(imageMetadata === `${config.image}|linux|arm64|node|["/usr/bin/tini","--","/opt/ai/worker/ai/entrypoint.sh"]`, 'UNEXPECTED_IMAGE_BOUNDARY')
    const volumeMetadata = must(await docker(['volume', 'inspect', '--format', '{{.Name}}|{{.Driver}}|{{json .Options}}', config.oauthVolume]), 'EXISTING_OAUTH_VOLUME_REQUIRED')
    check([`${config.oauthVolume}|local|null`, `${config.oauthVolume}|local|{}`].includes(volumeMetadata), 'PLAIN_LOCAL_VOLUME_REQUIRED')
    // Only metadata is inspected above. Volume contents are never read.
    const buildId = (await readFile(path.join(repository, '.next/BUILD_ID'), 'utf8')).trim()
    check(/^[a-zA-Z0-9_-]+$/.test(buildId), 'PRODUCTION_BUILD_REQUIRED')
    report.buildId = buildId

    directory = await realpath(await mkdtemp(path.join(tmpdir(), 'wd-invoice-oauth-')))
    databasePath = path.join(directory, 'synthetic.sqlite')
    const originalsDirectory = path.join(directory, 'originals')
    const processingDirectory = path.join(directory, 'processing')
    await Promise.all([
      mkdir(originalsDirectory, { mode: 0o700 }),
      mkdir(processingDirectory, { mode: 0o700 }),
    ])
    await Promise.all([chmod(originalsDirectory, 0o700), chmod(processingDirectory, 0o700)])
    check(path.dirname(originalsDirectory) === directory && path.dirname(processingDirectory) === directory
      && ![originalsDirectory, processingDirectory].some((entry) => entry.startsWith(`${path.join(repository, 'public')}${path.sep}`)), 'PRIVATE_DIRECTORY_BOUNDARY_FAILED')
    const fixture = await createSyntheticInvoicePng(path.join(directory, FIXTURE_NAME))

    const portProbe = createServer()
    await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve) })
    const port = portProbe.address().port
    await new Promise((resolve) => portProbe.close(resolve))
    const baseUrl = `http://127.0.0.1:${port}`
    const databaseUrl = `file:${databasePath}`
    const password = randomBytes(24).toString('base64url')
    const workerSecret = randomBytes(48).toString('base64url')
    const environment = invoiceOAuthServerEnvironment({
      databaseUrl, baseUrl, nextAuthSecret: randomBytes(48).toString('base64url'), workerSecret,
      originalsDirectory, processingDirectory,
    })
    report.baseUrl = baseUrl
    report.syntheticDatabase = databasePath
    report.syntheticFixture = { sha256: fixture.sha256, byteSize: fixture.byteSize, mimeType: fixture.mimeType }

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
    must(await command(process.execPath, [path.join(repository, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(directory, 'prisma/schema.prisma')], {
      timeoutMs: 30_000, env: environment, cwd: directory,
    }), 'SYNTHETIC_MIGRATION_FAILED')

    const [{ default: bcrypt }, { chromium, expect, request }, { PrismaClient }, invoiceResultSchema] = await Promise.all([
      import('bcryptjs'), import('@playwright/test'), import('../src/generated/prisma/index.js'), loadInvoiceResultSchema(),
    ])
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    const passwordHash = await bcrypt.hash(password, 10)
    const users = chatOAuthFixtureUsernames(runId)
    for (const [role, username] of Object.entries(users)) await db.user.create({ data: {
      id: username, username, email: `${username}@example.test`, name: `SYNTHETIC ${role}`,
      passwordHash, role: role.includes('admin') ? 'ADMIN' : role.toUpperCase(),
    } })
    for (const id of ['JAG', 'PUL', 'GLOBAL']) await db.costCenter.create({ data: { id, name: id } })
    const behaviorGroup = await db.costTagGroup.create({ data: { name: 'Charakter kosztu', slug: 'behavior', order: 1 } })
    const fixedTag = await db.costTag.create({ data: { groupId: behaviorGroup.id, name: 'Stały', slug: 'fixed' } })

    async function startServer() {
      assertNotAborted()
      serverReady = false
      let addressConflict = false, outputBytes = 0
      server = spawn(process.execPath, [path.join(repository, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
        cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      })
      const consume = (chunk) => {
        outputBytes += chunk.length
        const value = chunk.toString()
        if (value.includes('Ready in')) serverReady = true
        if (value.includes('EADDRINUSE') || outputBytes > 1024 * 1024) addressConflict = true
      }
      server.stdout.on('data', consume); server.stderr.on('data', consume)
      server.once('error', () => { addressConflict = true })
      for (let i = 0; i < 200; i++) {
        assertNotAborted()
        check(processAlive(server) && !addressConflict, 'LOOPBACK_NEXT_START_FAILED')
        if (serverReady && await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000), redirect: 'error' }).then((res) => res.ok).catch(() => false)) return
        await delay(100, undefined, { signal })
      }
      throw new GateError('LOOPBACK_NEXT_START_TIMEOUT')
    }

    async function startWorker() {
      assertNotAborted()
      workerFailure = undefined
      workerStarted = false
      workerAttach = spawn(DOCKER, ['--host', LOCAL_DOCKER, 'start', '--attach', workerName], {
        env: childEnvironment, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let pending = '', outputBytes = 0
      const consume = (chunk) => {
        outputBytes += chunk.length
        if (outputBytes > 64_000) { workerFailure = 'WORKER_OUTPUT_LIMIT'; return }
        pending += chunk.toString()
        const lines = pending.split('\n'); pending = lines.pop()
        for (const line of lines) {
          if (line === 'AI_SESSION_IN_USE') workerFailure = 'AI_SESSION_IN_USE'
          if (line === 'AI_WORKER_START_FAILED') workerFailure = 'AI_WORKER_START_FAILED'
          try {
            const event = JSON.parse(line)
            if (event.event === 'AI_WORKER_STARTED') {
              workerStarted = true
              report.workerEvents.push({ event: 'AI_WORKER_STARTED' })
            }
            if (event.event === 'AI_JOB_FINISHED' && ['succeeded', 'failed', 'blocked', 'lease_lost'].includes(event.status)) {
              report.workerEvents.push({ event: 'AI_JOB_FINISHED', status: event.status })
              if (event.status !== 'succeeded') workerFailure = `WORKER_${event.status.toUpperCase()}`
            }
          } catch { /* Unknown worker lines are discarded and never reported. */ }
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

    async function login(username) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
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

    async function waitFor(checkState, code, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        assertNotAborted()
        const result = await checkState()
        if (result) return result
        await delay(100, undefined, { signal })
      }
      throw new GateError(code)
    }

    async function downloadOriginal(page, expectedSha, artifactName) {
      const pendingDownload = page.waitForEvent('download')
      await page.getByRole('link', { name: 'Pobierz oryginał', exact: true }).click()
      const download = await pendingDownload
      const downloadedPath = await download.path()
      check(downloadedPath, 'DOWNLOAD_PATH_UNAVAILABLE')
      const bytes = await readFile(downloadedPath)
      check(createHash('sha256').update(bytes).digest('hex') === expectedSha, 'DOWNLOADED_ORIGINAL_HASH_MISMATCH')
      const retainedPath = path.join(artifactDirectory, artifactName)
      await writeFile(retainedPath, bytes, { flag: 'wx', mode: 0o600 })
      await chmod(retainedPath, 0o600)
      report.downloads.push({ path: retainedPath, sha256: expectedSha, byteSize: bytes.byteLength })
      return bytes.byteLength
    }

    async function assertEditorValues(page, values) {
      await expect(page.getByLabel('Rodzaj dokumentu', { exact: true })).toContainText('Faktura', { timeout: 15_000 })
      await expect(page.getByLabel('Numer dokumentu', { exact: true })).toHaveValue(values.invoiceNumber, { timeout: 15_000 })
      await expect(page.getByLabel('Nazwa dostawcy', { exact: true })).toHaveValue(values.supplierName, { timeout: 15_000 })
      await expect(page.getByLabel('NIP / identyfikator podatkowy', { exact: true })).toHaveValue(values.taxId, { timeout: 15_000 })
      await expect(page.getByLabel('Waluta', { exact: true })).toHaveValue(values.currency, { timeout: 15_000 })
      await expect(page.getByLabel('Data wystawienia', { exact: true })).toHaveValue(values.issueDate, { timeout: 15_000 })
      await expect(page.getByLabel('Termin płatności', { exact: true })).toHaveValue(values.dueDate, { timeout: 15_000 })
      await expect(page.getByLabel('Kwota brutto', { exact: true })).toHaveValue(String(values.gross), { timeout: 15_000 })
      await expect(page.getByLabel('Status płatności', { exact: true })).toContainText('Niezapłacona', { timeout: 15_000 })
    }

    async function openImportedDocument(page, invoiceNumber) {
      await page.goto(`${baseUrl}/finance/ksef`)
      await page.waitForLoadState('networkidle')
      const row = page.getByRole('row').filter({ hasText: invoiceNumber })
      await expect(row).toHaveCount(1)
      await row.getByRole('button', { name: 'Otwórz dokument', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Import faktur', exact: true })).toBeVisible()
    }

    currentStep = 'LOOPBACK_CONTAINER_HEALTH'
    await startServer()
    probeName = `wd-ai-oauth-chat-invoice-probe-${runId}`
    resources.add(probeName)
    const healthCode = `fetch(${JSON.stringify(`http://host.docker.internal:${port}/api/health`)},{signal:AbortSignal.timeout(5000),redirect:'error'}).then(r=>{if(!r.ok)process.exit(1);process.stdout.write('LOOPBACK_HEALTH_OK')}).catch(()=>process.exit(1))`
    const health = await docker(['run', '--pull', 'never', '--name', probeName,
      '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
      '--tmpfs', '/runtime:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=134217728',
      '--entrypoint', '/usr/local/bin/node', config.image, '-e', healthCode], { timeoutMs: 10_000 })
    check(health.code === 0 && health.stdout === 'LOOPBACK_HEALTH_OK', 'HOST_GATEWAY_CANNOT_REACH_LOOPBACK_NO_WIDER_BIND_ALLOWED')
    must(await docker(['rm', probeName]), 'PROBE_CLEANUP_FAILED')
    resources.delete(probeName)
    const worker = invoiceOAuthWorkerArgs(config, runId)
    check((await docker(['container', 'inspect', worker.name])).code !== 0, 'OWN_WORKER_NAME_ALREADY_EXISTS')
    must(await docker(worker.args, { env: {
      ...childEnvironment,
      AI_WORKER_ENABLED: 'true',
      AI_WORKER_URL: `http://host.docker.internal:${port}/api/internal/ai-worker`,
      AI_WORKER_SECRET: workerSecret,
    } }), 'WORKER_CREATE_FAILED')
    workerName = worker.name
    resources.add(workerName)
    step('CLEAN_DB_PRIVATE_STORAGE_AND_LOOPBACK_READY')

    currentStep = 'AUTHORIZATION_BOUNDARIES'
    browser = await chromium.launch(chatOAuthBrowserLaunchOptions(directory))
    const admin = await login(users.admin)
    activePage = admin
    const manager = await login(users.manager)
    const employee = await login(users.employee)
    const anonymousBatch = await fetch(`${baseUrl}/api/finance/invoice-import/batches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', redirect: 'manual', signal: AbortSignal.timeout(5_000),
    })
    check(anonymousBatch.status === 401, 'ANONYMOUS_IMPORT_ALLOWED')
    for (const page of [manager, employee]) {
      check((await page.request.post(`${baseUrl}/api/finance/invoice-import/batches`, { data: {} })).status() === 403, 'NON_ADMIN_IMPORT_ALLOWED')
    }
    check(await db.aiJob.count() === 0 && await db.invoiceImportDraft.count() === 0
      && await db.ksefInvoice.count() === 0 && await db.costEvent.count() === 0, 'DENIED_REQUEST_MUTATED_STATE')
    step('ANONYMOUS_MANAGER_EMPLOYEE_IMPORT_DENIED_WITH_ZERO_JOBS')

    currentStep = 'UPLOAD_WITH_STOPPED_WORKER'
    await admin.goto(`${baseUrl}/finance/ksef`)
    await admin.waitForLoadState('networkidle')
    await admin.getByRole('button', { name: 'Dodaj faktury', exact: true }).click()
    await expect(admin.getByRole('heading', { name: 'Import faktur', exact: true })).toBeVisible()
    await admin.getByLabel('Dodaj faktury', { exact: true }).setInputFiles(fixture.path)
    await expect(admin.getByText('Zapisany', { exact: true })).toBeVisible({ timeout: 20_000 })
    const queuedDraft = await waitFor(async () => db.invoiceImportDraft.findFirst({
      include: { attachment: true, latestAiJob: true },
    }).then((draft) => draft?.latestAiJob?.status === 'QUEUED' ? draft : null), 'UPLOAD_DID_NOT_QUEUE_ONE_JOB')
    check(await db.invoiceImportDraft.count() === 1 && await db.invoiceAttachment.count() === 1
      && await db.aiJob.count() === 1 && await db.ksefInvoice.count() === 0 && await db.costEvent.count() === 0,
    'INITIAL_UPLOAD_COUNTS_INVALID')
    check(queuedDraft.latestAiJob.kind === 'INVOICE_EXTRACT' && queuedDraft.latestAiJob.attempts === 0
      && queuedDraft.attachment.sha256 === fixture.sha256 && queuedDraft.attachment.mimeType === 'image/png'
      && queuedDraft.attachment.state === 'READY', 'INITIAL_QUEUED_STATE_INVALID')
    const storedOriginal = path.join(originalsDirectory, queuedDraft.attachment.storageKey)
    const storedInfo = await stat(storedOriginal)
    check(storedInfo.isFile() && (storedInfo.mode & 0o777) === 0o600, 'PRIVATE_ORIGINAL_MODE_INVALID')
    await expect(admin.getByRole('img', { name: FIXTURE_NAME, exact: true })).toBeVisible({ timeout: 15_000 })
    syntheticUiSafe = true
    await screenshot(admin, 'uploaded-visible-before-worker')
    for (const page of [manager, employee]) {
      check((await page.request.get(`${baseUrl}/api/finance/invoice-import/drafts/${queuedDraft.id}/file`)).status() === 403, 'NON_ADMIN_FILE_ALLOWED')
    }
    check((await fetch(`${baseUrl}/api/finance/invoice-import/drafts/${queuedDraft.id}/file`, {
      redirect: 'manual', signal: AbortSignal.timeout(5_000),
    })).status === 401, 'ANONYMOUS_FILE_ALLOWED')
    const fixtureBytes = await readFile(fixture.path)
    const deniedBefore = {
      attachments: await db.invoiceAttachment.count(),
      drafts: await db.invoiceImportDraft.count(),
      jobs: await db.aiJob.count(),
      attempts: (await db.aiJob.findMany({ select: { attempts: true } })).reduce((sum, job) => sum + job.attempts, 0),
    }
    const anonymousApi = await request.newContext({ baseURL: baseUrl })
    let anonymousUpload
    try {
      anonymousUpload = await anonymousApi.post('/api/finance/invoice-import/drafts', {
        multipart: invoiceOAuthMultipartPayload(queuedDraft.batchId, fixtureBytes),
      })
    } finally { await anonymousApi.dispose() }
    check(anonymousUpload.status() === 401, 'ANONYMOUS_MULTIPART_UPLOAD_ALLOWED')
    for (const page of [manager, employee]) {
      const response = await page.request.post(`${baseUrl}/api/finance/invoice-import/drafts`, {
        multipart: invoiceOAuthMultipartPayload(queuedDraft.batchId, fixtureBytes),
      })
      check(response.status() === 403, 'NON_ADMIN_MULTIPART_UPLOAD_ALLOWED')
    }
    const deniedAfter = {
      attachments: await db.invoiceAttachment.count(),
      drafts: await db.invoiceImportDraft.count(),
      jobs: await db.aiJob.count(),
      attempts: (await db.aiJob.findMany({ select: { attempts: true } })).reduce((sum, job) => sum + job.attempts, 0),
    }
    check(isDeepStrictEqual(deniedAfter, deniedBefore)
      && isDeepStrictEqual(deniedAfter, { attachments: 1, drafts: 1, jobs: 1, attempts: 0 }),
    'DENIED_MULTIPART_OR_FILE_REQUEST_MUTATED_STATE')
    step('ONE_PRIVATE_PNG_VISIBLE_AND_DENIED_MULTIPART_FILE_REQUESTS_LEFT_ONE_QUEUED_JOB')

    currentStep = 'ONE_REAL_INVOICE_OAUTH_ATTEMPT'
    const jobDeadline = Date.now() + JOB_DEADLINE_MS
    await startWorker()
    let completedJob
    while (Date.now() < jobDeadline) {
      assertNotAborted()
      check(!workerFailure && processAlive(workerAttach), workerFailure ?? 'WORKER_EXITED')
      const jobs = await db.aiJob.findMany({ select: { id: true, kind: true, status: true, attempts: true, resultJson: true, errorCode: true } })
      const attempts = jobs.reduce((sum, job) => sum + job.attempts, 0)
      report.observedModelAttempts = attempts
      if (attempts > MAX_MODEL_ATTEMPTS || jobs.some((job) => job.attempts > 1)) {
        await stopWorker()
        throw new GateError('UNEXPECTED_RETRY_OR_CALL_LIMIT')
      }
      const job = jobs[0]
      check(job && job.id === queuedDraft.latestAiJob.id && job.kind === 'INVOICE_EXTRACT', 'UNEXPECTED_JOB_SET')
      check(!['FAILED', 'BLOCKED', 'CANCELLED'].includes(job.status), `JOB_${job.status}_${/^[A-Z_]{1,40}$/.test(job.errorCode ?? '') ? job.errorCode : 'STOP'}`)
      if (job.status === 'SUCCEEDED') { completedJob = job; break }
      await delay(250, undefined, { signal })
    }
    check(completedJob?.status === 'SUCCEEDED' && completedJob.attempts === 1, 'JOB_DEADLINE_REACHED')
    // Stop inference immediately after durable success, before UI/business assertions.
    await stopWorker()
    let rawResult
    try { rawResult = JSON.parse(completedJob.resultJson ?? 'null') } catch { rawResult = null }
    const evidence = assessInvoiceOAuthEvidence(rawResult, invoiceResultSchema)
    check(evidence.passed, evidence.code)
    report.extraction = {
      jobId: completedJob.id,
      attempts: completedJob.attempts,
      resultSha256: createHash('sha256').update(completedJob.resultJson).digest('hex'),
      checked: evidence.checked,
    }
    await assertEditorValues(admin, INVOICE_OAUTH_EXPECTED)
    const aiAppliedDraft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: queuedDraft.id } })
    check(aiAppliedDraft.state === 'OPEN' && aiAppliedDraft.invoiceId === null
      && isDeepStrictEqual(JSON.parse(aiAppliedDraft.dataJson), INVOICE_OAUTH_EXPECTED), 'AI_RESULT_NOT_APPLIED_TO_OPEN_DRAFT')
    step('ONE_REAL_OAUTH_RESULT_SCHEMA_EXACT_AND_VISIBLE_BEFORE_MANUAL_EDIT')

    currentStep = 'MANUAL_CORRECTION_SAVE_APPROVE'
    await admin.getByLabel('Nazwa dostawcy', { exact: true }).fill('SYNTHETIC SUPPLIER POPRAWIONY')
    await admin.getByLabel('Miejsce kosztu', { exact: true }).click()
    await admin.getByRole('menuitemradio', { name: 'JAG', exact: true }).click()
    await admin.getByRole('button', { name: 'Stały', exact: true }).click()
    await admin.getByRole('button', { name: 'Zapisz szkic', exact: true }).click()
    const savedDraft = await waitFor(async () => db.invoiceImportDraft.findUnique({ where: { id: queuedDraft.id } }).then((draft) => {
      if (!draft) return null
      const data = JSON.parse(draft.dataJson)
      return data.supplierName === 'SYNTHETIC SUPPLIER POPRAWIONY' && data.costCenterId === 'JAG'
        && Array.isArray(data.tagIds) && data.tagIds.includes(fixedTag.id) ? draft : null
    }), 'MANUAL_SAVE_NOT_DURABLE')
    const manualFields = JSON.parse(savedDraft.manualFieldsJson)
    check(['supplierName', 'costCenterId', 'tagIds'].every((field) => manualFields.includes(field)), 'MANUAL_FIELD_PROTECTION_MISSING')
    await admin.getByRole('button', { name: 'Zatwierdź i następna', exact: true }).click()
    const firstApproved = await waitFor(async () => db.invoiceImportDraft.findUnique({
      where: { id: queuedDraft.id },
      include: { attachment: true, audits: true, invoice: { include: {
        parts: { include: { tags: true, allocations: true } },
        costEvent: { include: { parts: { include: { tags: true, allocations: true } } } },
        auditLogs: true,
      } } },
    }).then((draft) => draft?.state === 'APPROVED' ? draft : null), 'FIRST_APPROVAL_NOT_DURABLE')
    const firstInvoice = firstApproved.invoice
    const firstCost = firstInvoice?.costEvent
    check(firstInvoice && firstCost && firstApproved.invoiceId === firstInvoice.id
      && firstInvoice.source === 'MANUAL' && firstInvoice.status === 'APPROVED' && firstInvoice.documentStatus === 'ACTIVE'
      && firstInvoice.supplierName === 'SYNTHETIC SUPPLIER POPRAWIONY' && firstInvoice.grossAmount === 123
      && firstInvoice.currency === 'PLN' && firstInvoice.reportingGrossAmount === 123
      && firstInvoice.issueDate.toISOString().slice(0, 10) === '2026-09-10'
      && firstCost.sourceInvoiceId === firstInvoice.id && firstCost.status === 'APPROVED' && firstCost.documentStatus === 'ACTIVE'
      && firstCost.currency === 'PLN' && firstCost.grossAmount === 123 && firstCost.parts[0]?.allocations[0]?.costCenterId === 'JAG'
      && firstCost.parts[0]?.allocations[0]?.percent === 100 && firstCost.parts[0]?.tags[0]?.tagId === fixedTag.id,
    'FIRST_APPROVAL_RELATIONS_INVALID')
    check(firstApproved.audits.some((audit) => audit.action === 'AI_RESULT_APPLIED')
      && firstApproved.audits.some((audit) => audit.action === 'EDITED')
      && firstApproved.audits.some((audit) => audit.action === 'APPROVED')
      && firstInvoice.auditLogs.some((audit) => audit.action === 'invoice.approve'), 'FIRST_APPROVAL_AUDIT_MISSING')
    check(await db.ksefInvoice.count() === 1 && await db.costEvent.count({ where: { status: 'APPROVED', documentStatus: 'ACTIVE' } }) === 1,
      'FIRST_APPROVAL_COUNTS_INVALID')
    const firstDownloadedBytes = await downloadOriginal(admin, fixture.sha256, 'downloaded-original-before-revoke.png')
    check(firstDownloadedBytes === fixture.byteSize, 'DOWNLOADED_ORIGINAL_SIZE_MISMATCH')
    step('MANUAL_FIELDS_SAVED_ONE_INVOICE_ONE_ACTIVE_COST_AND_EXACT_DOWNLOAD')

    currentStep = 'DASHBOARD_AND_ALLOCATION_UI'
    await admin.goto(`${baseUrl}/dashboard?year=2026&month=9`)
    await admin.waitForLoadState('networkidle')
    const recognizedCosts = admin.getByRole('link', { name: /Koszty rozpoznane/ }).locator('xpath=..')
    await expect(recognizedCosts).toContainText(/123([,.]00)?\s*zł/i)
    await screenshot(admin, 'dashboard-september-recognized-cost-123')
    await admin.goto(`${baseUrl}/finance/cost-events`)
    await admin.waitForLoadState('networkidle')
    const costRow = admin.getByRole('row').filter({ hasText: 'FV/TEST/2026/09/01' })
    await expect(costRow).toContainText('JAG 100%')
    await expect(costRow).toContainText('123 PLN')
    await screenshot(admin, 'ledger-jag-allocation-123')
    step('DASHBOARD_COST_AND_JAG_ALLOCATION_VISIBLE')

    currentStep = 'REVOKE_EDIT_REAPPROVE_SAME_INVOICE'
    await openImportedDocument(admin, 'FV/TEST/2026/09/01')
    await admin.getByRole('button', { name: 'Cofnij z kosztów', exact: true }).click()
    const revoked = await waitFor(async () => db.invoiceImportDraft.findUnique({ where: { id: queuedDraft.id } })
      .then((draft) => draft?.state === 'OPEN' ? draft : null), 'REVOCATION_NOT_DURABLE')
    check(revoked.invoiceId === firstInvoice.id && await db.ksefInvoice.count() === 1
      && (await db.ksefInvoice.findUniqueOrThrow({ where: { id: firstInvoice.id } })).status === 'MAPPED'
      && await db.costEvent.count({ where: { status: 'APPROVED', documentStatus: 'ACTIVE' } }) === 0,
    'REVOCATION_STATE_INVALID')
    const priorVoid = await db.costEvent.findUniqueOrThrow({ where: { id: firstCost.id } })
    check(priorVoid.status === 'VOID' && priorVoid.sourceInvoiceId === null, 'PRIOR_COST_NOT_VOID')
    await expect(admin.getByText('Istnieje wcześniejszy zapis tego kosztu', { exact: true })).toBeVisible({ timeout: 15_000 })
    await admin.getByLabel('Kwota brutto', { exact: true }).fill('246')
    await admin.getByLabel('Data wystawienia', { exact: true }).fill('2026-09-11')
    await admin.getByText('Dane szczegółowe', { exact: false }).click()
    await admin.getByLabel('Kwota netto', { exact: true }).fill('200')
    await admin.getByLabel('Kwota VAT', { exact: true }).fill('46')
    await admin.getByRole('button', { name: 'Zatwierdź i następna', exact: true }).click()
    const reapproved = await waitFor(async () => db.invoiceImportDraft.findUnique({
      where: { id: queuedDraft.id }, include: { audits: true, invoice: true },
    }).then((draft) => draft?.state === 'APPROVED' && draft.invoice?.grossAmount === 246 ? draft : null), 'REAPPROVAL_NOT_DURABLE')
    check(reapproved.invoiceId === firstInvoice.id && reapproved.invoice.id === firstInvoice.id
      && reapproved.invoice.issueDate.toISOString().slice(0, 10) === '2026-09-11'
      && reapproved.invoice.netAmount === 200 && reapproved.invoice.vatAmount === 46
      && await db.ksefInvoice.count() === 1, 'REAPPROVAL_CREATED_OR_CHANGED_INVOICE_ID')
    const allCosts = await db.costEvent.findMany()
    const historicalCost = allCosts.find((row) => row.id === firstCost.id)
    const currentCost = allCosts.find((row) => row.id !== firstCost.id)
    check(allCosts.length === 2 && historicalCost?.status === 'VOID'
      && historicalCost.sourceInvoiceId === null && currentCost?.status === 'APPROVED'
      && currentCost.sourceInvoiceId === firstInvoice.id && currentCost.grossAmount === 246,
    'REAPPROVAL_COST_HISTORY_INVALID')
    check(reapproved.audits.filter((audit) => audit.action === 'APPROVED').length === 2
      && reapproved.audits.some((audit) => audit.action === 'REVOKED'), 'REAPPROVAL_AUDIT_HISTORY_INVALID')
    const attemptsBeforeRestart = (await db.aiJob.findMany({ select: { attempts: true } })).reduce((sum, job) => sum + job.attempts, 0)
    check(attemptsBeforeRestart === 1 && await db.aiJob.count({ where: { status: 'QUEUED' } }) === 0, 'EXTRA_MODEL_ATTEMPT_BEFORE_RESTART')
    step('REVOKE_EDIT_REAPPROVE_REUSED_INVOICE_AND_VOIDED_PRIOR_COST')

    currentStep = 'NEXT_AND_EMPTY_WORKER_RESTART_DURABILITY'
    const durableBefore = {
      draftId: reapproved.id,
      invoiceId: reapproved.invoiceId,
      attachmentId: firstApproved.attachmentId,
      jobIds: (await db.aiJob.findMany({ orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id),
      auditIds: (await db.invoiceDraftAudit.findMany({ where: { draftId: reapproved.id }, orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id),
      costEventIds: (await db.costEvent.findMany({ orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id),
    }
    await stopServer()
    await startServer()
    await startWorker()
    await delay(1_000, undefined, { signal })
    check(processAlive(workerAttach) && !workerFailure
      && await db.aiJob.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }) === 0, 'EMPTY_WORKER_FOUND_JOB')
    await stopWorker()
    const attemptsAfterRestart = (await db.aiJob.findMany({ select: { attempts: true } })).reduce((sum, job) => sum + job.attempts, 0)
    check(attemptsAfterRestart === attemptsBeforeRestart, 'EMPTY_WORKER_ADDED_MODEL_ATTEMPT')
    await openImportedDocument(admin, 'FV/TEST/2026/09/01')
    await assertEditorValues(admin, {
      ...INVOICE_OAUTH_EXPECTED,
      supplierName: 'SYNTHETIC SUPPLIER POPRAWIONY', issueDate: '2026-09-11', gross: 246,
    })
    await admin.getByRole('button', { name: 'Historia dokumentu', exact: true }).click()
    for (const label of ['Dodano dokument', 'Zastosowano wynik odczytu', 'Zapisano poprawki', 'Zatwierdzono w kosztach', 'Cofnięto z kosztów']) {
      await expect(admin.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await downloadOriginal(admin, fixture.sha256, 'downloaded-original-after-restart.png')
    const durableAfter = {
      draftId: (await db.invoiceImportDraft.findFirstOrThrow()).id,
      invoiceId: (await db.ksefInvoice.findFirstOrThrow()).id,
      attachmentId: (await db.invoiceAttachment.findFirstOrThrow()).id,
      jobIds: (await db.aiJob.findMany({ orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id),
      auditIds: (await db.invoiceDraftAudit.findMany({ where: { draftId: reapproved.id }, orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id),
      costEventIds: (await db.costEvent.findMany({ orderBy: { id: 'asc' }, select: { id: true } })).map((row) => row.id),
    }
    check(isDeepStrictEqual(durableAfter, durableBefore), 'DURABLE_IDS_CHANGED_AFTER_RESTART')
    check((await stat(storedOriginal)).isFile()
      && createHash('sha256').update(await readFile(storedOriginal)).digest('hex') === fixture.sha256,
    'PRIVATE_ORIGINAL_NOT_DURABLE')
    await screenshot(admin, 'restart-cookie-original-history-durable')
    step('NEXT_AND_EMPTY_WORKER_RESTART_PRESERVED_COOKIE_FILE_HISTORY_IDS_AND_ONE_ATTEMPT')

    currentStep = 'FINAL_READBACK'
    check(await db.invoiceImportDraft.count() === 1 && await db.invoiceAttachment.count() === 1
      && await db.ksefInvoice.count() === 1 && await db.costEvent.count() === 2
      && await db.costEvent.count({ where: { status: 'APPROVED', documentStatus: 'ACTIVE', grossAmount: 246 } }) === 1,
    'FINAL_COUNTS_INVALID')
    check(!report.uncaughtPageErrors, 'UNCAUGHT_PAGE_ERRORS')
    const integrity = must(await command('/usr/bin/sqlite3', [databasePath, 'PRAGMA integrity_check; PRAGMA foreign_key_check;']), 'SQLITE_INTEGRITY_COMMAND_FAILED')
    check(integrity === 'ok', 'SQLITE_INTEGRITY_OR_FOREIGN_KEYS_FAILED')
    await chmod(databasePath, 0o600)
    report.final = {
      invoiceId: firstInvoice.id, draftId: queuedDraft.id, modelAttempts: attemptsAfterRestart,
      activeCostGross: 246, priorVoidCostCount: 1, invoiceCount: 1, integrity: 'ok', foreignKeyViolations: 0,
    }
    report.status = 'PASS'
  } catch (error) {
    // On every non-signal error, stop inference before even taking a synthetic
    // diagnostic screenshot. Signal shutdown already follows the same order.
    let stopVerified = false
    try {
      if (interruptStopPromise) await interruptStopPromise
      else await stopWorker({ cleanup: true })
      stopVerified = true
    } catch { /* Final cleanup retries, but no UI work is allowed without confirmation. */ }
    report.status = 'FAIL'
    report.failedStep = currentStep
    const triggerCode = signal.aborted ? 'INTERRUPTED' : error instanceof GateError ? error.code : 'GATE_CHECK_FAILED'
    report.code = stopVerified ? triggerCode : 'WORKER_STOP_UNVERIFIED'
    if (!stopVerified) report.triggerCode = triggerCode
    if (report.code === 'HOST_GATEWAY_CANNOT_REACH_LOOPBACK_NO_WIDER_BIND_ALLOWED') {
      report.actionRequired = 'Docker host.docker.internal cannot reach 127.0.0.1. Gate stopped; widening the bind requires separate explicit operator approval.'
    }
    if (stopVerified && syntheticUiSafe && activePage && !activePage.isClosed()) {
      try { await screenshot(activePage, `failure-${currentStep.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`) } catch { /* Screenshot is diagnostic only. */ }
    }
  } finally {
    await cleanup()
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    const cleanupFailed = Object.entries(report.cleanup).some(([key, value]) => value === false && key !== 'oauthVolumeRemoved')
    if (cleanupFailed) { report.status = 'FAIL'; report.cleanupCode = 'CLEANUP_FAILED' }
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 })
    await chmod(artifactDirectory, 0o700)
    const reportPath = path.join(artifactDirectory, 'report.json')
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    await chmod(reportPath, 0o600)
    process.stdout.write(`${JSON.stringify({ status: report.status, code: report.code ?? report.cleanupCode ?? null, report: reportPath })}\n`)
    process.exitCode = report.status === 'PASS' ? 0 : 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error instanceof GateError ? error.code : 'GATE_START_FAILED' })}\n`)
    process.exitCode = 1
  })
}
