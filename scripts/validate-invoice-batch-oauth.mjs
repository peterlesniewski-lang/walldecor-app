#!/usr/bin/env node
/**
 * MANUAL mixed-batch real OAuth gate. Importing this module performs no I/O.
 * Prepare and review before running; no automatic execution or model fallback.
 *
 * node scripts/validate-invoice-batch-oauth.mjs --confirm-synthetic-oauth \
 *   --image sha256:bda6aeaf318510dc9f4fd0676f5b3037aa6dddebf5482203d801cf6fd81e8aab \
 *   --oauth-volume wd-ai-oauth-piotr-local-20260911
 *
 * Six UI inputs, four unique accepted originals and four durable queue claims
 * maximum. Original OAuth contents are never read/copied/repaired/removed.
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
import { chatOAuthBrowserLaunchOptions, chatOAuthFixtureUsernames } from './validate-ai-chat-oauth.mjs'
import {
  INVOICE_OAUTH_EXPECTED, parseInvoiceOAuthArgs, invoiceOAuthWorkerArgs,
  ensureOwnedWorkerStopped, invoiceOAuthServerEnvironment, loadInvoiceResultSchema,
  captureSyntheticScreenshot, retainHandledRejection,
} from './validate-invoice-import-oauth.mjs'

const DOCKER = '/usr/local/bin/docker'
const LOCAL_DOCKER = 'unix:///Users/piotr/.docker/run/docker.sock'
const JOB_DEADLINE_MS = 150_000
const OWNERSHIP_LABEL = 'wd.invoice-batch-oauth.run-id'
const CLAIM_JOB_PATTERN = /^[a-zA-Z0-9_-]{1,191}$/

export const INVOICE_BATCH_LIMITS = Object.freeze({
  inputFiles: 6, acceptedUniqueFiles: 4, maximumModelClaims: 4, maximumClaimsPerJob: 1,
  approvedInvoices: 2, activeCosts: 2, recognizedGrossPLN: 553,
  providerFallback: false, automaticHarnessRetry: false,
})
const EUR_EXPECTED = Object.freeze({
  documentType: 'INVOICE', supplierName: 'SYNTHETIC EURO SUPPLIER', taxId: 'DE123456789',
  invoiceNumber: 'EU/TEST/2026/09/02', issueDate: '2026-09-10', dueDate: '2026-09-24',
  currency: 'EUR', gross: 100, net: 80, vat: 20, bankAccount: null, paymentStatus: 'UNPAID',
})
const CORRECTION_EXPECTED = Object.freeze({
  ...INVOICE_OAUTH_EXPECTED, documentType: 'CORRECTION', invoiceNumber: 'KOR/TEST/2026/09/03',
  gross: -123, net: -100, vat: -23,
})

class GateError extends Error {
  constructor(code) { super(code); this.code = code }
}
const check = (condition, code) => { if (!condition) throw new GateError(code) }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function parseInvoiceBatchOAuthArgs(args) {
  return parseInvoiceOAuthArgs(args)
}

export function invoiceBatchPdfBinaryCandidates(name) {
  check(['pdfinfo', 'pdftoppm'].includes(name), 'UNSUPPORTED_PDF_BINARY')
  return [
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
    '/Users/piotr/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/override',
  ].map((root) => path.join(root, name))
}

export function invoiceBatchFixturePlan() {
  return [
    { key: 'pln', name: '01-synthetic-pln.png', mimeType: 'image/png', pageCount: null, expected: { ...INVOICE_OAUTH_EXPECTED } },
    { key: 'eur', name: '02-synthetic-eur-two-pages.pdf', mimeType: 'application/pdf', pageCount: 2, expected: { ...EUR_EXPECTED } },
    { key: 'blank', name: '03-blank.png', mimeType: 'image/png', pageCount: null, expected: null },
    { key: 'correction', name: '04-synthetic-negative-correction.png', mimeType: 'image/png', pageCount: null, expected: { ...CORRECTION_EXPECTED } },
    { key: 'duplicate', name: '05-duplicate-pln.png', mimeType: 'image/png', pageCount: null, expected: null },
    { key: 'malformed', name: '06-malformed.pdf', mimeType: 'application/pdf', pageCount: null, expected: null },
  ]
}

function invoiceSvg(data) {
  const lines = [
    'SYNTHETIC TEST ONLY - NOT AN ACCOUNTING DOCUMENT',
    data.documentType === 'CORRECTION' ? 'CORRECTION / KOREKTA - NEGATIVE ADJUSTMENT' : 'INVOICE / FAKTURA VAT',
    `Invoice number: ${data.invoiceNumber}`, `Issue date: ${data.issueDate}`, `Due date: ${data.dueDate}`,
    `Supplier: ${data.supplierName}`, `Tax ID: ${data.taxId}`,
    `NET: ${data.net.toFixed(2)} ${data.currency}`, `VAT: ${data.vat.toFixed(2)} ${data.currency}`,
    `GROSS TOTAL: ${data.gross.toFixed(2)} ${data.currency}`, 'PAYMENT STATUS: UNPAID / NIEZAPLACONA',
    'No bank account stated. All entities and amounts are fictional.',
  ]
  return `<svg width="1600" height="2000" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="2000" fill="white"/><g fill="#111" font-family="DejaVu Sans">${lines.map((text, index) => `<text x="90" y="${130 + index * 145}" font-size="${index === 1 || index === 9 ? 46 : 38}" font-weight="${index === 1 || index === 9 ? '700' : '400'}">${text}</text>`).join('')}</g></svg>`
}

/** Returns actual local fixture bytes without filesystem, process or network I/O. */
export async function createInvoiceBatchFixtureBytes() {
  const [{ default: sharp }, { jsPDF }] = await Promise.all([import('sharp'), import('jspdf')])
  const plan = invoiceBatchFixturePlan()
  const pln = await sharp(Buffer.from(invoiceSvg(INVOICE_OAUTH_EXPECTED))).png().toBuffer()
  const blank = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: 'white' } }).png().toBuffer()
  const correction = await sharp(Buffer.from(invoiceSvg(CORRECTION_EXPECTED))).png().toBuffer()
  const pdf = new jsPDF({ compress: false, unit: 'mm', format: 'a4' })
  pdf.setProperties({ title: 'SYNTHETIC EUR invoice - two pages', author: 'Synthetic acceptance fixture' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14)
  pdf.text('SYNTHETIC TEST ONLY - NOT A REAL INVOICE', 15, 20)
  pdf.setFontSize(24); pdf.text('INVOICE / FAKTURA VAT', 15, 45)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(16)
  for (const [index, line] of [
    `Invoice number: ${EUR_EXPECTED.invoiceNumber}`, `Issue date: ${EUR_EXPECTED.issueDate}`,
    `Due date: ${EUR_EXPECTED.dueDate}`, `Supplier: ${EUR_EXPECTED.supplierName}`, `Tax ID: ${EUR_EXPECTED.taxId}`,
    'Page 1 of 2 - totals and payment are on page 2.',
  ].entries()) pdf.text(line, 15, 75 + index * 22)
  pdf.addPage()
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17)
  pdf.text(`Invoice: ${EUR_EXPECTED.invoiceNumber}`, 15, 30)
  pdf.text('PAGE 2 OF 2 - TOTALS AND PAYMENT', 15, 50)
  pdf.setFontSize(23)
  pdf.text('NET: 80.00 EUR', 15, 95); pdf.text('VAT: 20.00 EUR', 15, 130)
  pdf.text('GROSS TOTAL: 100.00 EUR', 15, 165)
  pdf.setFontSize(15); pdf.text('PAYMENT STATUS: UNPAID / NIEZAPLACONA', 15, 200)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(12)
  pdf.text('No bank account stated. All entities are fictional.', 15, 230)
  const contents = {
    pln, eur: Buffer.from(pdf.output('arraybuffer')), blank, correction, duplicate: Buffer.from(pln),
    malformed: Buffer.from('%PDF-1.7\nMALFORMED SYNTHETIC FIXTURE\n%%EOF\n'),
  }
  return plan.map((fixture) => ({ ...fixture, bytes: contents[fixture.key] }))
}

