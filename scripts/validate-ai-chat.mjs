import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { chromium, expect } from '@playwright/test'
import { PrismaClient } from '../src/generated/prisma/index.js'

// Only the model response is a fixture: public UI, authentication, HTTP handlers,
// worker protocol, queue, and SQLite all run unchanged. No OAuth or deployment.
// Run a copy of the build from a disposable cwd, so Next/Prisma never load repo
// .env and framework cache writes cannot touch the repository build.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = mkdtempSync(path.join(tmpdir(), 'wd-ai-browser-'))
const artifactDirectory = path.join(repository, 'test-results', `ai-chat-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const databasePath = path.join(directory, 'browser.sqlite')
const databaseUrl = `file:${databasePath}`
const port = 3126
const baseUrl = `http://127.0.0.1:${port}`
const password = 'AI-Browser-Fixture-Only!'
const workerSecret = 'synthetic-browser-worker-key-not-for-production'
const workerId = 'synthetic-browser-worker'
const environment = {
  PATH: process.env.PATH,
  NODE_ENV: 'production',
  DATABASE_URL: databaseUrl,
  NEXTAUTH_URL: baseUrl,
  NEXTAUTH_SECRET: 'synthetic-ai-browser-nextauth-secret',
  AI_WORKER_SECRET: workerSecret,
  NEXT_TELEMETRY_DISABLED: '1',
}
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const report = {
  status: 'RUNNING', baseUrl, directory, databasePath, artifactDirectory,
  scope: 'Synthetic SQLite and users; real local Next UI/API; only model answers are stubbed through worker HTTP; no OAuth, production, or deploy.',
  restartBoundary: 'All pages are closed before restarting Next; authenticated browser-context API requests verify SQLite job/result durability only. This does not test an active chat surviving an outage, nor a Codex/OAuth worker restart.',
  passed: [], failures: [], pageErrors: [], screenshots: [], workerActions: [], jobs: {},
}
let server
let browser
let serverOutput = ''
let fatalError

function step(message) { report.passed.push(message); console.log(`PASS: ${message}`) }
function issue(message) { report.failures.push(message); console.error(`FAIL: ${message}`) }
function saveReport() {
  mkdirSync(artifactDirectory, { recursive: true })
  writeFileSync(path.join(artifactDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(path.join(artifactDirectory, 'server.log'), serverOutput)
}
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function start() {
  const probe = createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
  let startupOutput = ''
  server = spawn(process.execPath, [path.join(repository, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (data) => { serverOutput += data.toString(); startupOutput += data.toString() })
  server.stderr.on('data', (data) => { serverOutput += data.toString() })
  let spawnError
  server.once('error', (error) => { spawnError = error })
  for (let attempt = 0; attempt < 200; attempt++) {
    if (spawnError) throw spawnError
    if (server.exitCode !== null) throw new Error(`Local Next exited: ${serverOutput}`)
    // A stale service on the same port must never count as our child being ready.
    if (startupOutput.includes('Ready in') && await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) }).then((response) => response.ok).catch(() => false)) return
    await delay(100)
  }
  throw new Error('Local Next did not become ready within 20 seconds')
}

async function stop() {
  if (!server || server.exitCode !== null) return
  const exited = once(server, 'exit')
  server.kill('SIGTERM')
  const timeout = setTimeout(() => server?.kill('SIGKILL'), 5000)
  try { await exited } finally { clearTimeout(timeout) }
}

async function login(username) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => report.pageErrors.push({ username, message: error.message }))
  await page.goto(`${baseUrl}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Login', { exact: true }).fill(username)
  await page.getByLabel('Hasło', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.includes('login'))
  await page.waitForLoadState('networkidle')
  return page
}

async function json(response, expectedStatus) {
  const body = await response.json()
  expect(response.status(), JSON.stringify(body)).toBe(expectedStatus)
  return body
}

async function readJob(page, jobId) {
  const response = await page.request.get(`${baseUrl}/api/ai/jobs/${jobId}`)
  const body = await json(response, 200)
  expect(response.headers()['cache-control']).toBe('private, no-store')
  expect(body.job).not.toHaveProperty('payloadJson')
  expect(body.job).not.toHaveProperty('leaseToken')
  return body.job
}

async function worker(action, details = {}) {
  const response = await fetch(`${baseUrl}/api/internal/ai-worker`, {
    method: 'POST', headers: { Authorization: `Bearer ${workerSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, workerId, ...details }), signal: AbortSignal.timeout(10_000),
  })
  const body = await response.json()
  report.workerActions.push({ action, jobId: details.jobId ?? body.job?.id ?? null, status: response.status })
  expect(response.status, JSON.stringify(body)).toBe(200)
  return body
}

