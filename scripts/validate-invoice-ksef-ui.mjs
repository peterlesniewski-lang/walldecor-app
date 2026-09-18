#!/usr/bin/env node
/** Run with node --preserve-symlinks --import tsx. No OAuth, KSeF network, production DB or worker. */
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma/index.js'
import { createSyntheticInvoicePng, INVOICE_OAUTH_EXPECTED, invoiceOAuthServerEnvironment,
  captureSyntheticScreenshot } from './validate-invoice-import-oauth.mjs'
import { chatOAuthBrowserLaunchOptions, chatOAuthFixtureUsernames } from './validate-ai-chat-oauth.mjs'

const argumentsKey = process.argv.slice(2).join(' ')
const extended = argumentsKey === '--confirm-synthetic-local --include-ui-risks'
const legacyDuplicates = argumentsKey === '--confirm-synthetic-local --include-legacy-duplicates'
if (argumentsKey !== '--confirm-synthetic-local' && !extended && !legacyDuplicates) {
  throw new Error('Use --confirm-synthetic-local. This gate creates only isolated synthetic data.')
}
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'wd-ksef-ui-')))
const artifacts = path.join(repository, 'test-results', `invoice-ksef-ui-${runId}`)
await mkdir(artifacts, { recursive: true, mode: 0o700 })
await chmod(artifacts, 0o700)
const report = { runId, status: 'RUNNING', scope: 'Synthetic KSeF observation via real reconciliation service; decisions through real production UI/API. No OAuth or KSeF network.',
  extendedUiRisks: extended, legacyDuplicates, directory, artifacts, passed: [], screenshots: [], cleanup: {} }