/** Every response passes the production schema; prose/warnings never enter reports. */
export function assessInvoiceBatchEvidence(key, result, schema) {
  if (typeof schema?.safeParse !== 'function' || !schema.safeParse(result).success) {
    return { passed: false, code: 'INVALID_RESULT_SCHEMA' }
  }
  const fixture = invoiceBatchFixturePlan().find((entry) => entry.key === key)
  if (!fixture || ['duplicate', 'malformed'].includes(key)) return { passed: false, code: 'UNEXPECTED_EXTRACTION' }
  const facts = Object.fromEntries(Object.keys(INVOICE_OAUTH_EXPECTED).map((field) => [field, result[field]]))
  if (key === 'blank') {
    if (Object.entries(facts).some(([field, value]) => field === 'documentType'
      ? ![null, 'OTHER'].includes(value) : field === 'paymentStatus' ? ![null, 'UNKNOWN'].includes(value) : value !== null)) {
      return { passed: false, code: 'BLANK_PAGE_INVENTED_FACTS' }
    }
    return { passed: true, checked: facts }
  }
  return isDeepStrictEqual(facts, fixture.expected)
    ? { passed: true, checked: fixture.expected } : { passed: false, code: 'VALUE_MISMATCH' }
}

function validAllowedIds(ids) {
  return Array.isArray(ids) && ids.length === 4 && new Set(ids).size === 4
    && ids.every((id) => typeof id === 'string' && CLAIM_JOB_PATTERN.test(id))
}