async function claim(page, job) {
  const body = await worker('claim')
  expect(body.job).toMatchObject({ id: job.id, kind: job.kind })
  expect(body.job.schema).toMatchObject({ type: 'object', additionalProperties: false })
  const running = await readJob(page, job.id)
  expect(running.status).toBe('RUNNING')
  await worker('heartbeat', { jobId: job.id, leaseToken: body.job.leaseToken })
  return body.job
}

async function finish(claimed, outcome) {
  await worker('finish', { jobId: claimed.id, leaseToken: claimed.leaseToken, outcome })
}

async function sendQuestion(page, kind, question) {
  const endpoint = kind === 'FINANCE_CHAT' ? '/api/ai/chat' : '/api/knowledge/ai'
  const input = page.getByPlaceholder(kind === 'FINANCE_CHAT' ? 'Zadaj pytanie o finanse...' : 'Zadaj pytanie o ten artykuł...')
  await input.fill(question)
  const posted = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === 'POST')
  await input.press('Enter')
  const body = await json(await posted, 202)
  expect(body.job).toMatchObject({ kind, status: 'QUEUED', result: null, attempts: 0 })
  await expect(page.getByRole('status').filter({ hasText: 'W kolejce' })).toBeVisible()
  expect(await db.aiJob.count({ where: { id: body.job.id } })).toBe(1)
  return body.job
}