const check = (condition, code) => { if (!condition) throw new Error(code) }
const pass = (code) => { report.passed.push(code); process.stdout.write(`PASS ${code}\n`) }
let db, browser, server, page, safeUi = false
let cancelled = false
const onSignal = () => { cancelled = true; server?.kill('SIGTERM'); void browser?.close() }
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
const screenshot = (label) => captureSyntheticScreenshot(page, artifacts, label, report.screenshots)
async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const owned = server
  const closed = new Promise((resolve) => owned.once('close', resolve))
  owned.kill('SIGTERM')
  const kill = setTimeout(() => owned.kill('SIGKILL'), 5_000)
  try { await closed } finally { clearTimeout(kill) }
}
async function waitFor(predicate, code) {
  for (let i = 0; i < 150; i++) {
    check(!cancelled, 'INTERRUPTED')
    const result = await predicate()
    if (result) return result
    await delay(100)
  }
  throw new Error(code)
}
try {
  report.buildId = (await readFile(path.join(repository, '.next/BUILD_ID'), 'utf8')).trim()
  check(/^[\w-]+$/.test(report.buildId), 'PRODUCTION_BUILD_REQUIRED')
  for (const name of ['originals', 'processing']) await mkdir(path.join(directory, name), { mode: 0o700 })
  for (const name of ['node_modules', 'public']) await symlink(path.join(repository, name), path.join(directory, name), 'dir')
  const build = path.join(repository, '.next')
  await cp(build, path.join(directory, '.next'), { recursive: true,
    filter: (source) => !['cache', 'standalone'].includes(path.relative(build, source).split(path.sep)[0]) })
  await mkdir(path.join(directory, 'prisma'))
  await cp(path.join(repository, 'prisma/schema.prisma'), path.join(directory, 'prisma/schema.prisma'))
  await cp(path.join(repository, 'prisma/migrations'), path.join(directory, 'prisma/migrations'), { recursive: true })
  const databasePath = path.join(directory, 'synthetic.sqlite')
  report.databasePath = databasePath
  const probe = createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const baseUrl = `http://127.0.0.1:${port}`
  report.baseUrl = baseUrl
  const environment = invoiceOAuthServerEnvironment({ databaseUrl: `file:${databasePath}`, baseUrl,
    nextAuthSecret: randomBytes(48).toString('base64url'), workerSecret: randomBytes(48).toString('base64url'),
    originalsDirectory: path.join(directory, 'originals'), processingDirectory: path.join(directory, 'processing') })
  execFileSync('/usr/bin/sqlite3', [databasePath, 'VACUUM;'], { stdio: 'pipe' })
  await chmod(databasePath, 0o600)
  execFileSync(process.execPath, [path.join(repository, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy',
    '--schema', path.join(directory, 'prisma/schema.prisma')], { cwd: directory, env: environment, stdio: 'pipe', timeout: 60_000 })
  db = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } })
  const username = chatOAuthFixtureUsernames(runId).admin
  const password = randomBytes(24).toString('base64url')
  await db.user.create({ data: { id: username, username, email: `${username}@example.test`, name: 'SYNTHETIC ADMIN',
    role: 'ADMIN', passwordHash: await bcrypt.hash(password, 10) } })
  for (const id of ['JAG', 'PUL', 'GLOBAL']) await db.costCenter.create({ data: { id, name: id } })
  await db.costTagGroup.create({ data: { id: 'behavior', name: 'Charakter', slug: 'behavior' } })
  await db.costTag.create({ data: { id: 'fixed', name: 'Stały', slug: 'fixed', groupId: 'behavior' } })
  const modules = await Promise.all([
    import('../src/lib/invoice-import/draft-service.ts'),
    import('../src/lib/invoice-import/file-service.ts'),
    import('../src/lib/invoice-import/private-store.ts'),
    import('../src/lib/invoice-import/approval-service.ts'),
    import('../src/lib/invoice-import/ksef-reconciliation-service.ts'),
    import('../src/lib/ai/queue.ts'),
  ])
  const [draftService, files, storeModule, approval, ksef, queue] = modules.map((entry) => entry.default ?? entry)
  const fixture = await createSyntheticInvoicePng(path.join(directory, 'synthetic-ksef.png'))
  const batch = await draftService.createBatch(db, username)
  const uploaded = await files.uploadInvoiceDocument(db, username, { batchId: batch.id,
    originalName: 'synthetic-ksef.png', bytes: await readFile(fixture.path) }, {
    store: new storeModule.PrivateInvoiceAttachmentStore(environment.INVOICE_ORIGINALS_DIR),
    processor: { pdfInfoBinary: '/unused/pdfinfo', pdfToPpmBinary: '/unused/pdftoppm', workRoot: environment.INVOICE_PROCESSING_DIR },
  })
  const draft = await draftService.editDraft(db, username, uploaded.draft.id, uploaded.draft.version,
    { ...INVOICE_OAUTH_EXPECTED, costCenterId: 'JAG', tagIds: ['fixed'], notes: 'Zachowaj notatkę administratora' })
  const approved = await approval.approveInvoiceDraft(db, username, draft.id,
    { expectedVersion: draft.version, idempotencyKey: randomUUID() })
  report.draftId = draft.id
  report.invoiceId = approved.invoiceId
  report.fixtureSha256 = fixture.sha256
  const metadata = (multiplier) => ({ ksefNumber: 'SYNTHETIC-KSEF-UI-ONE',
    seller: { name: INVOICE_OAUTH_EXPECTED.supplierName, nip: INVOICE_OAUTH_EXPECTED.taxId },
    invoiceNumber: INVOICE_OAUTH_EXPECTED.invoiceNumber, issueDate: INVOICE_OAUTH_EXPECTED.issueDate,
    paymentDueDate: INVOICE_OAUTH_EXPECTED.dueDate, currency: 'PLN', grossAmount: 123 * multiplier,
    netAmount: 100 * multiplier, vatAmount: 23 * multiplier })
  const observe = (multiplier) => queue.withAiQueueMutation(db, () => new Date(), (tx, _lease, now) =>
    ksef.reconcileImportedKsefInvoice(tx, username, metadata(multiplier), '<Faktura />', now))
  const costs = () => db.costEvent.findMany({ where: { status: 'APPROVED', documentStatus: 'ACTIVE' } })
  const assertMoney = async (gross) => {
    const active = await costs()
    check(active.length === (gross === 0 ? 0 : 1) && active.reduce((sum, cost) => sum + cost.grossAmount, 0) === gross, 'ACTIVE_COST_MISMATCH')
    check(await db.ksefInvoice.count() === 1, 'DUPLICATE_INVOICE')
    check((await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })).invoiceId === approved.invoiceId, 'INVOICE_ID_CHANGED')
  }
  await assertMoney(123)
  check((await observe(1)).status === 'MATCHED', 'MATCHED_OBSERVATION_FAILED')
  await assertMoney(123)
  async function startServer() {
    let ready = false
    let startFailed = false
    server = spawn(process.execPath, [path.join(repository, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'],
      { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    server.on('error', () => { startFailed = true })
    const consume = (chunk) => { if (chunk.toString().includes('Ready in')) ready = true }
    server.stdout.on('data', consume); server.stderr.on('data', consume)
    await waitFor(async () => {
      check(!startFailed && server.exitCode === null && server.signalCode === null, 'LOCAL_SERVER_EXITED')
      return ready && await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }).then((res) => res.ok).catch(() => false)
    }, 'LOCAL_SERVER_UNAVAILABLE')
  }
  await startServer()
  browser = await chromium.launch(chatOAuthBrowserLaunchOptions(directory))
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true })
  page = await context.newPage()
  page.on('pageerror', () => { report.pageErrors = (report.pageErrors ?? 0) + 1 })
  page.setDefaultTimeout(15_000)
  await page.goto(`${baseUrl}/login`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Login', { exact: true }).fill(username)
  await page.getByLabel('Hasło', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.includes('login'))
  safeUi = true
  const invoiceRow = () => page.getByRole('row').filter({ hasText: INVOICE_OAUTH_EXPECTED.invoiceNumber })
  async function openDocument() {
    await page.goto(`${baseUrl}/finance/ksef`)
    await page.waitForLoadState('networkidle')
    await expect(invoiceRow()).toHaveCount(1)
    await invoiceRow().getByRole('button', { name: 'Otwórz dokument', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Porównanie z KSeF', exact: true })).toBeVisible()
  }
  await openDocument()
  await expect(page.getByText('Dane zgodne z KSeF', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'synthetic-ksef.png', exact: true })).toBeVisible()
  await screenshot('matched-original-and-approved')
  check((await observe(2)).status === 'CONFLICT', 'CONFLICT_OBSERVATION_FAILED')
  await assertMoney(123)
  await page.goto(`${baseUrl}/finance/ksef`)
  await page.waitForLoadState('networkidle')
  await expect(invoiceRow()).toContainText('KSeF · wymaga rozstrzygnięcia')
  await expect(invoiceRow()).toContainText('Zatwierdzona')
  await screenshot('inbox-conflict-cost-still-approved')
  await invoiceRow().getByRole('button', { name: 'Otwórz dokument', exact: true }).click()
  const apply = page.getByRole('button', { name: 'Przyjmij dane KSeF do szkicu', exact: true })
  await expect(apply).toBeDisabled()
  await expect(page.getByText('Aby przyjąć dane KSeF, najpierw wybierz „Cofnij z kosztów”.', { exact: true })).toBeVisible()
  await screenshot('approved-conflict-compare-and-revoke-instruction')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Dane', exact: true }).click()
  const differences = page.getByRole('table', { name: 'Różnice danych dokumentu KSeF SYNTHETIC-KSEF-UI-ONE', exact: true })
  await differences.scrollIntoViewIfNeeded()
  await expect(differences.getByRole('cell', { name: '123,00 PLN', exact: true })).toBeVisible()
  await expect(differences.getByRole('cell', { name: '246,00 PLN', exact: true })).toBeVisible()
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'MOBILE_CONFLICT_HORIZONTAL_OVERFLOW')
  await screenshot('mobile-conflict-two-column-values')
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.getByRole('button', { name: 'Zachowaj moje dane', exact: true }).click()
  await expect(page.getByText('Zachowano dane administratora', { exact: true })).toBeVisible()
  await assertMoney(123)
  await page.goto(`${baseUrl}/finance/ksef`)
  await page.waitForLoadState('networkidle')
  await expect(invoiceRow()).not.toContainText('wymaga rozstrzygnięcia')
  pass('MATCH_CONFLICT_KEEP_PRESERVED_ORIGINAL_AND_ONE_123_COST')
  check((await observe(3)).status === 'CONFLICT', 'NEW_OBSERVATION_DID_NOT_REOPEN_CONFLICT')
  await db.financePeriodClose.create({ data: { year: 2026, month: 9, closedById: username } })
  await openDocument()
  await page.getByRole('button', { name: 'Cofnij z kosztów', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Ponownie otworzyć zamknięty okres?', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Anuluj', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await assertMoney(123)
  check(await db.financePeriodClose.count() === 1, 'CANCEL_INVALIDATED_PERIOD')
  await page.getByRole('button', { name: 'Cofnij z kosztów', exact: true }).click()
  await expect(dialog).toBeVisible()
  await screenshot('closed-month-explicit-confirmation')
  await dialog.getByRole('button', { name: 'Potwierdź i otwórz okres', exact: true }).click()
  await waitFor(async () => (await costs()).length === 0, 'REVOKE_NOT_DURABLE')
  await assertMoney(0)
  check(await db.financePeriodClose.count() === 0, 'CONFIRMED_PERIOD_NOT_INVALIDATED')
  await expect(page.getByRole('button', { name: 'Zatwierdź i następna', exact: true })).toBeDisabled()
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(page.getByText('Dane KSeF przyjęte do szkicu', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Kwota brutto', { exact: true })).toHaveValue('369')
  await assertMoney(0)
  await page.getByRole('button', { name: 'Zatwierdź i następna', exact: true }).click()
  await waitFor(async () => (await costs())[0]?.grossAmount === 369, 'REAPPROVAL_NOT_DURABLE')
  await assertMoney(369)
  const after = await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })
  const data = JSON.parse(after.dataJson)
  check(data.notes === 'Zachowaj notatkę administratora' && data.costCenterId === 'JAG' && data.tagIds.includes('fixed'), 'LOCAL_CLASSIFICATION_LOST')
  check(await db.invoiceDraftAudit.count({ where: { draftId: draft.id, action: 'KSEF_KEPT_LOCAL' } }) === 1
    && await db.invoiceDraftAudit.count({ where: { draftId: draft.id, action: 'KSEF_APPLIED_TO_DRAFT' } }) === 1, 'DECISION_AUDIT_COUNT')
  const download = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Pobierz oryginał', exact: true }).click()]).then(([result]) => result)
  const downloaded = await readFile(await download.path())
  check(createHash('sha256').update(downloaded).digest('hex') === fixture.sha256, 'ORIGINAL_CHANGED')
  await writeFile(path.join(artifacts, 'downloaded-original.png'), downloaded, { flag: 'wx', mode: 0o600 })
  pass('CLOSED_MONTH_CANCEL_CONFIRM_REVOKE_APPLY_REAPPROVE_SAME_INVOICE_369')
  await page.goto(`${baseUrl}/dashboard?year=2026&month=9`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('link', { name: /Koszty rozpoznane/ }).locator('xpath=..')).toContainText(/369([,.]00)?\s*zł/i)
  await screenshot('dashboard-369-after-explicit-reapproval')
  await stopServer()
  await startServer()
  await openDocument()
  await expect(page.getByText('Dane KSeF przyjęte do szkicu', { exact: true })).toBeVisible()
  await assertMoney(369)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Dane', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Porównanie z KSeF', exact: true })).toBeVisible()
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'MOBILE_HORIZONTAL_OVERFLOW')
  await screenshot('mobile-ksef-comparison-after-restart')
  await page.getByRole('button', { name: 'Dokument', exact: true }).click()
  await expect(page.getByRole('img', { name: 'synthetic-ksef.png', exact: true })).toBeVisible()
  await screenshot('mobile-original-after-restart')
  if (extended) {
    await page.setViewportSize({ width: 1440, height: 1050 })
    await page.getByRole('button', { name: 'Cofnij z kosztów', exact: true }).click()
    await waitFor(async () => (await costs()).length === 0, 'RISK_REVOKE_NOT_DURABLE')
    await openDocument()
    const secondPage = await context.newPage()
    await secondPage.goto(`${baseUrl}/finance/ksef`)
    await secondPage.waitForLoadState('networkidle')
    await secondPage.getByRole('row').filter({ hasText: INVOICE_OAUTH_EXPECTED.invoiceNumber })
      .getByRole('button', { name: 'Otwórz dokument', exact: true }).click()
    const approveButton = (tab) => tab.getByRole('button', { name: 'Zatwierdź i następna', exact: true })
    await expect(approveButton(page)).toBeEnabled()
    await expect(approveButton(secondPage)).toBeEnabled()
    const beforeConcurrentCosts = await db.costEvent.count()
    const beforeConcurrentAudits = await db.invoiceDraftAudit.count({ where: { draftId: draft.id, action: 'APPROVED' } })
    const held = []
    const approvals = []
    const holdApproval = async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = new Promise((resolve) => {
        held.push(async () => { await route.continue(); resolve() })
      })
      await response
    }
    const approvalPattern = `**/invoice-import/drafts/${draft.id}/approve`
    for (const tab of [page, secondPage]) {
      await tab.route(approvalPattern, holdApproval)
      tab.on('response', (response) => {
        if (response.url().endsWith(`/drafts/${draft.id}/approve`) && response.request().method() === 'POST') approvals.push(response.status())
      })
    }
    // Only hold transport until both real UI operations exist. Neither response
    // is mocked: both requests are released to the real Next handler and SQLite.
    await Promise.all([approveButton(page).dblclick(), approveButton(secondPage).click()])
    await waitFor(() => held.length === 2, 'TWO_TAB_REQUESTS_NOT_OBSERVED')
    await Promise.all(held.map((release) => release()))
    await waitFor(() => approvals.length === 2, 'TWO_TAB_RESPONSES_MISSING')
    check(approvals.includes(200) && approvals.includes(409), 'TWO_TAB_OUTCOMES_INVALID')
    await assertMoney(369)
    check(await db.costEvent.count() === beforeConcurrentCosts + 1
      && await db.invoiceDraftAudit.count({ where: { draftId: draft.id, action: 'APPROVED' } }) === beforeConcurrentAudits + 1,
    'CONCURRENT_CLICK_DUPLICATED_COST_OR_AUDIT')
    const conflictText = 'Dokument zmienił się na serwerze. Wczytano aktualną wersję; edytor pozwoli bezpiecznie nałożyć Twoje poprawki.'
    await waitFor(async () => await page.getByText(conflictText, { exact: true }).isVisible()
      || await secondPage.getByText(conflictText, { exact: true }).isVisible(), 'STALE_TAB_NOTICE_MISSING')
    await page.unroute(approvalPattern, holdApproval)
    await secondPage.unroute(approvalPattern, holdApproval)
    await secondPage.close()
    pass('TWO_REAL_TABS_AND_DOUBLE_CLICK_ONE_ACTIVE_COST_CONTROLLED_409')

    await openDocument()
    await page.getByRole('button', { name: 'Cofnij z kosztów', exact: true }).click()
    await waitFor(async () => (await costs()).length === 0, 'DATE_MOVE_REVOKE_FAILED')
    await expect(page.getByLabel('Data wystawienia', { exact: true })).toBeEnabled()
    await page.getByLabel('Data wystawienia', { exact: true }).fill('2026-10-01')
    await page.getByRole('button', { name: 'Zapisz szkic', exact: true }).click()
    await waitFor(async () => JSON.parse((await db.invoiceImportDraft.findUniqueOrThrow({ where: { id: draft.id } })).dataJson).issueDate === '2026-10-01', 'NEW_DATE_NOT_SAVED')
    await page.getByRole('button', { name: 'Zachowaj moje dane', exact: true }).click()
    await expect(page.getByText('Zachowano dane administratora', { exact: true })).toBeVisible()
    for (const month of [9, 10]) await db.financePeriodClose.create({ data: { year: 2026, month, closedById: username } })
    const beforePeriodAudits = await db.costAuditLog.count({ where: { action: 'finance.period.invalidate' } })
    await approveButton(page).click()
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('wrzesień 2026')
    await expect(dialog).toContainText('październik 2026')
    await screenshot('date-move-both-closed-months')
    await dialog.getByRole('button', { name: 'Anuluj', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await assertMoney(0)
    check(await db.financePeriodClose.count() === 2, 'CANCEL_DATE_MOVE_CHANGED_PERIODS')
    await approveButton(page).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Potwierdź i otwórz okres', exact: true }).click()
    await waitFor(async () => (await costs())[0]?.eventDate.toISOString().slice(0, 10) === '2026-10-01', 'DATE_MOVE_NOT_APPROVED')
    await assertMoney(369)
    check(await db.financePeriodClose.count() === 0, 'BOTH_PERIODS_NOT_INVALIDATED')
    report.dateMovePeriodAuditCount = await db.costAuditLog.count({ where: { action: 'finance.period.invalidate' } }) - beforePeriodAudits
    check(report.dateMovePeriodAuditCount === 2, 'BOTH_PERIOD_INVALIDATION_AUDITS_MISSING')
    for (const [month, amount] of [[9, 0], [10, 369]]) {
      await page.goto(`${baseUrl}/dashboard?year=2026&month=${month}`)
      await page.waitForLoadState('networkidle')
      await expect(page.getByRole('link', { name: /Koszty rozpoznane/ }).locator('xpath=..'))
        .toContainText(new RegExp(`(?:^|\\s)${amount}(?:[,.]00)?\\s*zł`, 'i'))
      await screenshot(`dashboard-after-date-move-month-${month}`)
    }
    pass('DATE_MOVE_BOTH_CLOSED_MONTHS_CANCEL_CONFIRM_AND_DASHBOARD_SPLIT')

    await page.goto(`${baseUrl}/finance/ksef`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Dodaj faktury', exact: true }).click()
    const beforeUpload = { attachments: await db.invoiceAttachment.count(), drafts: await db.invoiceImportDraft.count(),
      jobs: await db.aiJob.count(), invoices: await db.ksefInvoice.count(), costs: await db.costEvent.count() }
    const originalKeysBefore = await readdir(environment.INVOICE_ORIGINALS_DIR)
    let interrupted = false
    let sentPartialBytes = 0
    let transportFailure = false
    const uploadPattern = '**/api/finance/invoice-import/drafts'
    const interruptUpload = async (route) => {
      if (route.request().method() !== 'POST' || interrupted) return route.continue()
      interrupted = true
      try {
        // Chromium does not expose uploaded file bytes in postDataBuffer.
        // Reconstruct only this known synthetic upload, keeping its UI-created
        // batch and session, and break a real HTTP stream to the real Next API.
        const currentBatch = await db.invoiceImportBatch.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })
        check(currentBatch.id !== batch.id && currentBatch.ownerUserId === username, 'UI_BATCH_NOT_FOUND')
        const boundary = `wd-interrupted-${runId}`
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="batchId"\r\n\r\n${currentBatch.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-ksef.png"\r\nContent-Type: image/png\r\n\r\n`),
          await readFile(fixture.path), Buffer.from(`\r\n--${boundary}--\r\n`),
        ])
        const incomingHeaders = route.request().headers()
        const partial = body.subarray(0, Math.floor(body.length / 2))
        await new Promise((resolve) => {
          const outgoing = httpRequest(`${baseUrl}/api/finance/invoice-import/drafts`, { method: 'POST', headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length),
            cookie: incomingHeaders.cookie ?? '', origin: baseUrl,
          } })
          const timeout = setTimeout(() => outgoing.destroy(), 3000)
          let breakTimer
          outgoing.on('error', () => {})
          outgoing.on('close', () => { clearTimeout(timeout); clearTimeout(breakTimer); resolve() })
          outgoing.on('response', (response) => { response.resume() })
          outgoing.write(partial, () => {
            sentPartialBytes = partial.length
            breakTimer = setTimeout(() => outgoing.destroy(), 150)
          })
        })
      } catch { transportFailure = true }
      await route.abort('connectionreset').catch(() => { transportFailure = true })
    }
    await page.route(uploadPattern, interruptUpload)
    await page.getByLabel('Dodaj faktury', { exact: true }).setInputFiles(fixture.path)
    const retry = page.getByRole('button', { name: 'Ponów synthetic-ksef.png', exact: true })
    await expect(retry).toBeVisible()
    check(!transportFailure && sentPartialBytes > 1024, 'REAL_PARTIAL_TRANSFER_NOT_SENT')
    const afterInterrupted = { attachments: await db.invoiceAttachment.count(), drafts: await db.invoiceImportDraft.count(),
      jobs: await db.aiJob.count(), invoices: await db.ksefInvoice.count(), costs: await db.costEvent.count() }
    check(JSON.stringify(beforeUpload) === JSON.stringify(afterInterrupted), 'ABORTED_UPLOAD_CHANGED_RECORDS')
    const originalKeysAfter = await readdir(environment.INVOICE_ORIGINALS_DIR)
    check(JSON.stringify(originalKeysBefore.sort()) === JSON.stringify(originalKeysAfter.sort()), 'ABORTED_UPLOAD_CHANGED_ORIGINALS')
    await screenshot('interrupted-upload-real-next-stream-retry-visible')
    await page.unroute(uploadPattern, interruptUpload)
    await retry.click()
    await expect(page.getByText('Duplikat — już zapisany', { exact: true })).toBeVisible()
    await assertMoney(369)
    check(await db.invoiceAttachment.count() === beforeUpload.attachments && await db.invoiceImportDraft.count() === beforeUpload.drafts
      && await db.aiJob.count() === beforeUpload.jobs && await db.costEvent.count() === beforeUpload.costs, 'UPLOAD_RETRY_DUPLICATED_RECORDS')
    report.interruptedUpload = { sentPartialBytes, unchangedRecords: true, unchangedPrivateFiles: true, retryDeduplicated: true }
    pass('REAL_INTERRUPTED_MULTIPART_NO_RECORD_OR_FILE_CHANGE_UI_RETRY_DEDUPLICATES')
  }
  if (legacyDuplicates) {
    await page.setViewportSize({ width: 1440, height: 1050 })
    await page.goto(`${baseUrl}/finance/ksef`)
    await page.waitForLoadState('networkidle')
    const manualForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Dodaj fakturę ręcznie bez pliku', exact: true }) })
    const fillManual = async ({ supplierName, taxId, invoiceNumber, issueDate, grossAmount }) => {
      await manualForm.getByPlaceholder('Dostawca', { exact: true }).fill(supplierName)
      await manualForm.getByPlaceholder('NIP', { exact: true }).fill(taxId)
      await manualForm.getByPlaceholder('Numer FV', { exact: true }).fill(invoiceNumber)
      await manualForm.locator('input[type="date"]').fill(issueDate)
      await manualForm.getByPlaceholder('Brutto', { exact: true }).fill(String(grossAmount))
    }
    const legacyPosts = []
    const legacyGets = []
    const recordLegacyResponse = (response) => {
      const request = response.request()
      if (response.url() === `${baseUrl}/api/finance/ksef/invoices` && request.method() === 'POST') legacyPosts.push(response.status())
      if (response.url().startsWith(`${baseUrl}/api/finance/ksef/invoices/`) && request.method() === 'GET') legacyGets.push(response.status())
    }
    page.on('response', recordLegacyResponse)
    const beforeDuplicates = { invoices: await db.ksefInvoice.count(), costs: await db.costEvent.count(),
      drafts: await db.invoiceImportDraft.count(), jobs: await db.aiJob.count(), attachments: await db.invoiceAttachment.count() }
    await fillManual({ ...INVOICE_OAUTH_EXPECTED, grossAmount: 999 })
    await manualForm.getByRole('button', { name: 'Dodaj', exact: true }).click()
    const openExisting = page.getByRole('button', { name: 'Otwórz istniejący dokument', exact: true })
    await expect(openExisting).toBeVisible()
    check(legacyPosts.length === 1 && legacyPosts[0] === 409, 'IMPORTED_DUPLICATE_NOT_BLOCKED')
    await expect(manualForm.getByPlaceholder('Numer FV', { exact: true })).toHaveValue(INVOICE_OAUTH_EXPECTED.invoiceNumber)
    await screenshot('legacy-create-import-duplicate-action')
    await openExisting.click()
    await expect(page.getByRole('heading', { name: 'Porównanie z KSeF', exact: true })).toBeVisible()
    await expect(page.getByRole('img', { name: 'synthetic-ksef.png', exact: true })).toBeVisible()
    await assertMoney(369)
    check(await db.costEvent.count() === beforeDuplicates.costs && legacyPosts.length === 1, 'OPEN_EXISTING_REPEATED_MUTATION')
    await screenshot('legacy-duplicate-opens-existing-import-original')
    pass('LEGACY_CREATE_DUPLICATE_409_OPENS_EXISTING_IMPORT_WITHOUT_NEW_COST')

    await page.goto(`${baseUrl}/finance/ksef`)
    await page.waitForLoadState('networkidle')
    const legacy = { supplierName: 'SYNTHETIC FOREIGN LEGACY', taxId: 'DE123456789', invoiceNumber: 'SYNTHETIC-LEGACY-ONLY',
      issueDate: '2026-09-12', grossAmount: 17 }
    await fillManual(legacy)
    await manualForm.getByRole('button', { name: 'Dodaj', exact: true }).click()
    await waitFor(() => legacyPosts.length === 2, 'LEGACY_CREATE_RESPONSE_MISSING')
    check(legacyPosts[1] === 201, 'LEGACY_CREATE_FAILED')
    await expect(manualForm.getByPlaceholder('Numer FV', { exact: true })).toHaveValue('')
    const legacyInvoice = await db.ksefInvoice.findFirstOrThrow({ where: { invoiceNumber: legacy.invoiceNumber }, include: { costEvent: { select: { id: true } } } })
    check(legacyInvoice.supplierNip === legacy.taxId && legacyInvoice.costEvent === null && legacyInvoice.source === 'MANUAL', 'FOREIGN_LEGACY_ID_OR_SOURCE_LOST')
    await fillManual({ ...legacy, grossAmount: 999 })
    await manualForm.getByRole('button', { name: 'Dodaj', exact: true }).click()
    await expect(openExisting).toBeVisible()
    check(legacyPosts.length === 3 && legacyPosts[2] === 409, 'LEGACY_DUPLICATE_NOT_BLOCKED')
    const legacyGetPattern = `**/api/finance/ksef/invoices/${legacyInvoice.id}`
    let failRead = true
    await page.route(legacyGetPattern, async (route) => {
      if (route.request().method() === 'GET' && failRead) {
        failRead = false
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SYNTHETIC chwilowy błąd podglądu' }) })
      }
      return route.continue()
    })
    await openExisting.click()
    await expect(page.getByRole('alert').filter({ has: openExisting })).toContainText('SYNTHETIC chwilowy błąd podglądu')
    await expect(openExisting).toBeEnabled()
    await expect(manualForm.getByPlaceholder('Numer FV', { exact: true })).toHaveValue(legacy.invoiceNumber)
    await openExisting.click()
    const summary = page.getByRole('region', { name: 'Istniejąca faktura', exact: true })
    await expect(summary).toBeVisible()
    await expect(summary).toContainText(legacy.invoiceNumber)
    await expect(summary).toContainText(legacy.taxId)
    await expect(summary).toContainText('17,00 PLN')
    await expect(manualForm.getByPlaceholder('Brutto', { exact: true })).toHaveValue('999')
    check(legacyGets.length === 2 && legacyGets[0] === 503 && legacyGets[1] === 200 && legacyPosts.length === 3, 'READ_RETRY_WAS_NOT_GET_ONLY')
    await screenshot('legacy-existing-readonly-summary-after-get-retry')
    await page.unroute(legacyGetPattern)
    page.off('response', recordLegacyResponse)
    const active = await costs()
    check(active.length === 1 && active[0].grossAmount === 369, 'LEGACY_DUPLICATES_CHANGED_ACTIVE_MONEY')
    check(await db.ksefInvoice.count() === beforeDuplicates.invoices + 1 && await db.costEvent.count() === beforeDuplicates.costs
      && await db.invoiceImportDraft.count() === beforeDuplicates.drafts && await db.aiJob.count() === beforeDuplicates.jobs
      && await db.invoiceAttachment.count() === beforeDuplicates.attachments, 'LEGACY_DUPLICATES_CHANGED_EXTRA_RECORDS')
    report.legacyDuplicateProof = { importedInvoiceId: approved.invoiceId, legacyInvoiceId: legacyInvoice.id,
      postStatuses: legacyPosts, getStatuses: legacyGets, activeGrossPln: 369, extraInvoiceUnapproved: true }
    pass('LEGACY_DUPLICATE_FULL_FOREIGN_ID_READONLY_GET_RETRY_NO_NEW_COST_OR_AI')
  }
  check((await db.aiJob.findMany()).every((job) => job.attempts === 0), 'UNEXPECTED_AI_EXECUTION')
  check((await db.$queryRawUnsafe('PRAGMA integrity_check'))[0].integrity_check === 'ok'
    && (await db.$queryRawUnsafe('PRAGMA foreign_key_check')).length === 0, 'DATABASE_INTEGRITY_FAILED')
  check(!report.pageErrors, 'UNCAUGHT_PAGE_ERROR')
  pass('DASHBOARD_RESTART_MOBILE_ORIGINAL_AND_HISTORY_DURABLE_NO_AI')
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.failure = error instanceof Error ? error.message.slice(0, 180) : 'UNKNOWN'
  if (safeUi && page && !page.isClosed()) await screenshot('failure-synthetic-ui').catch(() => {})
  process.stdout.write('FAIL synthetic KSeF UI gate; see private report.\n')
  process.exitCode = 1
} finally {
  await browser?.close().then(() => { report.cleanup.browserClosed = true }, () => { report.cleanup.browserClosed = false })
  await stopServer()
  report.cleanup.serverStopped = !server || server.exitCode !== null || server.signalCode !== null
  await db?.$disconnect()
  if (!report.cleanup.serverStopped || (browser && !report.cleanup.browserClosed)) {
    report.status = 'FAIL'
    report.failure = 'CLEANUP_NOT_CONFIRMED'
    process.exitCode = 1
  }
  process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal)
  await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  await chmod(path.join(artifacts, 'report.json'), 0o600)
  process.stdout.write(`REPORT ${path.join(artifacts, 'report.json')}\n`)
}