export function assessInvoiceBatchBudget(jobs, allowedIds) {
  const failure = { passed: false, code: 'UNEXPECTED_RETRY_OR_CALL_LIMIT' }
  if (!validAllowedIds(allowedIds) || !Array.isArray(jobs) || jobs.length !== 4
    || new Set(jobs.map((job) => job?.id)).size !== 4) return failure
  if (jobs.some((job) => !job || !allowedIds.includes(job.id) || job.kind !== 'INVOICE_EXTRACT'
    || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 1
    || !['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(job.status)
    || (job.status === 'QUEUED' ? job.attempts !== 0 : job.attempts !== 1))) return failure
  const claims = jobs.reduce((sum, job) => sum + job.attempts, 0)
  if (claims > 4 || jobs.filter((job) => job.status === 'RUNNING').length > 1) return failure
  return { passed: true, complete: jobs.every((job) => job.status === 'SUCCEEDED') && claims === 4, claims }
}

/** Local clean-database fences prevent a retry/fifth claim before model work. */
export function invoiceBatchClaimGuards(allowedIds) {
  check(validAllowedIds(allowedIds), 'INVALID_ALLOWED_JOB_SET')
  const quotedIds = allowedIds.map((id) => `'${id}'`).join(',')
  return [
    `CREATE TRIGGER "invoice_batch_no_extra_job" BEFORE INSERT ON "AiJob"
      BEGIN SELECT RAISE(ABORT, 'INVOICE_BATCH_JOB_SET_FROZEN'); END`,
    `CREATE TRIGGER "invoice_batch_claim_limit" BEFORE UPDATE ON "AiJob"
      WHEN NEW."id" NOT IN (${quotedIds}) OR NEW."kind" <> 'INVOICE_EXTRACT'
        OR NEW."attempts" < OLD."attempts" OR NEW."attempts" > 1
        OR (SELECT COALESCE(SUM("attempts"),0) FROM "AiJob" WHERE "id" <> OLD."id") + NEW."attempts" > 4
      BEGIN SELECT RAISE(ABORT, 'INVOICE_BATCH_CLAIM_LIMIT'); END`,
  ]
}

export async function startInvoiceBatchWorkerWithinBoundary(verifyOwnership, assertActive, start) {
  assertActive()
  await verifyOwnership()
  assertActive()
  return start()
}

export function invoiceBatchPdfPluginMatches(plugin, blobUrl) {
  return typeof blobUrl === 'string' && blobUrl.startsWith('blob:')
    && plugin?.type === 'application/x-google-chrome-pdf' && plugin.originalUrl === blobUrl
}

async function main(args) {
  // This must remain before mkdir/imports/processes or any other runtime I/O.
  const config = parseInvoiceBatchOAuthArgs(args)
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const artifactDirectory = path.join(repository, 'test-results', `invoice-batch-oauth-${runId}`)
  const controller = new AbortController()
  const { signal } = controller
  const childEnvironment = { PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8' }
  const report = {
    status: 'RUNNING', runId, imageId: config.image, oauthVolume: config.oauthVolume,
    scope: 'One six-file UI batch, four real OAuth extractions, two UI-approved costs on clean local SQLite. No KSeF simulation or production changes.',
    limits: { ...INVOICE_BATCH_LIMITS, jobDeadlineMs: JOB_DEADLINE_MS,
      providerRequestCount: 'Not observable. Counted attempts are durable queue claims, not provider HTTP requests.' },
    workerBoundary: { oauthContentsRead: false, oauthVolumeRemoved: false, dockerSocketMounted: false,
      repositoryMounted: false, hostHomeMounted: false },
    passed: [], screenshots: [], downloads: [], workerEvents: [], cleanup: {},
  }
  let directory, db, browser, server, workerAttach, workerName, activePage, cleanupPromise, interruptStopPromise
  let serverReady = false, workerStarted = false, workerFailure, workerStopped = true, syntheticUiSafe = false
  let currentStep = 'PREFLIGHT'
  const resources = new Set()
  const alive = (child) => child && child.exitCode === null && child.signalCode === null
  const assertNotAborted = () => check(!signal.aborted, 'INTERRUPTED')
  const step = (code) => { report.passed.push(code); process.stdout.write(`PASS ${code}\n`) }
  const screenshot = (page, label) => captureSyntheticScreenshot(page, artifactDirectory, label, report.screenshots)

  // Capture only bounded stdout needed for control flow. Never save raw command
  // stderr, worker/provider prose, process arguments, environment or credentials.
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
  async function verifyOwned(name) {
    const result = await docker(['inspect', '--format', `{{ index .Config.Labels "${OWNERSHIP_LABEL}" }}`, name], { cleanup: true })
    check(result.code === 0 && result.stdout.trim() === runId, 'CONTAINER_OWNERSHIP_UNVERIFIED')
  }
  async function stopServer() {
    if (!alive(server)) return
    const child = server
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    try { await closed } finally { clearTimeout(timer) }
    serverReady = false
  }
  async function stopWorker({ cleanup = false, requireClean = !cleanup } = {}) {
    if (!workerName) { workerStopped = true; return }
    await verifyOwned(workerName)
    const outcome = await ensureOwnedWorkerStopped((commandArgs, options) => docker(commandArgs, { ...options, cleanup }), workerName)
    if (alive(workerAttach)) {
      await Promise.race([new Promise((resolve) => workerAttach.once('close', resolve)), delay(2_000)])
      check(!alive(workerAttach), 'WORKER_ATTACH_NOT_CLOSED')
    }
    workerStarted = false
    workerStopped = true
    check(!requireClean || outcome.clean, 'WORKER_DID_NOT_STOP_CLEANLY')
    report.workerStop = outcome
  }
  async function cleanup() {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      try { await stopWorker({ cleanup: true }); report.cleanup.workerStopped = true }
      catch { report.cleanup.workerStopped = false }
      for (const name of resources) {
        try {
          await verifyOwned(name)
          report.cleanup[name] = (await docker(['rm', '--force', name], { cleanup: true })).code === 0
        } catch { report.cleanup[name] = false }
      }
      if (alive(workerAttach)) workerAttach.kill('SIGKILL')
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
    if (!interruptStopPromise) interruptStopPromise = retainHandledRejection((async () => {
      await stopWorker({ cleanup: true })
      try { await browser?.close() } catch { /* Final cleanup records any failure. */ }
    })())
  }
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)

  try {
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 }); await chmod(artifactDirectory, 0o700)
    const imageMetadata = must(await docker(['image', 'inspect', '--format', '{{.Id}}|{{.Os}}|{{.Architecture}}|{{.Config.User}}|{{json .Config.Entrypoint}}', config.image]), 'LOCAL_IMAGE_NOT_FOUND')
    check(imageMetadata === `${config.image}|linux|arm64|node|["/usr/bin/tini","--","/opt/ai/worker/ai/entrypoint.sh"]`, 'UNEXPECTED_IMAGE_BOUNDARY')
    const volumeMetadata = must(await docker(['volume', 'inspect', '--format', '{{.Name}}|{{.Driver}}|{{json .Options}}', config.oauthVolume]), 'EXISTING_OAUTH_VOLUME_REQUIRED')
    check([`${config.oauthVolume}|local|null`, `${config.oauthVolume}|local|{}`].includes(volumeMetadata), 'PLAIN_LOCAL_VOLUME_REQUIRED')
    // Metadata only: no auth-file reads, volume creation, copying or removal.
    const buildId = (await readFile(path.join(repository, '.next/BUILD_ID'), 'utf8')).trim()
    check(/^[a-zA-Z0-9_-]+$/.test(buildId), 'PRODUCTION_BUILD_REQUIRED')
    report.buildId = buildId
    const pdfBinary = async (name) => {
      for (const target of invoiceBatchPdfBinaryCandidates(name)) {
        const info = await stat(target).catch(() => null)
        if (info?.isFile() && (info.mode & 0o111)) return realpath(target)
      }
      throw new GateError('LOCAL_PDF_RENDERER_REQUIRED')
    }
    const [pdfInfoBinary, pdfToPpmBinary] = await Promise.all([pdfBinary('pdfinfo'), pdfBinary('pdftoppm')])
    directory = await realpath(await mkdtemp(path.join(tmpdir(), 'wd-invoice-batch-oauth-')))
    await chmod(directory, 0o700)
    const databasePath = path.join(directory, 'synthetic.sqlite')
    const originalsDirectory = path.join(directory, 'originals')
    const processingDirectory = path.join(directory, 'processing')
    const fixtureDirectory = path.join(directory, 'fixtures')
    for (const target of [originalsDirectory, processingDirectory, fixtureDirectory]) {
      await mkdir(target, { mode: 0o700 }); await chmod(target, 0o700)
    }
    const fixtures = []
    for (const fixture of await createInvoiceBatchFixtureBytes()) {
      const target = path.join(fixtureDirectory, fixture.name)
      await writeFile(target, fixture.bytes, { flag: 'wx', mode: 0o600 }); await chmod(target, 0o600)
      const { bytes, ...descriptor } = fixture
      fixtures.push({ ...descriptor, path: target, sha256: sha256(bytes), byteSize: bytes.byteLength })
    }
    report.fixtures = fixtures.map(({ key, name, mimeType, pageCount, sha256: hash, byteSize }) => ({ key, name, mimeType, pageCount, sha256: hash, byteSize }))
    const portProbe = createServer()
    await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(0, '127.0.0.1', resolve) })
    const port = portProbe.address().port
    await new Promise((resolve) => portProbe.close(resolve))
    const baseUrl = `http://127.0.0.1:${port}`
    const databaseUrl = `file:${databasePath}`
    const password = randomBytes(24).toString('base64url')
    const workerSecret = randomBytes(48).toString('base64url')
    const environment = {
      ...invoiceOAuthServerEnvironment({ databaseUrl, baseUrl, nextAuthSecret: randomBytes(48).toString('base64url'),
        workerSecret, originalsDirectory, processingDirectory }),
      INVOICE_PDFINFO_BINARY: pdfInfoBinary, INVOICE_PDFTOPPM_BINARY: pdfToPpmBinary,
    }
    report.baseUrl = baseUrl; report.syntheticDatabase = databasePath
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
      timeoutMs: 60_000, env: { ...environment, RUST_LOG: 'debug' }, cwd: directory,
    }), 'SYNTHETIC_MIGRATION_FAILED')
    const [{ default: bcrypt }, { chromium, expect }, { PrismaClient }, resultSchema] = await Promise.all([
      import('bcryptjs'), import('@playwright/test'), import('../src/generated/prisma/index.js'), loadInvoiceResultSchema(),
    ])
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    const username = chatOAuthFixtureUsernames(runId).admin
    await db.user.create({ data: { id: username, username, email: `${username}@example.test`, name: 'SYNTHETIC ADMIN',
      passwordHash: await bcrypt.hash(password, 10), role: 'ADMIN' } })
    for (const id of ['JAG', 'PUL', 'GLOBAL']) await db.costCenter.create({ data: { id, name: id } })
    const group = await db.costTagGroup.create({ data: { name: 'Charakter kosztu', slug: 'behavior', order: 1 } })
    const fixedTag = await db.costTag.create({ data: { groupId: group.id, name: 'Stały', slug: 'fixed' } })

    async function startServer() {
      assertNotAborted(); serverReady = false
      let failed = false, outputBytes = 0
      server = spawn(process.execPath, [path.join(repository, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
        cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      })
      const consume = (chunk) => {
        outputBytes += chunk.length
        if (chunk.toString().includes('Ready in')) serverReady = true
        if (chunk.toString().includes('EADDRINUSE') || outputBytes > 1024 * 1024) failed = true
      }
      server.stdout.on('data', consume); server.stderr.on('data', consume)
      server.once('error', () => { failed = true })
      for (let i = 0; i < 200; i++) {
        assertNotAborted(); check(alive(server) && !failed, 'LOOPBACK_NEXT_START_FAILED')
        if (serverReady && await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000), redirect: 'error' }).then((res) => res.ok).catch(() => false)) return
        await delay(100, undefined, { signal })
      }
      throw new GateError('LOOPBACK_NEXT_START_TIMEOUT')
    }
    async function startWorker() {
      await startInvoiceBatchWorkerWithinBoundary(() => verifyOwned(workerName), assertNotAborted, () => {
        workerFailure = undefined; workerStarted = false; workerStopped = false
        workerAttach = spawn(DOCKER, ['--host', LOCAL_DOCKER, 'start', '--attach', workerName], {
          env: childEnvironment, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        })
      })
      let pending = '', outputBytes = 0
      const consume = (chunk) => {
        outputBytes += chunk.length
        if (outputBytes > 64_000) { workerFailure = 'WORKER_OUTPUT_LIMIT'; return }
        pending += chunk.toString()
        const lines = pending.split('\n'); pending = lines.pop()
        for (const line of lines) {
          if (line === 'AI_SESSION_IN_USE' || line === 'AI_WORKER_START_FAILED') workerFailure = line
          try {
            const event = JSON.parse(line)
            if (event.event === 'AI_WORKER_STARTED') {
              workerStarted = true; report.workerEvents.push({ event: 'AI_WORKER_STARTED' })
            }
            if (event.event === 'AI_JOB_FINISHED' && ['succeeded', 'failed', 'blocked', 'lease_lost'].includes(event.status)) {
              report.workerEvents.push({ event: 'AI_JOB_FINISHED', status: event.status })
              if (event.status !== 'succeeded') workerFailure = `WORKER_${event.status.toUpperCase()}`
            }
          } catch { /* Unknown lines are discarded, never saved. */ }
        }
      }
      workerAttach.stdout.on('data', consume); workerAttach.stderr.on('data', consume)
      workerAttach.once('error', () => { workerFailure = 'WORKER_ATTACH_FAILED' })
      for (let i = 0; i < 150; i++) {
        assertNotAborted(); check(!workerFailure && alive(workerAttach), workerFailure ?? 'WORKER_EXITED')
        if (workerStarted) return
        await delay(100, undefined, { signal })
      }
      throw new GateError('WORKER_START_TIMEOUT')
    }
    async function waitFor(read, code, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        assertNotAborted()
        const value = await read()
        if (value) return value
        await delay(100, undefined, { signal })
      }
      throw new GateError(code)
    }
    const readJobs = () => db.aiJob.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, kind: true, status: true, attempts: true, resultJson: true,
    } })
    const readMoney = () => Promise.all([db.ksefInvoice.findMany({ orderBy: { id: 'asc' } }),
      db.costEvent.findMany({ orderBy: { id: 'asc' } }), db.costAuditLog.findMany({ orderBy: { id: 'asc' } })])
    const durable = () => Promise.all([
      db.invoiceImportBatch.findMany({ orderBy: { id: 'asc' } }),
      db.invoiceAttachment.findMany({ orderBy: { id: 'asc' } }),
      db.invoiceImportDraft.findMany({ orderBy: { id: 'asc' } }),
      db.invoiceDraftAudit.findMany({ orderBy: { id: 'asc' } }), readMoney(), readJobs(),
    ])

    currentStep = 'LOOPBACK_CONTAINER_HEALTH'
    await startServer()
    const probeName = `wd-ai-oauth-chat-invoice-probe-${runId}`
    check((await docker(['container', 'inspect', probeName])).code !== 0, 'OWN_PROBE_NAME_ALREADY_EXISTS')
    resources.add(probeName)
    const healthCode = `fetch(${JSON.stringify(`http://host.docker.internal:${port}/api/health`)},{signal:AbortSignal.timeout(5000),redirect:'error'}).then(r=>{if(!r.ok)process.exit(1);process.stdout.write('LOOPBACK_HEALTH_OK')}).catch(()=>process.exit(1))`
    const health = await docker(['run', '--pull', 'never', '--name', probeName, '--label', `${OWNERSHIP_LABEL}=${runId}`,
      '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
      '--tmpfs', '/runtime:rw,noexec,nosuid,nodev,uid=1000,gid=1000,mode=0700,size=134217728',
      '--entrypoint', '/usr/local/bin/node', config.image, '-e', healthCode], { timeoutMs: 10_000 })
    check(health.code === 0 && health.stdout === 'LOOPBACK_HEALTH_OK', 'HOST_GATEWAY_CANNOT_REACH_LOOPBACK_NO_WIDER_BIND_ALLOWED')
    await verifyOwned(probeName)
    must(await docker(['rm', probeName]), 'PROBE_CLEANUP_FAILED'); resources.delete(probeName)
    const worker = invoiceOAuthWorkerArgs(config, runId)
    check((await docker(['container', 'inspect', worker.name])).code !== 0, 'OWN_WORKER_NAME_ALREADY_EXISTS')
    resources.add(worker.name)
    must(await docker([...worker.args.slice(0, -2), '--label', `${OWNERSHIP_LABEL}=${runId}`, ...worker.args.slice(-2)], { env: {
      ...childEnvironment, AI_WORKER_ENABLED: 'true', AI_WORKER_URL: `http://host.docker.internal:${port}/api/internal/ai-worker`, AI_WORKER_SECRET: workerSecret,
    } }), 'WORKER_CREATE_FAILED')
    workerName = worker.name
    await stopWorker()
    step('CLEAN_MIGRATED_DB_PRIVATE_FIXTURES_LOOPBACK_AND_STOPPED_PINNED_WORKER')

    // Full Chromium's new headless mode includes the native PDF viewer; the
    // separately distributed headless shell may not. Never install a browser.
    browser = await chromium.launch({ ...chatOAuthBrowserLaunchOptions(directory), channel: 'chromium' })
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true })
    const admin = await context.newPage(); activePage = admin
    admin.setDefaultTimeout(15_000)
    admin.on('pageerror', () => { report.uncaughtPageErrors = (report.uncaughtPageErrors ?? 0) + 1 })
    await admin.goto(`${baseUrl}/login`); await admin.waitForLoadState('networkidle')
    await admin.getByLabel('Login', { exact: true }).fill(username)
    await admin.getByLabel('Hasło', { exact: true }).fill(password)
    await admin.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
    await admin.waitForURL((url) => !url.pathname.includes('login')); await admin.waitForLoadState('networkidle')

    currentStep = 'SINGLE_UI_BATCH_SIX_FILES'
    await admin.goto(`${baseUrl}/finance/ksef`); await admin.waitForLoadState('networkidle')
    await admin.getByRole('button', { name: 'Dodaj faktury', exact: true }).click()
    await expect(admin.getByRole('heading', { name: 'Import faktur', exact: true })).toBeVisible()
    // One FileList and therefore exactly one UI-created InvoiceImportBatch.
    await admin.getByLabel('Dodaj faktury', { exact: true }).setInputFiles(fixtures.map((fixture) => fixture.path))
    const uploads = admin.getByRole('region', { name: 'Przesyłanie dokumentów', exact: true })
    await expect(uploads.getByText('Zapisany', { exact: true })).toHaveCount(4, { timeout: 45_000 })
    await expect(uploads.getByText('Duplikat — już zapisany', { exact: true })).toHaveCount(1)
    const malformedRow = uploads.getByRole('listitem').filter({ hasText: fixtures.find((fixture) => fixture.key === 'malformed').name })
    await expect(malformedRow.getByText('Błąd', { exact: true })).toBeVisible()
    await expect(admin.getByLabel('Dodaj faktury', { exact: true })).toBeEnabled()
    const queuedDrafts = await db.invoiceImportDraft.findMany({ include: { attachment: true, latestAiJob: true } })
    check(queuedDrafts.length === 4 && await db.invoiceImportBatch.count() === 1
      && await db.invoiceAttachment.count() === 4 && await db.aiJob.count() === 4
      && await db.ksefInvoice.count() === 0 && await db.costEvent.count() === 0, 'INITIAL_BATCH_COUNTS_INVALID')
    const byKey = new Map()
    for (const fixture of fixtures.filter((entry) => !['duplicate', 'malformed'].includes(entry.key))) {
      const matches = queuedDrafts.filter((draft) => draft.attachment.sha256 === fixture.sha256)
      check(matches.length === 1, 'UNIQUE_ORIGINAL_BINDING_INVALID')
      const draft = matches[0]
      check(draft.state === 'OPEN' && draft.invoiceId === null && draft.attachment.originalName === fixture.name
        && draft.attachment.state === 'READY' && draft.attachment.mimeType === fixture.mimeType
        && draft.attachment.byteSize === fixture.byteSize && draft.attachment.pageCount === fixture.pageCount
        && draft.latestAiJob?.kind === 'INVOICE_EXTRACT' && draft.latestAiJob.status === 'QUEUED'
        && draft.latestAiJob.attempts === 0, 'QUEUED_FIXTURE_METADATA_INVALID')
      const stored = path.join(originalsDirectory, draft.attachment.storageKey)
      const info = await stat(stored)
      check(info.isFile() && (info.mode & 0o777) === 0o600 && sha256(await readFile(stored)) === fixture.sha256,
        'PRIVATE_ORIGINAL_BYTES_OR_MODE_INVALID')
      byKey.set(fixture.key, { fixture, draftId: draft.id, jobId: draft.latestAiJob.id, attachmentId: draft.attachmentId, stored })
    }
    check(new Set(queuedDrafts.map((draft) => draft.batchId)).size === 1, 'UI_CREATED_MULTIPLE_BATCHES')
    const allowedIds = [...byKey.values()].map((entry) => entry.jobId)
    check(assessInvoiceBatchBudget(await readJobs(), allowedIds).claims === 0, 'UNEXPECTED_CLAIM_BEFORE_START')
    for (const sql of invoiceBatchClaimGuards(allowedIds)) await db.$executeRawUnsafe(sql)
    report.batch = { batchId: queuedDrafts[0].batchId, files: 6, accepted: 4, duplicates: 1, rejected: 1,
      draftIds: queuedDrafts.map((draft) => draft.id), jobIds: allowedIds, claimFenceInstalledBeforeStart: true }
    syntheticUiSafe = true
    await screenshot(admin, 'six-files-four-accepted-one-duplicate-one-malformed')
    step('ONE_UI_BATCH_FOUR_UNIQUE_ORIGINALS_FOUR_ZERO_ATTEMPT_JOBS_NO_MONEY')

    // Prove native PDF-viewer support before consuming any real model claim.
    // The document number does not exist in the sidebar until OCR completes.
    currentStep = 'NATIVE_PDF_PREVIEW_PREFLIGHT_BEFORE_OAUTH'
    await admin.getByRole('complementary', { name: 'Dokumenty importu', exact: true })
      .getByRole('button').filter({ hasText: byKey.get('eur').fixture.name }).click()
    await verifyPreviewAndDownload('eur', 'before-ai-preflight')
    check(assessInvoiceBatchBudget(await readJobs(), allowedIds).claims === 0 && workerStopped,
      'PDF_PREFLIGHT_CONSUMED_MODEL_CLAIM')
    step('TWO_PAGE_PDF_METADATA_NATIVE_PLUGIN_AND_BLOB_DOWNLOAD_SHA_VERIFIED_BEFORE_ANY_MODEL_CLAIM')

    currentStep = 'FOUR_REAL_OAUTH_EXTRACTIONS'
    const overallDeadline = Date.now() + JOB_DEADLINE_MS * 4
    await startWorker()
    let completedJobs, runningJobId = null, runningDeadline = overallDeadline
    while (Date.now() < overallDeadline) {
      assertNotAborted(); check(!workerFailure && alive(workerAttach), workerFailure ?? 'WORKER_EXITED')
      const jobs = await readJobs()
      const budget = assessInvoiceBatchBudget(jobs, allowedIds)
      check(budget.passed, budget.code)
      report.observedModelClaims = budget.claims
      const running = jobs.find((job) => job.status === 'RUNNING')
      if (running && running.id !== runningJobId) { runningJobId = running.id; runningDeadline = Date.now() + JOB_DEADLINE_MS }
      check(!running || Date.now() < runningDeadline, 'SINGLE_JOB_DEADLINE_REACHED')
      if (budget.complete) { completedJobs = jobs; break }
      await delay(150, undefined, { signal })
    }
    check(completedJobs, 'BATCH_JOB_DEADLINE_REACHED')
    // Positive Running=false evidence before result interpretation or finance UI.
    await stopWorker(); check(workerStopped, 'WORKER_STOP_UNVERIFIED')
    report.extractions = []
    for (const [key, entry] of byKey) {
      const job = completedJobs.find((candidate) => candidate.id === entry.jobId)
      let result
      try { result = JSON.parse(job.resultJson ?? 'null') } catch { result = null }
      const evidence = assessInvoiceBatchEvidence(key, result, resultSchema)
      check(evidence.passed, evidence.code)
      const draft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: entry.draftId } })
      check(draft.state === 'OPEN' && draft.invoiceId === null
        && isDeepStrictEqual(JSON.parse(draft.dataJson), evidence.checked), 'AI_FACTS_NOT_APPLIED_TO_OPEN_DRAFT')
      report.extractions.push({ key, jobId: job.id, attempts: job.attempts, resultSha256: sha256(job.resultJson),
        checked: evidence.checked, warningCount: result.warnings.length })
    }
    check(await db.ksefInvoice.count() === 0 && await db.costEvent.count() === 0, 'EXTRACTION_CREATED_MONEY')
    step('FOUR_SCHEMA_VALID_REAL_RESULTS_EXACT_FACTS_AND_POSITIVE_WORKER_STOP')

    async function selectFixture(key, state = 'OPEN') {
      check(workerStopped, 'FINANCIAL_UI_REQUIRES_STOPPED_WORKER')
      const { fixture } = byKey.get(key)
      const match = fixture.expected?.invoiceNumber ?? fixture.name
      const sidebar = admin.getByRole('complementary', { name: 'Dokumenty importu', exact: true })
      await sidebar.getByRole('button').filter({ hasText: match }).click()
      await expect(admin.getByRole('region', { name: 'Oryginał faktury', exact: true }).getByText(fixture.name, { exact: true })).toBeVisible()
      await expect(admin.getByRole('button', { name: state === 'ARCHIVED' ? 'Przywróć szkic' : 'Zapisz szkic', exact: true })).toBeEnabled()
    }
    async function assertEditorFacts(facts) {
      for (const [label, value] of [
        ['Numer dokumentu', facts.invoiceNumber], ['Nazwa dostawcy', facts.supplierName],
        ['NIP / identyfikator podatkowy', facts.taxId], ['Waluta', facts.currency],
        ['Data wystawienia', facts.issueDate], ['Termin płatności', facts.dueDate], ['Kwota brutto', String(facts.gross)],
      ]) await expect(admin.getByLabel(label, { exact: true })).toHaveValue(value, { timeout: 15_000 })
      await expect(admin.getByLabel('Rodzaj dokumentu', { exact: true })).toContainText('Faktura')
      await expect(admin.getByLabel('Status płatności', { exact: true })).toContainText('Niezapłacona')
      const details = admin.locator('details').filter({ has: admin.getByLabel('Kwota netto', { exact: true }) })
      if (!await details.evaluate((element) => element.open)) await details.locator('summary').click()
      await expect(admin.getByLabel('Kwota netto', { exact: true })).toHaveValue(String(facts.net))
      await expect(admin.getByLabel('Kwota VAT', { exact: true })).toHaveValue(String(facts.vat))
      await expect(admin.getByLabel('Rachunek bankowy', { exact: true })).toHaveValue('')
    }
    async function verifyPreviewAndDownload(key, stage) {
      const { fixture } = byKey.get(key)
      const preview = admin.getByRole('region', { name: 'Oryginał faktury', exact: true })
      const media = fixture.mimeType === 'application/pdf'
        ? preview.getByTitle(`Oryginał: ${fixture.name}`, { exact: true })
        : preview.getByRole('img', { name: fixture.name, exact: true })
      await expect(media).toBeVisible()
      await expect(media).toHaveAttribute('src', /^blob:/)
      const url = await media.getAttribute('src')
      const actualHash = await admin.evaluate(async (blobUrl) => {
        const bytes = await fetch(blobUrl).then((response) => response.arrayBuffer())
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
          .map((value) => value.toString(16).padStart(2, '0')).join('')
      }, url)
      check(actualHash === fixture.sha256, 'VISIBLE_PREVIEW_BLOB_HASH_MISMATCH')
      if (fixture.mimeType === 'application/pdf') {
        await expect(preview).toContainText('2 str.')
        // Chromium places its native plugin in a nested out-of-process frame,
        // not the outer iframe document. Match the observed plugin MIME type
        // and original-url so a stale PDF frame cannot satisfy this check.
        const plugin = await waitFor(async () => {
          for (const frame of admin.frames()) {
            if (frame.url() !== url) continue
            const candidate = frame.locator('embed[type="application/x-google-chrome-pdf"]')
            try {
              if (await candidate.count() !== 1) continue
              const metadata = await candidate.evaluate((element) => ({
                type: element.getAttribute('type'), originalUrl: element.getAttribute('original-url'),
              }))
              if (invoiceBatchPdfPluginMatches(metadata, url)) return candidate
            } catch { /* A PDF frame can detach while the selected blob changes. */ }
          }
          return null
        }, 'NATIVE_PDF_PLUGIN_NOT_ATTACHED', 15_000)
        await expect(plugin).toBeVisible()
      } else {
        await expect(media).toHaveJSProperty('complete', true)
        check(await media.evaluate((image) => image.naturalWidth > 0), 'PNG_PREVIEW_NOT_RENDERED')
      }
      await screenshot(admin, `${key}-original-preview-${stage}`)
      const pending = retainHandledRejection(admin.waitForEvent('download'))
      await preview.getByRole('link', { name: 'Pobierz oryginał', exact: true }).click()
      const download = await pending
      const source = await download.path(); check(source, 'DOWNLOAD_PATH_UNAVAILABLE')
      const bytes = await readFile(source)
      check(bytes.length === fixture.byteSize && sha256(bytes) === fixture.sha256, 'BROWSER_DOWNLOAD_BYTES_MISMATCH')
      const retained = path.join(artifactDirectory, `${key}-${stage}${fixture.mimeType === 'application/pdf' ? '.pdf' : '.png'}`)
      await writeFile(retained, bytes, { flag: 'wx', mode: 0o600 }); await chmod(retained, 0o600)
      report.downloads.push({ key, stage, path: retained, byteSize: bytes.length, sha256: fixture.sha256 })
    }
    async function classifyAndSave(key) {
      const { draftId } = byKey.get(key)
      await admin.getByLabel('Miejsce kosztu', { exact: true }).click()
      await admin.getByRole('menuitemradio', { name: 'JAG', exact: true }).click()
      await admin.getByRole('button', { name: 'Stały', exact: true }).click()
      await admin.getByRole('button', { name: 'Zapisz szkic', exact: true }).click()
      await waitFor(async () => {
        const draft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draftId } })
        const data = JSON.parse(draft.dataJson)
        return data.costCenterId === 'JAG' && data.tagIds?.length === 1 && data.tagIds[0] === fixedTag.id
      }, 'UI_CLASSIFICATION_SAVE_NOT_DURABLE')
    }
    async function expectApprovalBlocked(key, requiredIssueCodes) {
      const { draftId } = byKey.get(key)
      const before = await readMoney()
      const pending = retainHandledRejection(admin.waitForResponse((response) => response.url() === `${baseUrl}/api/finance/invoice-import/drafts/${draftId}/approve`
        && response.request().method() === 'POST'))
      await admin.getByRole('button', { name: 'Zatwierdź i następna', exact: true }).click()
      const response = await pending
      check(response.status() === 422, 'UNSUPPORTED_OR_FX_INVOICE_NOT_BLOCKED')
      const body = await response.json()
      check(body.code === 'APPROVAL_VALIDATION_FAILED' && Array.isArray(body.issues)
        && requiredIssueCodes.every((code) => body.issues.some((issue) => issue.code === code)), 'EXPECTED_APPROVAL_ISSUES_MISSING')
      await expect(admin.getByText('Sprawdź dane wskazane przez system', { exact: true })).toBeVisible()
      check(isDeepStrictEqual(await readMoney(), before), 'REJECTED_APPROVAL_CHANGED_MONEY')
      const draft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draftId } })
      check(draft.state === 'OPEN' && draft.invoiceId === null, 'REJECTED_APPROVAL_CHANGED_STATE')
      report.passed.push(`${key.toUpperCase()}_APPROVAL_REJECTED_WITH_ZERO_MONEY_CHANGE`)
      await screenshot(admin, `${key}-approval-block-visible`)
    }
    async function approve(key, reportingGross) {
      check(workerStopped, 'FINANCIAL_UI_REQUIRES_STOPPED_WORKER')
      const { draftId } = byKey.get(key)
      await admin.getByRole('button', { name: 'Zatwierdź i następna', exact: true }).click()
      return waitFor(async () => {
        const draft = await db.invoiceImportDraft.findUnique({ where: { id: draftId }, include: {
          audits: true, invoice: { include: { costEvent: { include: { parts: { include: { tags: true, allocations: true } } } } } },
        } })
        if (draft?.state !== 'APPROVED') return null
        check(draft.invoice?.source === 'MANUAL' && draft.invoice.status === 'APPROVED'
          && draft.invoice.reportingGrossAmount === reportingGross
          && draft.invoice.costEvent?.status === 'APPROVED' && draft.invoice.costEvent.source === 'MANUAL'
          && draft.invoice.costEvent.documentStatus === 'ACTIVE' && draft.invoice.costEvent.currency === 'PLN'
          && draft.invoice.costEvent.grossAmount === reportingGross
          && draft.invoice.costEvent.parts.length === 1
          && draft.invoice.costEvent.parts[0].allocations.length === 1
          && draft.invoice.costEvent.parts[0].allocations[0].costCenterId === 'JAG'
          && draft.invoice.costEvent.parts[0].allocations[0].percent === 100
          && draft.invoice.costEvent.parts[0].tags.length === 1
          && draft.invoice.costEvent.parts[0].tags[0].tagId === fixedTag.id, 'APPROVED_COST_RELATIONS_INVALID')
        check(['CREATED', 'AI_RESULT_APPLIED', 'EDITED', 'APPROVED'].every((action) => draft.audits.some((audit) => audit.action === action)),
          'APPROVAL_HISTORY_MISSING')
        return draft
      }, 'UI_APPROVAL_NOT_DURABLE')
    }
    async function verifyNonFinancialActions(key) {
      check(['blank', 'correction'].includes(key) && workerStopped, 'NON_FINANCIAL_ACTION_TARGET_INVALID')
      const { draftId, attachmentId, fixture, stored } = byKey.get(key)
      const beforeMoney = await readMoney()
      const beforeJobs = await readJobs()
      const readDraft = () => db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draftId }, include: { audits: true } })
      const original = await readDraft()
      await admin.getByLabel('Stan dokumentów', { exact: true }).selectOption('ALL')
      await selectFixture(key)
      await admin.getByRole('button', { name: 'Pomiń na teraz', exact: true }).click()
      await waitFor(async () => {
        const draft = await readDraft()
        return draft.state === 'OPEN' && draft.skippedAt !== null && draft.audits.some((audit) => audit.action === 'SKIPPED')
      }, 'UI_SKIP_NOT_DURABLE')
      await selectFixture(key)
      await admin.getByRole('button', { name: 'Archiwizuj szkic', exact: true }).click()
      await waitFor(async () => {
        const draft = await readDraft()
        return draft.state === 'ARCHIVED' && draft.invoiceId === null && draft.audits.some((audit) => audit.action === 'ARCHIVED')
      }, 'UI_ARCHIVE_NOT_DURABLE')
      await selectFixture(key, 'ARCHIVED')
      await expect(admin.getByText('Dokument pozostaje w archiwum i nie wpływa na aktywne koszty.', { exact: true })).toBeVisible()
      await screenshot(admin, `${key}-archived-without-active-cost`)
      await admin.getByRole('button', { name: 'Przywróć szkic', exact: true }).click()
      const restored = await waitFor(async () => {
        const draft = await readDraft()
        return draft.state === 'OPEN' && draft.audits.some((audit) => audit.action === 'RESTORED') ? draft : null
      }, 'UI_RESTORE_NOT_DURABLE')
      check(restored.invoiceId === null && restored.attachmentId === attachmentId
        && restored.dataJson === original.dataJson && restored.version === original.version + 3
        && ['SKIPPED', 'ARCHIVED', 'RESTORED'].every((action) => restored.audits.filter((audit) => audit.action === action).length === 1),
      'NON_FINANCIAL_ACTION_CHANGED_FACTS_OR_HISTORY')
      check(isDeepStrictEqual(await readMoney(), beforeMoney) && isDeepStrictEqual(await readJobs(), beforeJobs)
        && assessInvoiceBatchBudget(await readJobs(), allowedIds).complete
        && sha256(await readFile(stored)) === fixture.sha256, 'NON_FINANCIAL_ACTION_CHANGED_MONEY_OR_MODEL_CLAIMS')
      await selectFixture(key)
      step(`${key.toUpperCase()}_UI_SKIP_ARCHIVE_RESTORE_PRESERVED_ORIGINAL_FACTS_MONEY_AND_FOUR_CLAIMS`)
    }

    currentStep = 'VALID_ORIGINAL_PREVIEWS_AND_UNSUPPORTED_BLOCKS'
    for (const key of ['pln', 'eur']) {
      await selectFixture(key); await assertEditorFacts(byKey.get(key).fixture.expected)
      await verifyPreviewAndDownload(key, 'before-approval')
    }
    await selectFixture('blank'); await expectApprovalBlocked('blank', ['SUPPLIER_NAME_REQUIRED', 'GROSS_REQUIRED'])
    await selectFixture('correction'); await expectApprovalBlocked('correction', ['CORRECTION_UNSUPPORTED', 'NEGATIVE_AMOUNT'])
    step('PNG_RENDERED_PDF_PLUGIN_ATTACHED_DOWNLOAD_BYTES_VALID_BLANK_AND_CORRECTION_BLOCKED')

    currentStep = 'NON_FINANCIAL_UI_SKIP_ARCHIVE_RESTORE'
    for (const key of ['blank', 'correction']) await verifyNonFinancialActions(key)

    currentStep = 'UI_CLASSIFY_PLN_AND_EXPLICIT_EUR_CONVERSION'
    await selectFixture('pln'); await classifyAndSave('pln')
    const approvedPln = await approve('pln', 123)
    await selectFixture('eur'); await classifyAndSave('eur')
    await expectApprovalBlocked('eur', ['REPORTING_GROSS_REQUIRED', 'CONVERSION_NOTE_REQUIRED', 'FX_CONFIRMATION_REQUIRED'])
    await expect(admin.getByLabel('Brutto w PLN', { exact: true })).toHaveValue('')
    await expect(admin.getByRole('checkbox', { name: 'Potwierdzam przeliczenie na PLN i jego opisaną podstawę', exact: true })).not.toBeChecked()
    await admin.getByLabel('Brutto w PLN', { exact: true }).fill('430')
    const conversionNote = 'SYNTHETIC: ręczne przeliczenie 100 EUR na 430 PLN na potrzeby testu; bez kursu pobieranego automatycznie.'
    await admin.getByLabel('Podstawa i uwaga do przeliczenia', { exact: true }).fill(conversionNote)
    await admin.getByRole('checkbox', { name: 'Potwierdzam przeliczenie na PLN i jego opisaną podstawę', exact: true }).check()
    await admin.getByRole('button', { name: 'Zapisz szkic', exact: true }).click()
    await waitFor(async () => {
      const draft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: byKey.get('eur').draftId } })
      const data = JSON.parse(draft.dataJson)
      return data.currency === 'EUR' && data.gross === 100 && data.taxId === 'DE123456789'
        && data.reportingGross === 430 && data.conversionNote === conversionNote && data.conversionConfirmed === true
    }, 'MANUAL_EUR_CONVERSION_NOT_DURABLE')
    await expect(admin.getByLabel('Brutto w PLN', { exact: true })).toHaveValue('430')
    await expect(admin.getByRole('checkbox', { name: 'Potwierdzam przeliczenie na PLN i jego opisaną podstawę', exact: true })).toBeChecked()
    await screenshot(admin, 'eur-manual-430-pln-note-and-confirmation-before-approval')
    const approvedEur = await approve('eur', 430)
    check(approvedEur.invoice.currency === 'EUR' && approvedEur.invoice.grossAmount === 100
      && approvedEur.invoice.supplierNip === 'DE123456789' && approvedEur.invoice.originalGrossAmount === 100
      && approvedEur.invoice.currencyConversionNote === conversionNote, 'EUR_NOMINAL_OR_MANUAL_CONVERSION_LOST')
    step('ONLY_TWO_VALID_INVOICES_CLASSIFIED_AND_APPROVED_123_PLUS_430_PLN')

    async function assertFinalMoney() {
      const [invoices, costs] = await readMoney()
      const active = costs.filter((cost) => cost.status === 'APPROVED' && cost.documentStatus === 'ACTIVE')
      check(invoices.length === 2 && costs.length === 2 && active.length === 2
        && active.every((cost) => cost.currency === 'PLN' && cost.source === 'MANUAL')
        && active.reduce((sum, cost) => sum + Math.round(cost.grossAmount * 100), 0) === 55_300,
      'FINAL_TWO_COSTS_553_PLN_REQUIRED')
      for (const key of ['blank', 'correction']) {
        const draft = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: byKey.get(key).draftId } })
        check(['OPEN', 'ARCHIVED'].includes(draft.state) && draft.invoiceId === null, 'UNSUPPORTED_DOCUMENT_IN_ACTIVE_COSTS')
      }
      check(await db.invoiceImportBatch.count() === 1 && await db.invoiceAttachment.count() === 4
        && await db.invoiceImportDraft.count() === 4 && await db.invoiceKsefReconciliation.count() === 0,
      'FINAL_BATCH_OR_ORIGINAL_COUNT_INVALID')
      const budget = assessInvoiceBatchBudget(await readJobs(), allowedIds)
      check(budget.passed && budget.complete && budget.claims === 4, 'FINAL_CLAIM_BUDGET_INVALID')
    }
    await assertFinalMoney()
    await admin.goto(`${baseUrl}/dashboard?year=2026&month=9`); await admin.waitForLoadState('networkidle')
    await expect(admin.getByRole('link', { name: /Koszty rozpoznane/ }).locator('xpath=..').locator('strong'))
      .toHaveText(/^\s*553(?:[,.]00)?\s*zł\s*$/)
    await screenshot(admin, 'dashboard-september-553-pln')
    await admin.goto(`${baseUrl}/finance/cost-events`); await admin.waitForLoadState('networkidle')
    for (const [key, gross] of [['pln', 123], ['eur', 430]]) {
      const row = admin.getByRole('row').filter({ hasText: byKey.get(key).fixture.expected.invoiceNumber })
      await expect(row).toHaveCount(1); await expect(row).toContainText('JAG 100%')
      await expect(row.getByRole('cell', { name: `${gross} PLN`, exact: true })).toHaveCount(1)
    }
    await screenshot(admin, 'ledger-two-active-costs-jag')
    step('DASHBOARD_AND_LEDGER_VISIBLE_TWO_ACTIVE_COSTS_553_PLN')

    currentStep = 'RESTART_DURABILITY_WITH_IDLE_WORKER'
    const beforeRestart = await durable()
    await stopServer(); await startServer()
    check(assessInvoiceBatchBudget(await readJobs(), allowedIds).complete, 'IDLE_RESTART_REQUIRES_NO_PENDING_JOBS')
    await startWorker(); await delay(1_000, undefined, { signal })
    check(alive(workerAttach) && !workerFailure, workerFailure ?? 'IDLE_WORKER_EXITED')
    await stopWorker()
    check(isDeepStrictEqual(await durable(), beforeRestart), 'RESTART_CHANGED_IDS_HISTORY_FACTS_OR_CLAIMS')
    await admin.goto(`${baseUrl}/finance/ksef`); await admin.waitForLoadState('networkidle')
    await admin.getByRole('button', { name: 'Dodaj faktury', exact: true }).click()
    await admin.getByLabel('Stan dokumentów', { exact: true }).selectOption('ALL')
    for (const key of ['pln', 'eur']) {
      const { fixture } = byKey.get(key)
      const sidebar = admin.getByRole('complementary', { name: 'Dokumenty importu', exact: true })
      await sidebar.getByRole('button').filter({ hasText: fixture.expected.invoiceNumber }).click()
      await assertEditorFacts(fixture.expected)
      await verifyPreviewAndDownload(key, 'after-restart')
      await admin.getByRole('button', { name: 'Historia dokumentu', exact: true }).click()
      for (const label of ['Dodano dokument', 'Zastosowano wynik odczytu', 'Zapisano poprawki', 'Zatwierdzono w kosztach']) {
        await expect(admin.getByText(label, { exact: true }).first()).toBeVisible()
      }
      await screenshot(admin, `${key}-history-after-restart`)
    }
    for (const { fixture, stored } of byKey.values()) {
      check((await stat(stored)).isFile() && sha256(await readFile(stored)) === fixture.sha256, 'RESTART_LOST_PRIVATE_ORIGINAL')
    }
    await assertFinalMoney()
    check(isDeepStrictEqual(await durable(), beforeRestart), 'RESTART_UI_READS_CHANGED_DURABLE_HISTORY')
    check(!report.uncaughtPageErrors, 'UNCAUGHT_PAGE_ERRORS')
    const integrity = must(await command('/usr/bin/sqlite3', [databasePath, 'PRAGMA integrity_check; PRAGMA foreign_key_check;']), 'SQLITE_INTEGRITY_COMMAND_FAILED')
    check(integrity === 'ok', 'SQLITE_INTEGRITY_OR_FOREIGN_KEYS_FAILED')
    await chmod(databasePath, 0o600)
    report.final = { batchCount: 1, attachmentCount: 4, draftCount: 4, jobCount: 4, modelClaims: 4,
      invoiceIds: [approvedPln.invoiceId, approvedEur.invoiceId], activeCostCount: 2, recognizedGrossPLN: 553,
      blankAndCorrectionState: 'OPEN', originalDownloadsVerified: report.downloads.length, integrity: 'ok', foreignKeyViolations: 0 }
    step('SERVER_AND_IDLE_WORKER_RESTART_PRESERVED_IDS_HISTORY_FOUR_ORIGINALS_AND_FOUR_CLAIMS')
    report.status = 'PASS'
  } catch (error) {
    let stopVerified = false
    try {
      if (interruptStopPromise) await interruptStopPromise
      // The signal handler's earlier snapshot may predate an in-flight start.
      // Always obtain fresh stopped evidence after startWorker has settled.
      await stopWorker({ cleanup: true })
      stopVerified = true
    } catch { /* No UI or evidence capture unless inference is positively stopped. */ }
    report.status = 'FAIL'; report.failedStep = currentStep
    const triggerCode = signal.aborted ? 'INTERRUPTED' : error instanceof GateError ? error.code : 'GATE_CHECK_FAILED'
    report.code = stopVerified ? triggerCode : 'WORKER_STOP_UNVERIFIED'
    if (!stopVerified) report.triggerCode = triggerCode
    if (stopVerified && syntheticUiSafe && activePage && !activePage.isClosed()) {
      try { await screenshot(activePage, `failure-${currentStep.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`) }
      catch { /* Private screenshot is supplementary evidence. */ }
    }
  } finally {
    await cleanup()
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal)
    if (Object.entries(report.cleanup).some(([key, value]) => value === false && key !== 'oauthVolumeRemoved')) {
      report.status = 'FAIL'; report.cleanupCode = 'CLEANUP_FAILED'
    }
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 }); await chmod(artifactDirectory, 0o700)
    const reportPath = path.join(artifactDirectory, 'report.json')
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); await chmod(reportPath, 0o600)
    process.stdout.write(`${JSON.stringify({ status: report.status, code: report.code ?? report.cleanupCode ?? null, report: reportPath })}\n`)
    process.exitCode = report.status === 'PASS' ? 0 : 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'GATE_START_FAILED'
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code })}\n`)
    process.exitCode = 1
  })
}
