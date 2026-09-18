#!/usr/bin/env node
/** Real UI/API/SQLite acceptance on a fresh private synthetic database only. */
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile, chmod, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { invoiceOAuthServerEnvironment } from './validate-invoice-import-oauth.mjs'

if (process.argv.slice(2).join(' ') !== '--confirm-synthetic-local') throw new Error('Use --confirm-synthetic-local; this gate never accepts an existing database or server.')
const [{ chromium, expect }, { default: bcrypt }, { PrismaClient }] = await Promise.all([
  import('@playwright/test'), import('bcryptjs'), import('../src/generated/prisma/index.js'),
])
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if ((await readdir(repository)).some((name) => /^\.env(?:$|\.)/.test(name) && name !== '.env.example')) throw new Error('Run only in an isolated worktree without .env files; Next must not load production configuration.')
const directory = await mkdtemp('/private/tmp/wd-break-even-')
await chmod(directory, 0o700)
const artifacts = path.join(repository, 'test-results', `break-even-${Date.now()}`)
await mkdir(artifacts, { recursive: true })
const report = { status: 'RUNNING', directory, artifacts, passed: [], screenshots: [] }
const pass = (label) => { report.passed.push(label); console.log(`PASS ${label}`) }
const check = (condition, label) => { if (!condition) throw new Error(label) }
const probe = createServer()
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const baseUrl = `http://127.0.0.1:${port}`
const environment = invoiceOAuthServerEnvironment({ databaseUrl: `file:${directory}/synthetic.db`, baseUrl,
  nextAuthSecret: randomBytes(48).toString('base64url'), workerSecret: randomBytes(48).toString('base64url'),
  originalsDirectory: `${directory}/originals`, processingDirectory: `${directory}/processing`,
})
let db, browser, server, page
let serverLog = ''
async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const owned = server
  const stopped = new Promise((resolve) => owned.once('close', resolve))
  owned.kill('SIGTERM')
  const timer = setTimeout(() => owned.kill('SIGKILL'), 5000)
  await stopped
  clearTimeout(timer)
}
async function startServer() {
  server = spawn(process.execPath, ['--preserve-symlinks', 'node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], { cwd: repository, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', (chunk) => { serverLog += chunk.toString() })
  server.stderr.on('data', (chunk) => { serverLog += chunk.toString() })
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('Synthetic server exited')
    if (await fetch(`${baseUrl}/api/health`).then((response) => response.ok).catch(() => false)) return
    await delay(250)
  }
  throw new Error('Synthetic server did not start')
}
async function screenshot(name) {
  const filename = path.join(artifacts, `${name}.png`)
  await page.screenshot({ path: filename, fullPage: true })
  report.screenshots.push(filename)
}
try {
  report.buildId = (await readFile(path.join(repository, '.next/BUILD_ID'), 'utf8')).trim()
  execFileSync(process.execPath, ['--preserve-symlinks', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: repository, env: environment, stdio: 'pipe' })
  db = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } })
  const password = randomBytes(24).toString('base64url')
  for (const role of ['ADMIN', 'MANAGER']) await db.user.create({ data: { username: `synthetic${role.toLowerCase()}`, name: `SYNTHETIC ${role}`, email: `${role.toLowerCase()}@example.test`, role, passwordHash: await bcrypt.hash(password, 10) } })
  for (const id of ['JAG', 'PUL', 'GLOBAL']) await db.costCenter.create({ data: { id, name: id } })
  await db.costTagGroup.create({ data: { id: 'behavior', slug: 'behavior', name: 'Charakter kosztu' } })
  for (const slug of ['fixed', 'variable', 'cogs']) await db.costTag.create({ data: { id: slug, slug, name: slug, groupId: 'behavior' } })
  const year = 2026, month = 9
  for (const costCenterId of ['JAG', 'PUL']) await db.revenue.create({ data: { year, month, costCenterId, channel: 'SALON', amount: 12300 } })
  for (const [id, label, net, tag] of [['rent', 'Czynsz testowy', 1200, 'fixed'], ['transport', 'Transport testowy', 100, 'variable'], ['goods', 'Towar testowy', 6000, 'cogs']]) {
    const invoice = await db.ksefInvoice.create({ data: { id: `invoice-${id}`, source: 'KSEF', supplierName: `SYNTHETIC ${id}`, supplierNip: `TEST-${id}`, invoiceNumber: `TEST/${id}/2026/09`, issueDate: new Date('2026-09-03T00:00:00Z'), grossAmount: net * 1.23, netAmount: net, vatAmount: net * 0.23, status: 'APPROVED', costCenterId: 'PUL' } })
    await db.costEvent.create({ data: { id: `event-${id}`, source: 'KSEF', sourceInvoiceId: invoice.id, eventDate: invoice.issueDate, supplierName: invoice.supplierName, supplierNip: invoice.supplierNip, reference: invoice.invoiceNumber, grossAmount: invoice.grossAmount, netAmount: net, vatAmount: invoice.vatAmount, parts: { create: [{ id: `part-${id}`, label, grossAmount: invoice.grossAmount, tags: { create: [{ tagId: tag }] }, allocations: { create: [{ costCenterId: 'PUL', percent: 100 }] } }] } } })
  }
  // Reference fixtures end here. Settings, links, net inputs and edits below must go through the application.
  await startServer()
  const deniedAnonymous = (response) => response.status === 401 || ([302, 307].includes(response.status) && new URL(response.headers.get('location'), baseUrl).pathname === '/login')
  for (const endpoint of ['break-even', 'break-even/settings', 'break-even/sources']) check(deniedAnonymous(await fetch(`${baseUrl}/api/finance/${endpoint}?year=${year}&month=${month}`, { redirect: 'manual' })), `anonymous read ${endpoint}`)
  check(deniedAnonymous(await fetch(`${baseUrl}/api/finance/break-even/settings`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'margin.save', margin: 0.4, effectiveFrom: '2026-09' }) })), 'anonymous write')
  check(await db.breakEvenMarginSetting.count() === 0, 'unauthenticated write did not persist')
  pass('anonymous reads and writes denied')
  browser = await chromium.launch({ headless: true, channel: 'chromium' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  page = await context.newPage()
  page.setDefaultTimeout(15000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  async function login(target, role) {
    await target.goto(`${baseUrl}/login`)
    await target.getByLabel('Login', { exact: true }).fill(`synthetic${role}`)
    await target.getByLabel('Hasło', { exact: true }).fill(password)
    await target.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
    await target.waitForURL((url) => !url.pathname.includes('/login'))
  }
  await login(page, 'admin')
  await page.goto(`${baseUrl}/finance/break-even`)
  await expect(page.getByRole('heading', { name: 'Próg sprzedaży salonów', exact: true })).toBeVisible()
  await page.getByLabel('Miesiąc raportu').fill('2026-09')
  const settingsTab = () => page.getByRole('button', { name: 'Ustawienia i koszty stałe', exact: true }).click()
  const summaryTab = () => page.getByRole('button', { name: 'Podsumowanie miesiąca', exact: true }).click()
  async function readReport(y = year, m = month) {
    const response = await context.request.get(`${baseUrl}/api/finance/break-even?year=${y}&month=${m}`)
    check(response.ok(), 'read report API')
    return (await response.json()).report
  }
  async function waitReport(predicate) {
    await expect.poll(async () => predicate(await readReport()), { timeout: 10000 }).toBe(true)
    await expect(page.getByText('Ładuję dane miesiąca…')).toHaveCount(0)
  }
  async function mutateAndRefresh(button) {
    const mutation = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/finance/break-even/settings')
    const readbacks = ['', '/settings', '/sources'].map((suffix) => page.waitForResponse((response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/finance/break-even${suffix}`))
    await button.click()
    const response = await mutation
    check(response.ok(), `settings mutation failed: ${response.status()} ${await response.text()}`)
    for (const readback of await Promise.all(readbacks)) { await readback.finished(); check(readback.ok(), 'UI readback failed') }
    await expect(page.getByText('Ładuję dane miesiąca…')).toHaveCount(0)
  }
  async function saveMargin(value, period = '2026-09') {
    await page.getByRole('button', { name: 'Dodaj marżę', exact: true }).click()
    await page.getByLabel('Marża (%)', { exact: true }).fill(value)
    await page.getByLabel('Marża obowiązuje od', { exact: true }).fill(period)
    await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz marżę', exact: true }))
    await expect(page.getByRole('button', { name: 'Zapisz marżę', exact: true })).toHaveCount(0)
  }
  async function saveNet(value) {
    await page.getByRole('button', { name: 'Uzupełnij sprzedaż netto — Puławska', exact: true }).click()
    await page.getByLabel('Sprzedaż netto — Puławska', { exact: true }).fill(value)
    await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz sprzedaż netto', exact: true }))
    await expect(page.getByRole('button', { name: 'Zapisz sprzedaż netto', exact: true })).toHaveCount(0)
  }
  async function openFixedDetails() {
    const details = page.getByTestId('salon-PUL').locator('details').filter({ has: page.locator('summary', { hasText: /^Szczegóły kosztów stałych/ }) })
    if ((await details.getAttribute('open')) === null) await details.locator('summary').click()
  }
  async function matchRent() {
    await openFixedDetails()
    await page.getByRole('button', { name: 'Przypisz fakturę — Czynsz Puławska TEST', exact: true }).click()
    await page.getByLabel(/^Faktura za 2026-09 — Czynsz Puławska TEST/).selectOption('part-rent')
    await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz przypisanie', exact: true }))
    await waitReport((data) => data.byCostCenter.PUL.actualFixedNet === 1200 && data.byCostCenter.PUL.expectedFixedNet === 0)
    await expect(page.getByTestId('salon-PUL').getByText('Stałe potwierdzone netto', { exact: true }).locator('..').locator('dd')).toHaveText((1200).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }))
  }
  await expect(page.getByTestId('salon-PUL')).toContainText('Brak danych')
  await screenshot('initial-desktop')
  await settingsTab()
  await saveMargin('40')
  await waitReport((data) => data.margin?.margin === 0.4)
  check(await db.breakEvenMarginSetting.count() === 1, 'margin persisted')
  await page.getByRole('button', { name: 'Dodaj koszt stały', exact: true }).click()
  await page.getByLabel(/^Utwórz na podstawie faktury/).selectOption('part-rent:PUL')
  await page.getByLabel('Nazwa kosztu', { exact: true }).fill('Czynsz Puławska TEST')
  await page.getByLabel('Oczekiwana kwota netto / miesiąc', { exact: true }).fill('1000')
  await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz koszt stały', exact: true }))
  await waitReport((data) => data.byCostCenter.PUL.expectedFixedNet === 1000)
  const template = await db.breakEvenFixedCost.findFirstOrThrow()
  check(template.costCenterId === 'PUL' && template.supplierName === 'SYNTHETIC rent', 'source picker persisted attribution')
  await summaryTab()
  await saveNet('10000')
  await waitReport((data) => data.byCostCenter.PUL.targetNet === 2750 && data.byCostCenter.PUL.targetGross === 3382.5)
  await expect(page.getByTestId('salon-PUL').getByText((3382.5).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }), { exact: true })).toBeVisible()
  pass('shared margin, source-based expected expense and net/gross target saved through UI')
  await matchRent()
  const matched = await readReport()
  check(matched.byCostCenter.PUL.targetNet === 3250 && matched.byCostCenter.PUL.targetGross === 3997.5 && matched.byCostCenter.PUL.operatingResultNet === 2700, 'actual replaces expected, COGS not counted twice')
  await expect(page.getByTestId('salon-PUL').getByText((3997.5).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }), { exact: true })).toBeVisible()
  check(await db.breakEvenFixedCostMatch.count() === 1, 'single durable link')
  const duplicate = await context.request.post(`${baseUrl}/api/finance/break-even/settings`, { data: { action: 'match.save', fixedCostId: template.id, year, month, costEventPartId: 'part-rent' } })
  check(duplicate.ok() && await db.breakEvenFixedCostMatch.count() === 1, 'repeated assignment remains one link')
  const goods = await context.request.post(`${baseUrl}/api/finance/break-even/settings`, { data: { action: 'match.save', fixedCostId: template.id, year, month, costEventPartId: 'part-goods' } })
  check(goods.status() >= 400 && goods.status() < 500, 'goods cannot masquerade as fixed')
  pass('actual replaces expected once; repeated assignment never duplicates; goods link rejected')
  await page.reload()
  await expect(page.getByTestId('salon-PUL')).toBeVisible()
  await openFixedDetails()
  await screenshot('matched-desktop')
  await page.getByRole('button', { name: 'Edytuj kwotę — Czynsz Puławska TEST', exact: true }).click()
  await page.getByLabel('Dokładna kwota netto (opcjonalnie)', { exact: true }).fill('1250')
  await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz przypisanie', exact: true }))
  await waitReport((data) => data.byCostCenter.PUL.actualFixedNet === 1250)
  check(await db.breakEvenFixedCostMatch.count() === 1, 'override edited without a second link')
  await openFixedDetails()
  await page.getByRole('button', { name: 'Edytuj kwotę — Czynsz Puławska TEST', exact: true }).click()
  await page.getByLabel('Dokładna kwota netto (opcjonalnie)', { exact: true }).fill('')
  await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz przypisanie', exact: true }))
  await waitReport((data) => data.byCostCenter.PUL.actualFixedNet === 1200)
  await openFixedDetails()
  pass('existing assigned net override edited and cleared without duplication')
  await mutateAndRefresh(page.getByRole('button', { name: 'Odłącz fakturę — Czynsz Puławska TEST', exact: true }))
  await waitReport((data) => data.byCostCenter.PUL.expectedFixedNet === 1000 && data.byCostCenter.PUL.actualFixedNet === 0)
  await matchRent()
  pass('reload and unlink restore expected expense')
  await settingsTab()
  await page.getByRole('button', { name: 'Edytuj Czynsz Puławska TEST', exact: true }).click()
  await page.getByLabel('Oczekiwana kwota netto / miesiąc', { exact: true }).fill('1100')
  await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz koszt stały', exact: true }))
  await expect.poll(async () => (await db.breakEvenFixedCost.findUniqueOrThrow({ where: { id: template.id } })).expectedNetAmount).toBe(1100)
  await saveMargin('50', '2026-10')
  check((await readReport()).margin.margin === 0.4, 'future margin did not affect September')
  check((await readReport(2026, 10)).byCostCenter.PUL.targetNet === 2200, 'October recurring expectation and future company margin')
  await page.getByRole('button', { name: 'Edytuj marżę 2026-10', exact: true }).click()
  await page.getByLabel('Marża (%)', { exact: true }).fill('60')
  await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz marżę', exact: true }))
  await expect.poll(async () => (await readReport(2026, 10)).margin.margin).toBe(0.6)
  const marginSection = page.getByRole('region', { name: 'Marża firmy', exact: true })
  const futureRow = marginSection.getByRole('button', { name: 'Edytuj marżę 2026-10', exact: true }).locator('..')
  await futureRow.getByRole('button', { name: 'Usuń', exact: true }).click()
  await mutateAndRefresh(page.getByRole('button', { name: 'Potwierdź', exact: true }))
  await expect.poll(async () => (await readReport(2026, 10)).margin.margin).toBe(0.4)
  await page.getByLabel('Miesiąc raportu').fill('2026-10')
  await summaryTab()
  await expect(page.getByTestId('salon-PUL').getByText('Stałe oczekiwane netto', { exact: true }).locator('..').locator('dd')).toHaveText((1100).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }))
  await expect(page.getByTestId('salon-PUL').getByText('Stałe potwierdzone netto', { exact: true }).locator('..').locator('dd')).toHaveText((0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }))
  await screenshot('next-month-expected')
  await page.getByLabel('Miesiąc raportu').fill('2026-09')
  await expect(page.getByTestId('salon-PUL').getByText('Stałe potwierdzone netto', { exact: true }).locator('..').locator('dd')).toHaveText((1200).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }))
  pass('edit recurring cost; future margin isolation; edit/delete margin; month switching')
  const changeRevenue = await context.request.post(`${baseUrl}/api/revenue`, { data: { year, month, costCenterId: 'PUL', channel: 'SALON', amount: 24600 } })
  check(changeRevenue.ok(), 'existing gross revenue API edit')
  await page.reload()
  await expect(page.getByTestId('salon-PUL')).toContainText('Obrót brutto zmienił się')
  check((await readReport()).byCostCenter.PUL.targetGross === null, 'stale net refused')
  await saveNet('20000')
  await waitReport((data) => data.byCostCenter.PUL.revenueNet === 20000)
  await page.getByRole('button', { name: 'Usuń wpis netto — Puławska', exact: true }).click()
  await mutateAndRefresh(page.getByRole('button', { name: 'Potwierdź usunięcie netto', exact: true }))
  await waitReport((data) => data.byCostCenter.PUL.revenueNet === null)
  await saveNet('20000')
  pass('gross changes invalidate companion net; net edit and clear persist')
  await settingsTab()
  await page.getByRole('button', { name: 'Archiwizuj', exact: true }).click()
  await mutateAndRefresh(page.getByRole('button', { name: 'Potwierdź', exact: true }))
  await waitReport((data) => data.byCostCenter.PUL.fixedCosts.length === 0)
  await page.getByRole('button', { name: 'Przywróć Czynsz Puławska TEST', exact: true }).click()
  await mutateAndRefresh(page.getByRole('button', { name: 'Zapisz koszt stały', exact: true }))
  await waitReport((data) => data.byCostCenter.PUL.actualFixedNet === 1200)
  pass('archive and restore recurring expense')
  await summaryTab()
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot('mobile')
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile horizontal overflow')
  await page.getByTestId('salon-PUL').evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await screenshot('mobile-salon')
  check(await page.getByTestId('salon-PUL').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'mobile salon card horizontal overflow')
  await page.setViewportSize({ width: 1440, height: 1100 })
  const managerContext = await browser.newContext()
  const managerPage = await managerContext.newPage()
  await login(managerPage, 'manager')
  for (const endpoint of ['break-even', 'break-even/settings', 'break-even/sources']) check((await managerContext.request.get(`${baseUrl}/api/finance/${endpoint}?year=${year}&month=${month}`)).status() === 403, `manager read ${endpoint}`)
  check((await managerContext.request.post(`${baseUrl}/api/finance/break-even/settings`, { data: { action: 'margin.delete', id: 'anything' } })).status() === 403, 'manager mutation')
  await managerContext.close()
  pass('manager reads and writes denied')
  const beforeRestart = await readReport()
  await stopServer()
  await startServer()
  await page.reload()
  await expect(page.getByTestId('salon-PUL')).toBeVisible()
  const afterRestart = await readReport()
  check(JSON.stringify(beforeRestart) === JSON.stringify(afterRestart), 'restart changed report')
  check(await db.costAuditLog.count({ where: { action: { startsWith: 'break-even.' } } }) > 0, 'audits persisted')
  await screenshot('after-restart')
  pass('SQLite state, audit and report survive actual server restart')
  check(pageErrors.length === 0, 'browser page errors')
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAILED'
  report.error = String(error?.stack ?? error)
  if (page) await screenshot('failure').catch(() => {})
  process.exitCode = 1
} finally {
  const cleanupFailure = (error) => { report.status = 'FAILED'; report.cleanupErrors = [...(report.cleanupErrors ?? []), String(error)]; process.exitCode = 1 }
  await browser?.close().catch(cleanupFailure)
  await stopServer().catch(cleanupFailure)
  if (db) try {
    report.integrity = await db.$queryRawUnsafe('PRAGMA integrity_check')
    report.foreignKeys = await db.$queryRawUnsafe('PRAGMA foreign_key_check')
    check(report.integrity.length === 1 && report.integrity[0].integrity_check === 'ok' && report.foreignKeys.length === 0, 'SQLite integrity / foreign key check failed')
  } catch (error) { cleanupFailure(error) } finally { await db.$disconnect().catch(cleanupFailure) }
  await writeFile(path.join(artifacts, 'server.log'), serverLog, { mode: 0o600 })
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ status: report.status, passed: report.passed.length, artifacts, error: report.error }))
}
