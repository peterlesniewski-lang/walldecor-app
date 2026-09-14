#!/usr/bin/env node
/** Isolated real Next/SQLite EUR acceptance. Importing this module performs no I/O.
 * node --preserve-symlinks --import tsx scripts/validate-invoice-eur-ui.mjs --confirm-synthetic-local
 */
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { invoiceOAuthServerEnvironment, captureSyntheticScreenshot } from './validate-invoice-import-oauth.mjs'
import { invoiceBatchPdfBinaryCandidates, invoiceBatchPdfPluginMatches } from './validate-invoice-batch-oauth.mjs'
import { chatOAuthBrowserLaunchOptions, chatOAuthFixtureUsernames } from './validate-ai-chat-oauth.mjs'

class GateError extends Error { constructor(code) { super(code); this.code = code } }
const check = (condition, code) => { if (!condition) throw new GateError(code) }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const invoiceEurUiFixtureFacts = Object.freeze({
  invoiceNumber: 'SYNTHETIC-EUR-CONVERSION-36020', supplierName: 'SYNTHETIC EUR CONVERSION SUPPLIER',
  taxId: 'DE123456789', issueDate: '2026-09-10', paidAt: '2026-09-14', currency: 'EUR',
  gross: '360.20', net: '360.20', vat: '0.00', paymentStatus: 'PAID',
})
export async function createInvoiceEurUiFixtureBytes() {
  const { jsPDF } = await import('jspdf')
  const facts = invoiceEurUiFixtureFacts
  const pdf = new jsPDF({ compress: false, unit: 'mm', format: 'a4' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18)
  pdf.text('SYNTHETIC TEST INVOICE - EUR', 20, 24)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11)
  pdf.text([
    `Invoice: ${facts.invoiceNumber}`, `Supplier: ${facts.supplierName}`, `Tax ID: ${facts.taxId}`,
    `Issue date: ${facts.issueDate}`, '', 'Service: Synthetic software service - one unit',
    `Net: ${facts.net} ${facts.currency}`, `VAT: ${facts.vat} ${facts.currency}`,
    `Total: ${facts.gross} ${facts.currency}`, 'No VAT charged', '',
    `Payment status: ${facts.paymentStatus}`, `Paid on: ${facts.paidAt}`, '',
    'TEST DATA ONLY - not a real invoice. No legal tax treatment is asserted.',
  ], 20, 40)
  pdf.setFontSize(9); pdf.text('Page 1 of 2 - invoice facts', 20, 282)
  pdf.addPage()
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18)
  pdf.text('SYNTHETIC PAYMENT CONFIRMATION', 20, 24)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(11)
  pdf.text([
    `Invoice: ${facts.invoiceNumber}`, `Supplier: ${facts.supplierName}`, '',
    `Payment status: ${facts.paymentStatus}`, `Paid on: ${facts.paidAt}`,
    `Total: ${facts.gross} ${facts.currency}`, '',
    'The original currency is EUR. No PLN exchange rate is stated here.',
    'The reviewer chooses NBP or a manual rate in the application.',
    'TEST DATA ONLY - no transfer was made.',
  ], 20, 40)
  pdf.setFontSize(9); pdf.text('Page 2 of 2 - payment confirmation', 20, 282)
  return { name: 'synthetic-eur-no-vat-36020.pdf', mimeType: 'application/pdf', pageCount: 2, bytes: Buffer.from(pdf.output('arraybuffer')) }
}
export function parseInvoiceEurUiArgs(args) {
  check(Array.isArray(args) && args.length === 1 && args[0] === '--confirm-synthetic-local', 'SYNTHETIC_LOCAL_CONFIRMATION_REQUIRED')
  return { syntheticLocal: true }
}
export function invoiceEurUiBrowserLaunchOptions(directory) {
  return { ...chatOAuthBrowserLaunchOptions(directory), channel: 'chromium' }
}