async function snap(page, name, closeButton) {
  const screenshot = path.join(artifactDirectory, `${name}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })
  // A left-clipped fixed panel can leave scrollWidth unchanged, so check both.
  const panel = page.getByRole('button', { name: closeButton, exact: true }).locator('xpath=ancestor::div[contains(@class,"fixed")]')
  const box = await panel.boundingBox()
  const viewport = page.viewportSize()
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const contained = !!box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1
  report.screenshots.push({ name, path: screenshot, viewport, panel: box, scrollWidth, contained })
  if (!contained) issue(`${name}: chat panel outside viewport: ${JSON.stringify({ box, viewport })}`)
  if (scrollWidth > viewport.width) issue(`${name}: horizontal page overflow ${scrollWidth} > ${viewport.width}`)
}

try {
  mkdirSync(artifactDirectory, { recursive: true })
  for (const name of ['node_modules', 'public']) symlinkSync(path.join(repository, name), path.join(directory, name), 'dir')
  const buildDirectory = path.join(repository, '.next')
  cpSync(buildDirectory, path.join(directory, '.next'), { recursive: true, filter(source) {
    const firstSegment = path.relative(buildDirectory, source).split(path.sep)[0]
    return firstSegment !== 'cache' && firstSegment !== 'standalone'
  } })
  mkdirSync(path.join(directory, 'prisma'))
  cpSync(path.join(repository, 'prisma/schema.prisma'), path.join(directory, 'prisma/schema.prisma'))
  cpSync(path.join(repository, 'prisma/migrations'), path.join(directory, 'prisma/migrations'), { recursive: true })
  execFileSync('sqlite3', [databasePath, 'VACUUM;'])
  execFileSync(process.execPath, [path.join(repository, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(directory, 'prisma/schema.prisma')], { cwd: directory, env: environment, stdio: 'pipe' })
  const hash = await bcrypt.hash(password, 10)
  for (const [username, role] of [['aiadmin', 'ADMIN'], ['aiotheradmin', 'ADMIN'], ['aimanager', 'MANAGER'], ['aiemployee', 'EMPLOYEE']]) {
    await db.user.create({ data: { id: username, username, role, name: `Synthetic ${role}`, email: `${username}@example.test`, passwordHash: hash } })
  }
  for (const [id, name] of [['PUL', 'Puławska'], ['JAG', 'Jagiellońska'], ['GLOBAL', 'Koszty wspólne']]) await db.costCenter.create({ data: { id, name } })
  await db.revenue.create({ data: { year: 2026, month: 8, amount: 12_345, costCenterId: 'PUL', channel: 'SALON', asOfDate: '2026-08-31' } })
  await db.article.create({ data: {
    id: 'synthetic-ai-article', slug: 'syntetyczna-procedura-ai', title: 'Syntetyczna procedura przyjęcia dostawy',
    category: 'processes', visibility: 'public', type: 'procedure',
    content: '# Przyjęcie dostawy\n\nPolicz paczki. Sprawdź widoczne uszkodzenia. Zapisz numer dostawy w rejestrze.',
  } })
  await start()
  browser = await chromium.launch({ headless: true })
  const admin = await login('aiadmin')
  const manager = await login('aimanager')
  const employee = await login('aiemployee')
  const otherAdmin = await login('aiotheradmin')

  for (const endpoint of ['/api/ai/chat', '/api/knowledge/ai']) {
    expect((await fetch(`${baseUrl}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401)
  }
  for (const page of [manager, employee]) {
    expect((await page.request.post(`${baseUrl}/api/ai/chat`, { data: { question: 'Kontrola roli', year: 2026, month: 8 } })).status()).toBe(403)
    await expect(page.getByTitle('AI Analyst', { exact: true })).toHaveCount(0)
  }
  expect((await employee.request.post(`${baseUrl}/api/knowledge/ai`, { data: { question: 'Kontrola roli' } })).status()).toBe(403)
  expect((await fetch(`${baseUrl}/api/internal/ai-worker`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'claim', workerId }) })).status).toBe(401)
  step('Authentication and roles: anonymous 401; finance restricted to ADMIN; EMPLOYEE wiki API403; worker rejects absent key; non-admin finance controls absent.')

  await admin.goto(`${baseUrl}/dashboard?year=2026&month=8`)
  await admin.waitForLoadState('networkidle')
  await admin.getByTitle('AI Analyst', { exact: true }).click()
  await admin.getByLabel('Rok danych', { exact: true }).selectOption('2026')
  await admin.getByLabel('Miesiąc danych', { exact: true }).selectOption('8')
  const finance = await sendQuestion(admin, 'FINANCE_CHAT', 'Jaki jest rzeczywisty przychód w sierpniu 2026?')
  report.jobs.finance = finance.id
  await snap(admin, 'finance-queued-desktop', 'Zamknij czat finansowy')
  const financeClaim = await claim(admin, finance)
  expect(financeClaim.prompt).toContain('12345')
  expect(financeClaim.prompt).toContain('2026')
  await expect(admin.getByRole('status').filter({ hasText: 'Przygotowuję odpowiedź' })).toBeVisible({ timeout: 12_000 })
  const financeAnswer = 'Syntetyczny wynik: rzeczywisty przychód sierpnia 2026 wynosi 12 345 zł. Dane pochodzą z wybranego okresu.'
  await finish(financeClaim, { status: 'SUCCEEDED', result: { answer: financeAnswer } })
  await expect(admin.getByText(financeAnswer, { exact: true })).toBeVisible({ timeout: 12_000 })
  await expect(admin.getByPlaceholder('Zadaj pytanie o finanse...')).toBeEnabled()
  await snap(admin, 'finance-answer-desktop', 'Zamknij czat finansowy')
  await admin.setViewportSize({ width: 390, height: 844 })
  await snap(admin, 'finance-answer-mobile', 'Zamknij czat finansowy')
  await admin.setViewportSize({ width: 320, height: 568 })
  await snap(admin, 'finance-answer-mobile-small', 'Zamknij czat finansowy')
  await admin.setViewportSize({ width: 1440, height: 1000 })
  expect(await readJob(admin, finance.id)).toMatchObject({ status: 'SUCCEEDED', attempts: 1, result: { answer: financeAnswer } })
  expect((await otherAdmin.request.get(`${baseUrl}/api/ai/jobs/${finance.id}`)).status()).toBe(404)
  expect((await manager.request.get(`${baseUrl}/api/ai/jobs/${finance.id}`)).status()).toBe(404)
  step('Finance UI: selected real snapshot → QUEUED → RUNNING → visible answer; claim/heartbeat/finish and own GET; other owners404; desktop/mobile captured.')

  const articleUrl = `${baseUrl}/knowledge/syntetyczna-procedura-ai`
  await manager.goto(articleUrl)
  await manager.waitForLoadState('networkidle')
  await expect(manager.getByRole('heading', { name: 'Syntetyczna procedura przyjęcia dostawy', exact: true })).toBeVisible()
  await expect(manager.getByTitle('AI Analyst', { exact: true })).toHaveCount(0)
  await manager.getByTitle('AI Asystent wiedzy', { exact: true }).click()
  const wiki = await sendQuestion(manager, 'WIKI_CHAT', 'Jak przyjąć dostawę zgodnie z tym artykułem?')
  report.jobs.wiki = wiki.id
  await snap(manager, 'wiki-queued-desktop', 'Zamknij asystenta wiedzy')
  const wikiClaim = await claim(manager, wiki)
  expect(wikiClaim.prompt).toContain('Policz paczki')
  const wikiAnswer = 'Syntetyczna odpowiedź: policz paczki, sprawdź widoczne uszkodzenia i zapisz numer dostawy w rejestrze.'
  await finish(wikiClaim, { status: 'SUCCEEDED', result: { answer: wikiAnswer } })
  await expect(manager.getByText(wikiAnswer, { exact: true })).toBeVisible({ timeout: 12_000 })
  await snap(manager, 'wiki-answer-desktop', 'Zamknij asystenta wiedzy')
  await manager.setViewportSize({ width: 390, height: 844 })
  await snap(manager, 'wiki-answer-mobile', 'Zamknij asystenta wiedzy')
  await manager.setViewportSize({ width: 320, height: 568 })
  await snap(manager, 'wiki-answer-mobile-small', 'Zamknij asystenta wiedzy')
  await manager.setViewportSize({ width: 1440, height: 1000 })
  expect((await admin.request.get(`${baseUrl}/api/ai/jobs/${wiki.id}`)).status()).toBe(404)
  await employee.goto(articleUrl)
  await employee.waitForLoadState('networkidle')
  await expect(employee.getByTitle('AI Asystent wiedzy', { exact: true })).toHaveCount(0)
  step('Wiki UI: MANAGER article context → QUEUED → visible answer via worker HTTP; owner restriction; no assistant for EMPLOYEE; desktop/mobile captured.')

  const quota = await sendQuestion(manager, 'WIKI_CHAT', 'Czy mogę ponowić pytanie po odnowieniu limitu?')
  report.jobs.quota = quota.id
  const quotaClaim = await claim(manager, quota)
  const waiting = (await json(await admin.request.post(`${baseUrl}/api/ai/chat`, { data: {
    question: 'Czy kolejne zadanie poczeka podczas globalnego limitu?', year: 2026, month: 8,
  } }), 202)).job
  report.jobs.quotaWaiting = waiting.id
  expect(waiting).toMatchObject({ kind: 'FINANCE_CHAT', status: 'QUEUED', attempts: 0 })
  await finish(quotaClaim, { status: 'BLOCKED', errorCode: 'QUOTA' })
  await expect(manager.getByRole('alert').filter({ hasText: 'Osiągnięto limit AI' })).toBeVisible({ timeout: 12_000 })
  await expect(manager.getByRole('button', { name: 'Ponów zadanie', exact: true })).toBeVisible()
  await snap(manager, 'wiki-quota-desktop', 'Zamknij asystenta wiedzy')
  expect((await worker('claim')).job).toBeNull()
  expect(await readJob(admin, waiting.id)).toMatchObject({ status: 'QUEUED', blockedReason: 'QUOTA', attempts: 0 })
  expect((await admin.request.post(`${baseUrl}/api/ai/jobs/${quota.id}/retry`)).status()).toBe(404)
  expect((await otherAdmin.request.post(`${baseUrl}/api/ai/jobs/${quota.id}/retry`)).status()).toBe(404)
  expect(await readJob(manager, quota.id)).toMatchObject({ status: 'BLOCKED', errorCode: 'QUOTA', attempts: 1 })
  const beforeRetry = await db.aiJob.count()
  const retried = manager.waitForResponse((response) => new URL(response.url()).pathname === `/api/ai/jobs/${quota.id}/retry` && response.request().method() === 'POST')
  await manager.getByRole('button', { name: 'Ponów zadanie', exact: true }).click()
  // An explicit retry resets the bounded automatic-attempt cycle, not job ID.
  expect((await json(await retried, 202)).job).toMatchObject({ id: quota.id, status: 'QUEUED', attempts: 0 })
  expect(await db.aiJob.count()).toBe(beforeRetry)
  const retryClaim = await claim(manager, quota)
  const retryAnswer = 'Syntetyczna odpowiedź po świadomym ponowieniu tego samego zadania.'
  await finish(retryClaim, { status: 'SUCCEEDED', result: { answer: retryAnswer } })
  await expect(manager.getByText(retryAnswer, { exact: true })).toBeVisible({ timeout: 12_000 })
  expect(await readJob(manager, quota.id)).toMatchObject({ id: quota.id, status: 'SUCCEEDED', attempts: 1, result: { answer: retryAnswer } })
  expect(report.workerActions.filter((entry) => entry.action === 'finish' && entry.jobId === quota.id)).toHaveLength(2)
  const waitingClaim = await claim(admin, waiting)
  await finish(waitingClaim, { status: 'SUCCEEDED', result: { answer: 'Oczekujące zadanie wykonane po zdjęciu globalnego limitu.' } })
  expect(await readJob(admin, waiting.id)).toMatchObject({ status: 'SUCCEEDED', attempts: 1 })
  step('QUOTA is visible and prevents another QUEUED job from running; cross-owner retry404; explicit Ponów zadanie reuses the same job and displays its answer; waiting work resumes afterward.')

  const pending = await sendQuestion(manager, 'WIKI_CHAT', 'Czy oczekujące zadanie przetrwa restart serwera?')
  report.jobs.restart = pending.id
  const persistedBefore = await readJob(admin, finance.id)
  // Close pages before deliberately stopping their server, including unrelated
  // background UI fetches. Browser-context API clients retain the real login
  // cookies. Durability below is API readback, not UI conversation restoration.
  const adminApi = { request: admin.request }
  const managerApi = { request: manager.request }
  await admin.goto(`${baseUrl}/knowledge`)
  await admin.waitForLoadState('networkidle')
  await expect(admin.getByTitle('AI Analyst', { exact: true })).toHaveCount(0)
  await Promise.all([admin, manager, employee, otherAdmin].map((page) => page.close()))
  await stop()
  await start()
  expect(await readJob(adminApi, finance.id)).toEqual(persistedBefore)
  expect(await readJob(managerApi, pending.id)).toMatchObject({ id: pending.id, status: 'QUEUED', attempts: 0, result: null })
  const restartClaim = await claim(managerApi, pending)
  const restartAnswer = 'Syntetyczna odpowiedź zadania zachowanego po restarcie.'
  await finish(restartClaim, { status: 'SUCCEEDED', result: { answer: restartAnswer } })
  expect(await readJob(managerApi, pending.id)).toMatchObject({ id: pending.id, status: 'SUCCEEDED', attempts: 1, result: { answer: restartAnswer } })
  await stop()
  await start()
  expect(await readJob(managerApi, pending.id)).toMatchObject({ id: pending.id, status: 'SUCCEEDED', result: { answer: restartAnswer } })
  expect(await db.aiJob.count()).toBe(5)
  expect(await db.revenue.findFirstOrThrow()).toMatchObject({ amount: 12_345 })
  step('Server restarts preserve prior results and pending job; persisted pending work completes through HTTP after restart; its result survives a second restart. Five jobs, unchanged finance fixture.')

  if (report.pageErrors.length) issue(`Browser page errors: ${JSON.stringify(report.pageErrors)}`)
  else step('No uncaught browser page errors.')
  if (report.failures.length) throw new Error(`${report.failures.length} browser acceptance issue(s); see report.json`)
  report.status = 'PASSED'
} catch (error) {
  fatalError = error
  report.status = 'FAILED'
  report.error = error instanceof Error ? error.message : String(error)
} finally {
  for (const cleanup of [() => browser?.close(), stop, () => db.$disconnect()]) {
    try { await cleanup() } catch (error) {
      issue(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      report.status = 'FAILED'
      fatalError ??= error
    }
  }
  saveReport()
  console.log(`REPORT: ${path.join(artifactDirectory, 'report.json')}`)
  console.log(`SYNTHETIC DATABASE: ${databasePath}`)
}

if (fatalError) { console.error(fatalError); process.exitCode = 1 }