export async function runInvoiceEurUiGate(args) {
  // Guard before imports, directories, processes or database access.
  parseInvoiceEurUiArgs(args)
  const [{ chromium, expect }, { default: bcrypt }, { PrismaClient }] = await Promise.all([
    import('@playwright/test'), import('bcryptjs'), import('../src/generated/prisma/index.js'),
  ])
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'wd-eur-ui-')))
  await chmod(directory, 0o700)
  const artifacts = path.join(repository, 'test-results', `invoice-eur-ui-${runId}`)
  await mkdir(artifacts, { recursive: true, mode: 0o700 })
  await chmod(artifacts, 0o700)
  const report = { runId, status: 'RUNNING', stage: 'PREPARE', directory, artifacts,
    scope: 'Synthetic PDF and manually edited EUR values through real UI/API/SQLite. Real historical NBP request is separate from controlled browser race/error responses. No AI/OAuth worker or production data.',
    passed: [], screenshots: [], downloads: [], cleanup: {},
  }
  const pass = (code) => { report.passed.push(code); process.stdout.write(`PASS ${code}\n`) }
  let db, browser, server, page
  let cancelled = false
  let safeUi = false
  const onSignal = () => { cancelled = true; server?.kill('SIGTERM'); void browser?.close() }
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
  const screenshot = (label) => captureSyntheticScreenshot(page, artifacts, label, report.screenshots)
  async function waitFor(predicate, code, timeout = 20_000) {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      check(!cancelled, 'INTERRUPTED')
      const result = await predicate()
      if (result) return result
      await delay(100)
    }
    throw new GateError(code)
  }
  async function stopServer() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return
    const owned = server
    const closed = new Promise((resolve) => owned.once('close', resolve))
    owned.kill('SIGTERM')
    const timer = setTimeout(() => owned.kill('SIGKILL'), 5000)
    try { await closed } finally { clearTimeout(timer) }
  }
  try {
    report.buildId = (await readFile(path.join(repository, '.next/BUILD_ID'), 'utf8')).trim()
    check(/^[\w-]+$/.test(report.buildId), 'FRESH_PRODUCTION_BUILD_REQUIRED')
    async function pdfBinary(name) {
      for (const candidate of invoiceBatchPdfBinaryCandidates(name)) {
        const info = await stat(candidate).catch(() => null)
        if (info?.isFile() && (info.mode & 0o111)) return realpath(candidate)
      }
      throw new GateError('LOCAL_PDF_RENDERER_REQUIRED')
    }
    const [pdfInfoBinary, pdfToPpmBinary] = await Promise.all([pdfBinary('pdfinfo'), pdfBinary('pdftoppm')])
    for (const name of ['originals', 'processing', 'fixtures']) await mkdir(path.join(directory, name), { mode: 0o700 })
    for (const name of ['node_modules', 'public']) await symlink(path.join(repository, name), path.join(directory, name), 'dir')
    const build = path.join(repository, '.next')
    await cp(build, path.join(directory, '.next'), { recursive: true,
      filter: (source) => !['cache', 'standalone'].includes(path.relative(build, source).split(path.sep)[0]) })
    await mkdir(path.join(directory, 'prisma'))
    await cp(path.join(repository, 'prisma/schema.prisma'), path.join(directory, 'prisma/schema.prisma'))
    await cp(path.join(repository, 'prisma/migrations'), path.join(directory, 'prisma/migrations'), { recursive: true })
    const probe = createServer()
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
    const port = probe.address().port
    await new Promise((resolve) => probe.close(resolve))
    const baseUrl = `http://127.0.0.1:${port}`
    const databasePath = path.join(directory, 'synthetic.sqlite')
    const environment = { ...invoiceOAuthServerEnvironment({ databaseUrl: `file:${databasePath}`, baseUrl,
      nextAuthSecret: randomBytes(48).toString('base64url'), workerSecret: randomBytes(48).toString('base64url'),
      originalsDirectory: path.join(directory, 'originals'), processingDirectory: path.join(directory, 'processing'),
    }), INVOICE_PDFINFO_BINARY: pdfInfoBinary, INVOICE_PDFTOPPM_BINARY: pdfToPpmBinary }
    report.baseUrl = baseUrl; report.databasePath = databasePath
    execFileSync('/usr/bin/sqlite3', [databasePath, 'VACUUM;'], { stdio: 'pipe' })
    await chmod(databasePath, 0o600)
    execFileSync(process.execPath, [path.join(repository, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(directory, 'prisma/schema.prisma')],
      { cwd: directory, env: environment, stdio: 'pipe', timeout: 60_000 })
    db = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } })
    const usernames = chatOAuthFixtureUsernames(runId)
    const passwords = { admin: randomBytes(24).toString('base64url'), manager: randomBytes(24).toString('base64url') }
    for (const role of ['admin', 'manager']) await db.user.create({ data: {
      id: usernames[role], username: usernames[role], email: `${usernames[role]}@example.test`, name: `SYNTHETIC ${role.toUpperCase()}`,
      role: role.toUpperCase(), passwordHash: await bcrypt.hash(passwords[role], 10),
    } })
    for (const id of ['JAG', 'PUL', 'GLOBAL']) await db.costCenter.create({ data: { id, name: id } })
    await db.costTagGroup.create({ data: { id: 'behavior', name: 'Charakter', slug: 'behavior' } })
    await db.costTag.create({ data: { id: 'fixed', name: 'Stały', slug: 'fixed', groupId: 'behavior' } })
    // All subsequent database access is read-only. The real app owns every draft,
    // audit, invoice and cost mutation from upload through revocation/archive.
    const fixture = await createInvoiceEurUiFixtureBytes()
    const facts = invoiceEurUiFixtureFacts
    check(fixture?.mimeType === 'application/pdf' && fixture.pageCount === 2, 'TWO_PAGE_EUR_FIXTURE_REQUIRED')
    const fixturePath = path.join(directory, 'fixtures', fixture.name)
    await writeFile(fixturePath, fixture.bytes, { flag: 'wx', mode: 0o600 })
    report.fixture = { name: fixture.name, sha256: sha256(fixture.bytes), byteSize: fixture.bytes.length, pageCount: 2, facts }
    async function startServer() {
      let ready = false
      let failed = false
      server = spawn(process.execPath, [path.join(repository, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'],
        { cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
      server.once('error', () => { failed = true })
      const consume = (chunk) => { if (chunk.toString().includes('Ready in')) ready = true }
      server.stdout.on('data', consume); server.stderr.on('data', consume)
      await waitFor(async () => {
        check(!failed && server.exitCode === null && server.signalCode === null, 'OWNED_NEXT_SERVER_EXITED')
        return ready && await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }).then((response) => response.ok).catch(() => false)
      }, 'OWNED_NEXT_SERVER_UNAVAILABLE')
    }
    await startServer()
    browser = await chromium.launch(invoiceEurUiBrowserLaunchOptions(directory))
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true })
    page = await context.newPage()
    page.setDefaultTimeout(20_000)
    page.on('pageerror', () => { report.pageErrors = (report.pageErrors ?? 0) + 1 })
    async function login(target, role) {
      await target.goto(`${baseUrl}/login`)
      await target.waitForLoadState('networkidle')
      await target.getByLabel('Login', { exact: true }).fill(usernames[role])
      await target.getByLabel('Hasło', { exact: true }).fill(passwords[role])
      await target.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
      await target.waitForURL((url) => !url.pathname.includes('login'))
    }
    report.stage = 'LOGIN_UPLOAD_PREVIEW'
    await login(page, 'admin')
    safeUi = true
    await page.goto(`${baseUrl}/finance/ksef`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Dodaj faktury', exact: true }).click()
    await page.getByLabel('Dodaj faktury', { exact: true }).setInputFiles(fixturePath)
    const stored = await waitFor(() => db.invoiceImportDraft.findFirst({ include: { attachment: true } }), 'UI_UPLOAD_NOT_DURABLE')
    report.draftId = stored.id
    check(stored.attachment.sha256 === report.fixture.sha256 && stored.attachment.pageCount === 2, 'UPLOADED_ORIGINAL_MISMATCH')
    const readDraft = () => db.invoiceImportDraft.findUniqueOrThrow({ where: { id: stored.id } })
    const readData = async () => JSON.parse((await readDraft()).dataJson)
    const activeCosts = () => db.costEvent.findMany({ where: { status: 'APPROVED', documentStatus: 'ACTIVE' } })
    async function assertOneCost(amount) {
      const costs = await activeCosts()
      check(costs.length === 1 && costs[0].grossAmount === amount && costs[0].currency === 'PLN', 'ACTIVE_PLN_COST_MISMATCH')
      check(costs[0].netAmount === amount && costs[0].vatAmount === 0, 'OPERATOR_ENTERED_NET_VAT_CHANGED')
      check(await db.ksefInvoice.count() === 1 && (await readDraft()).invoiceId === costs[0].sourceInvoiceId, 'COST_INVOICE_LINK_MISMATCH')
      return costs[0]
    }
    async function verifyOriginal(stage) {
      const preview = page.getByRole('region', { name: 'Oryginał faktury', exact: true })
      const media = preview.getByTitle(`Oryginał: ${fixture.name}`, { exact: true })
      await expect(media).toBeVisible()
      await expect(media).toHaveAttribute('src', /^blob:/)
      await expect(preview).toContainText('2 str.')
      const blobUrl = await media.getAttribute('src')
      check(await page.evaluate(async (url) => {
        const bytes = await fetch(url).then((response) => response.arrayBuffer())
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('')
      }, blobUrl) === report.fixture.sha256, 'VISIBLE_PDF_BLOB_HASH_MISMATCH')
      const plugin = await waitFor(async () => {
        for (const frame of page.frames()) {
          if (frame.url() !== blobUrl) continue
          const candidate = frame.locator('embed[type="application/x-google-chrome-pdf"]')
          try {
            if (await candidate.count() !== 1) continue
            const metadata = await candidate.evaluate((element) => ({ type: element.getAttribute('type'), originalUrl: element.getAttribute('original-url') }))
            if (invoiceBatchPdfPluginMatches(metadata, blobUrl)) return candidate
          } catch { /* A replaced blob can detach a PDF frame. */ }
        }
        return null
      }, 'NATIVE_PDF_PLUGIN_NOT_VISIBLE')
      await expect(plugin).toBeVisible()
      const download = await Promise.all([page.waitForEvent('download'), preview.getByRole('link', { name: 'Pobierz oryginał', exact: true }).click()]).then(([value]) => value)
      const downloaded = await readFile(await download.path())
      check(downloaded.length === fixture.bytes.length && sha256(downloaded) === report.fixture.sha256, 'DOWNLOADED_ORIGINAL_MISMATCH')
      const retained = path.join(artifacts, `${stage}-original.pdf`)
      await writeFile(retained, downloaded, { flag: 'wx', mode: 0o600 })
      report.downloads.push({ stage, path: retained, sha256: report.fixture.sha256 })
      await screenshot(`${stage}-native-pdf-and-editor`)
    }
    await verifyOriginal('uploaded')
    pass('REAL_UI_UPLOAD_TWO_PAGE_PDF_NATIVE_PREVIEW_DOWNLOAD_HASH')
    report.stage = 'REAL_NBP_AND_MANUAL_SOURCE'
    const field = (label) => page.getByLabel(label, { exact: true })
    async function choice(label, value) {
      await field(label).click()
      await page.getByRole('menuitemradio', { name: value, exact: true }).click()
    }
    await choice('Rodzaj dokumentu', 'Faktura')
    await field('Numer dokumentu').fill(facts.invoiceNumber)
    await field('Nazwa dostawcy').fill(facts.supplierName)
    await field('NIP / identyfikator podatkowy').fill(facts.taxId)
    await field('Data wystawienia').fill(facts.issueDate)
    await field('Waluta').fill(facts.currency)
    await field('Kwota do zapłaty (EUR)').fill(facts.gross.replace('.', ','))
    await choice('Status płatności', 'Zapłacona')
    await page.getByText('Dane szczegółowe', { exact: true }).click()
    await field('Kwota netto').fill(facts.net.replace('.', ','))
    await field('Kwota VAT').fill(facts.vat.replace('.', ','))
    // The operator transcribes the real PDF facts. This is not an AI extraction claim.
    const realNbpResponse = page.waitForResponse((response) => response.url().includes('/invoice-import/exchange-rate?paymentDate=2026-09-14') && response.request().method() === 'GET')
    await field('Data zapłaty (opcjonalnie)').fill(facts.paidAt)
    const nbpResponse = await realNbpResponse
    check(nbpResponse.status() === 200, 'REAL_NBP_LOOKUP_UNAVAILABLE')
    const actualQuote = (await nbpResponse.json()).quote
    check(actualQuote?.currency === 'EUR' && actualQuote.paymentDate === '2026-09-14' && actualQuote.rate === '4.3228'
      && actualQuote.rateDate === '2026-09-11' && actualQuote.tableNumber === '177/A/NBP/2026', 'REAL_HISTORICAL_NBP_QUOTE_MISMATCH')
    report.actualNbp = actualQuote
    await expect(field('Brutto w PLN')).toHaveValue('1557.07')
    await expect(field('Netto w PLN')).toHaveValue('1557.07')
    await expect(field('VAT w PLN')).toHaveValue('0')
    await screenshot('eur-real-nbp-amount-rate-pln')
    pass('REAL_NBP_EUR_20260914_TABLE177_RATE43228')

    report.stage = 'CONTROLLED_BROWSER_RACES'
    let scenario = 'ERROR'
    const held = []
    const pattern = '**/api/finance/invoice-import/exchange-rate?*'
    await page.route(pattern, async (route) => {
      const requestedDate = new URL(route.request().url()).searchParams.get('paymentDate')
      if (scenario === 'ERROR') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'NBP_UNAVAILABLE', error: 'NBP jest chwilowo niedostępny. Przelicz ręcznie.' }) })
      const quote = requestedDate === '2026-09-11'
        ? { ...actualQuote, paymentDate: requestedDate, rate: '4.25', rateDate: '2026-09-10', tableNumber: '176/A/NBP/2026' } : actualQuote
      if (requestedDate === '2026-09-14') return new Promise((resolve) => {
        held.push(async () => {
          // Abort is an expected successful fence when the UI changes basis.
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quote }) }).catch(() => {})
          resolve()
        })
      })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quote }) })
    })
    await page.getByRole('button', { name: 'Kurs NBP', exact: true }).click()
    await expect(page.getByText('Nie udało się pobrać kursu NBP. Spróbuj ponownie lub wpisz kurs ręcznie.', { exact: true })).toBeVisible()
    scenario = 'DELAY'
    await page.getByRole('button', { name: 'Ponów pobranie kursu', exact: true }).click()
    await waitFor(() => held.length === 1, 'DELAYED_NBP_REQUEST_MISSING')
    await page.getByRole('button', { name: 'Wpisz kurs ręcznie', exact: true }).click()
    await field('1 EUR = … PLN').fill('4,25')
    await held.shift()()
    await expect(field('Brutto w PLN')).toHaveValue('1530.85')
    await expect(field('1 EUR = … PLN')).toHaveValue('4,25')
    await page.getByRole('button', { name: 'Wróć do kursu NBP', exact: true }).click()
    await waitFor(() => held.length === 1, 'SECOND_DELAYED_NBP_REQUEST_MISSING')
    await field('Data zapłaty (opcjonalnie)').fill('2026-09-11')
    await expect(field('1 EUR = … PLN')).toHaveValue('4.25')
    await held.shift()()
    await expect(field('1 EUR = … PLN')).toHaveValue('4.25')
    await expect(page.getByText(/Tabela 176\/A\/NBP\/2026/)).toBeVisible()
    await page.unroute(pattern)
    pass('CONTROLLED_NBP_ERROR_MANUAL_FALLBACK_AND_OLD_DATE_RESPONSE_FENCES')

    report.stage = 'MANUAL_SAVE_REOPEN_APPROVE'
    await page.getByRole('button', { name: 'Wpisz kurs ręcznie', exact: true }).click()
    await field('Data zapłaty (opcjonalnie)').fill(facts.paidAt)
    await field('1 EUR = … PLN').fill('4,25')
    await expect(field('Brutto w PLN')).toHaveValue('1530.85')
    await screenshot('eur-manual-rate-36020-times-425')
    await field('Brutto w PLN').fill('1500,00')
    await field('Netto w PLN').fill('1500,00')
    await field('VAT w PLN').fill('0')
    await expect(page.getByRole('button', { name: 'Kwota PLN ręcznie', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(field('Podstawa i uwaga do przeliczenia')).toHaveValue(/Kwota PLN ustalona ręcznie/)
    await choice('Miejsce kosztu', 'JAG')
    await page.getByRole('button', { name: 'Stały', exact: true }).click()
    await page.getByRole('checkbox', { name: /Potwierdzam przeliczenie/ }).check()
    await page.getByRole('button', { name: 'Zapisz szkic', exact: true }).click()
    await waitFor(async () => {
      const data = await readData()
      return data.reportingGross === 1500 && data.reportingNet === 1500 && data.reportingVat === 0 && data.conversionConfirmed === true
        && data.conversion?.mode === 'MANUAL_AMOUNT' && data.conversion.rate === null && data.conversion.rateDate === null && data.conversion.tableNumber === null
    }, 'MANUAL_CONVERSION_SAVE_NOT_DURABLE')
    check((await activeCosts()).length === 0, 'SAVE_CREATED_COST')
    await page.getByRole('button', { name: 'Wróć do faktur', exact: true }).click()
    async function openDocument(approved = false) {
      await page.goto(`${baseUrl}/finance/ksef`)
      await page.waitForLoadState('networkidle')
      if (approved) {
        await page.getByRole('row').filter({ hasText: facts.invoiceNumber }).getByRole('button', { name: 'Otwórz dokument', exact: true }).click()
      } else {
        await page.getByRole('button', { name: 'Dodaj faktury', exact: true }).click()
        await page.getByRole('complementary', { name: 'Dokumenty importu', exact: true }).getByRole('button').filter({ hasText: facts.invoiceNumber }).click()
      }
      await expect(page.getByRole('heading', { name: 'Płatność EUR · koszt w PLN', exact: true })).toBeVisible()
    }
    await openDocument()
    await expect(field('Brutto w PLN')).toHaveValue('1500')
    await expect(field('Netto w PLN')).toHaveValue('1500')
    await expect(field('VAT w PLN')).toHaveValue('0')
    await expect(page.getByRole('checkbox', { name: /Potwierdzam przeliczenie/ })).toBeChecked()
    await page.getByRole('button', { name: 'Zatwierdź i następna', exact: true }).click()
    await waitFor(async () => (await activeCosts()).length === 1, 'APPROVAL_NOT_DURABLE')
    const cost = await assertOneCost(1500)
    report.approved = { costEventId: cost.id, invoiceId: cost.sourceInvoiceId, grossPln: 1500, netPln: 1500, vatPln: 0 }
    pass('MANUAL_RATE_FINAL_PLN_OVERRIDE_SAVE_REOPEN_APPROVE_ONE_REAL_1500_COST')

    report.stage = 'RESTART_ORIGINAL_AND_REVOKE'
    await stopServer()
    await startServer()
    await openDocument(true)
    await assertOneCost(1500)
    await expect(field('Brutto w PLN')).toHaveValue('1500')
    await expect(field('Brutto w PLN')).toBeDisabled()
    await verifyOriginal('after-restart')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Dane', exact: true }).click()
    await page.getByRole('heading', { name: 'Płatność EUR · koszt w PLN', exact: true }).scrollIntoViewIfNeeded()
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'EUR_PANEL_MOBILE_OVERFLOW')
    await screenshot('eur-mobile-after-restart')
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.getByRole('button', { name: 'Cofnij z kosztów', exact: true }).click()
    await waitFor(async () => (await activeCosts()).length === 0, 'REVOKE_NOT_DURABLE')
    await page.getByRole('button', { name: 'Archiwizuj szkic', exact: true }).click()
    await waitFor(async () => (await readDraft()).state === 'ARCHIVED', 'ARCHIVE_NOT_DURABLE')
    check(await db.costEvent.count() === 1 && await db.ksefInvoice.count() === 1, 'REVOKE_ARCHIVE_DESTROYED_HISTORY')
    pass('SAME_PRIVATE_DB_RESTART_PERSISTED_VALUES_ORIGINAL_REVOKE_ARCHIVE')

    report.stage = 'OTHER_ROLE_AUTHORITY'
    const otherContext = await browser.newContext()
    const otherPage = await otherContext.newPage()
    await login(otherPage, 'manager')
    const forbidden = await otherContext.request.get(`${baseUrl}/api/finance/invoice-import/exchange-rate?paymentDate=2026-09-14`)
    const forbiddenApproval = await otherContext.request.post(`${baseUrl}/api/finance/invoice-import/drafts/${stored.id}/approve`, { data: { expectedVersion: (await readDraft()).version, idempotencyKey: randomUUID() } })
    check(forbidden.status() === 403 && forbiddenApproval.status() === 403, 'MANAGER_AUTHORITY_LEAK')
    check((await activeCosts()).length === 0 && await db.costEvent.count() === 1, 'FORBIDDEN_REQUEST_CHANGED_COST')
    await otherContext.close()
    check((await db.aiJob.findMany()).every((job) => job.attempts === 0), 'UNEXPECTED_AI_EXECUTION')
    check((await db.$queryRawUnsafe('PRAGMA integrity_check'))[0].integrity_check === 'ok'
      && (await db.$queryRawUnsafe('PRAGMA foreign_key_check')).length === 0, 'DATABASE_INTEGRITY_FAILED')
    check(!report.pageErrors, 'UNCAUGHT_UI_ERROR')
    pass('OTHER_ROLE_403_NO_COST_AUTHORITY_NO_AI_DATABASE_INTEGRITY')
    report.status = 'PASS'
  } catch (error) {
    report.status = 'FAIL'
    // Never serialize Playwright call logs: they may contain random credentials.
    report.failure = error instanceof GateError ? error.code : 'UI_OR_LOCAL_RUNTIME_FAILURE'
    if (safeUi && page && !page.isClosed()) await screenshot('failure-synthetic-ui').catch(() => {})
    process.stdout.write(`FAIL ${report.stage}: ${report.failure}\n`)
    process.exitCode = 1
  } finally {
    await browser?.close().then(() => { report.cleanup.browserClosed = true }, () => { report.cleanup.browserClosed = false })
    await stopServer()
    report.cleanup.serverStopped = !server || server.exitCode !== null || server.signalCode !== null
    await db?.$disconnect()
    if (!report.cleanup.serverStopped || (browser && !report.cleanup.browserClosed)) {
      report.status = 'FAIL'; report.failure = 'CLEANUP_NOT_CONFIRMED'; process.exitCode = 1
    }
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal)
    await writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    await chmod(path.join(artifacts, 'report.json'), 0o600)
    process.stdout.write(`REPORT ${path.join(artifacts, 'report.json')}\n`)
  }
  return report
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runInvoiceEurUiGate(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof GateError ? error.code : 'EUR_UI_GATE_FAILED'}\n`)
    process.exitCode = 1
  })
}
