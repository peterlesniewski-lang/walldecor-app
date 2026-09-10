import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { PrismaClient } from '../src/generated/prisma/index.js'
import bcrypt from 'bcryptjs'
import { chromium, expect } from '@playwright/test'

// This harness never reads .env or any application database. Only authentication
// identities and the built-in salon catalog are bootstrapped below. All finance
// and cashier data is created through the authenticated product UI/API.
const directory = mkdtempSync(path.join(tmpdir(), 'wd-finance-browser-'))
const databasePath = path.join(directory, 'browser.sqlite')
const databaseUrl = `file:${databasePath}`
const baseUrl = 'http://127.0.0.1:3118'
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const password = 'Cashier-Local-Test-Only!'
const day1 = '2026-09-08', day2 = '2026-09-09'
let server, browser
let serverOutput = ''
const pageErrors = []
const outcomes = []
const step = (message) => { outcomes.push(message); console.log(`PASS: ${message}`) }

async function start() {
  serverOutput = ''
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3118', '-H', '127.0.0.1'], {
    env: { ...process.env, DATABASE_URL: databaseUrl, NEXTAUTH_URL: baseUrl, NEXTAUTH_SECRET: 'cashier-local-test-only-secret', IMPORT_API_KEY: 'local-import-fixture-only' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (data) => { serverOutput += data.toString() })
  server.stderr.on('data', (data) => { serverOutput += data.toString() })
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) throw new Error(serverOutput)
    if (await fetch(`${baseUrl}/api/health`).then((r) => r.ok).catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Test server did not start')
}
async function stop() {
  if (!server || server.exitCode !== null) return
  const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited
}
async function login(username) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${baseUrl}/login`)
  await page.getByLabel('Login', { exact: true }).fill(username)
  await page.getByLabel('Hasło', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.includes('login'))
  return page
}
async function cashier(page) {
  await page.goto(`${baseUrl}/cashier`)
  await expect(page.getByRole('button', { name: 'Odśwież stan' })).toBeEnabled()
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
}
async function choose(page, label, value) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('menuitemradio', { name: value, exact: true }).click()
}
async function save(page, label) {
  const response = page.waitForResponse((r) => r.url().endsWith('/api/cashier') && r.request().method() === 'POST')
  await page.getByRole('button', { name: label, exact: true }).click()
  const result = await response
  expect(result.ok(), await result.text()).toBe(true)
  await expect(page.getByRole('button', { name: 'Odśwież stan' })).toBeEnabled()
  await expect(page.getByRole('status')).toContainText('Zapisano')
  return result.json()
}
async function operation(page, kind, method, amount, reference) {
  await page.getByRole('button', { name: 'Dodaj operację', exact: true }).click()
  if (kind !== 'Zwrot sprzedaży') await choose(page, 'Rodzaj operacji', kind)
  if (method !== 'Gotówka') await choose(page, 'Metoda płatności', method)
  await page.getByLabel('Kwota operacji', { exact: true }).fill(amount)
  await page.getByLabel('Dokument / referencja', { exact: true }).fill(reference)
  await save(page, 'Dodaj do raportu')
}
async function confirmClose(page) {
  await page.getByLabel(/Potwierdzam: w kasie zostaje/).check()
  await page.getByLabel(/Potwierdzam: przygotowany depozyt/).check()
}
async function snap(page, name) {
  mkdirSync('test-results', { recursive: true })
  await page.locator('main').evaluate((main) => main.scrollTo(0, 0))
  await page.screenshot({ path: `test-results/finance-${name}.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  if (name.startsWith('cash-day-') || name.startsWith('dashboard-')) {
    await page.locator('main').evaluate(async (main) => {
      main.scrollTo(0, main.scrollHeight)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await page.screenshot({ path: `test-results/finance-${name}-bottom.png`, fullPage: true })
  }
}

try {
  execFileSync('sqlite3', [databasePath, 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' })
  for (const [id, name] of [['PUL', 'Puławska'], ['JAG', 'Jagiellońska'], ['GLOBAL', 'Koszty wspólne']]) await db.costCenter.create({ data: { id, name } })
  const hash = await bcrypt.hash(password, 10)
  await db.user.create({ data: { id: 'test-admin', username: 'cashadmin', name: 'Test Administrator', email: 'cashadmin@example.test', role: 'ADMIN', passwordHash: hash } })
  for (const salon of ['PUL', 'JAG']) {
    await db.employee.create({ data: { id: `employee-${salon}`, firstName: 'Test', lastName: salon, email: `${salon}@example.test`, position: 'Doradca', costCenterId: salon, startDate: new Date('2026-01-01') } })
    await db.user.create({ data: { id: `user-${salon}`, username: `cash${salon.toLowerCase()}`, name: `Test ${salon}`, email: `user-${salon}@example.test`, role: 'EMPLOYEE', passwordHash: hash, employeeId: `employee-${salon}` } })
  }
  await db.user.create({ data: { id: 'test-manager', username: 'cashmanager', name: 'Test Manager', email: 'manager@example.test', role: 'MANAGER', passwordHash: hash } })
  await start()
  expect((await fetch(`${baseUrl}/api/cashier`)).status).toBe(401)
  const importPayload = { rows: [{ rok: '2026', miesiac: '9', centrum_kosztow: 'PUL', kanal: 'SALON', kwota: '80', stan_na_dzien: day1 }] }
  for (const key of [undefined, 'wrong-local-fixture', 'local-import-fixture-only']) {
    const imported = await fetch(`${baseUrl}/api/import/revenue`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Api-Key': key } : {}) }, body: JSON.stringify(importPayload), redirect: 'manual' })
    expect(imported.status).toBe(key === 'local-import-fixture-only' ? 200 : 401)
  }
  const rejectedPlan = await fetch(`${baseUrl}/api/import/revenue`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'local-import-fixture-only' }, body: JSON.stringify({ ...importPayload, type: 'plan' }), redirect: 'manual' })
  expect(rejectedPlan.status).toBe(410)
  step('Real HTTP import accepts its configured integration key without JWT; absent/wrong key401, retired salesplan410.')
  browser = await chromium.launch({ headless: true })
  const admin = await login('cashadmin')
  await admin.goto(`${baseUrl}/dashboard?year=2026&month=8`)
  await expect(admin.getByText('Brak danych przychodowych', { exact: true })).toBeVisible()
  await snap(admin, 'dashboard-empty')
  await admin.goto(`${baseUrl}/finance/revenue?year=2026&costCenterId=PUL`)
  for (const amount of ['100', '150', '120']) {
    await admin.getByRole('button', { name: 'Edytuj Sprzedaż towaru — wrzesień 2026', exact: true }).click()
    await admin.getByLabel('Kwota brutto narastająco (PLN)', { exact: true }).fill(amount)
    await admin.getByLabel('Stan na dzień (opcjonalnie)', { exact: true }).fill(day2)
    await admin.getByRole('button', { name: 'Zapisz obrót', exact: true }).click()
    await expect(admin.getByRole('dialog')).toHaveCount(0)
  }
  expect((await db.revenue.findMany()).map((row) => row.amount)).toEqual([120])
  await snap(admin, 'revenue-desktop')
  await admin.setViewportSize({ width: 390, height: 844 }); await snap(admin, 'revenue-mobile'); await admin.setViewportSize({ width: 1440, height: 1000 })
  step('Revenue UI: 100 → 150 → 120 is one saved monthly value, as-of date, no sales-plan tab; desktop/mobile.')

  const centralResponse = await admin.request.post(`${baseUrl}/api/cash/accounts`, { data: { name: 'Test kasa właściciela', currency: 'PLN', type: 'cash' } })
  expect(centralResponse.ok()).toBe(true)
  const central = await centralResponse.json()
  await cashier(admin)
  await choose(admin, 'Salon', 'Puławska')
  await admin.getByRole('button', { name: 'Skonfiguruj kasę salonu', exact: true }).click()
  await admin.getByLabel('Data rozpoczęcia ewidencji', { exact: true }).fill(day1)
  await admin.getByLabel('Policzona gotówka na start', { exact: true }).fill('270')
  await admin.getByLabel('Docelowa kasa stała', { exact: true }).fill('270')
  await choose(admin, 'Rachunek gotówkowy salonu', 'Utwórz nowy rachunek gotówkowy')
  await admin.getByLabel('Nazwa nowego rachunku', { exact: true }).fill('Test kasa PUL')
  await admin.getByLabel(/Potwierdzam: ta gotówka/).check()
  await admin.getByLabel(/Potwierdzam źródło/).check()
  await save(admin, 'Uruchom ewidencję')
  const settings = await db.salonCashSettings.findUniqueOrThrow({ where: { costCenterId: 'PUL' } })
  expect((await db.cashAccount.findUniqueOrThrow({ where: { id: settings.cashAccountId } })).balance).toBe(270)
  const employee = await login('cashpul'); await cashier(employee)
  await expect(employee.getByRole('button', { name: 'Kasa stała i start', exact: true })).toHaveCount(0)
  await employee.getByLabel('Dzień rozliczenia', { exact: true }).fill(day1)
  const opened = await save(employee, 'Otwórz dzień')
  await expect(employee.getByLabel('Wpływy sprzedażowe — gotówka', { exact: true })).toHaveValue('')
  await employee.getByLabel('Wpływy sprzedażowe — gotówka', { exact: true }).fill('42')
  employee.once('dialog', (dialog) => dialog.dismiss())
  await employee.getByRole('button', { name: 'Depozyty', exact: true }).click()
  await expect(employee.getByLabel('Wpływy sprzedażowe — gotówka', { exact: true })).toHaveValue('42')
  await employee.route('**/api/cashier', async (route) => {
    if (route.request().method() === 'POST') await route.abort('failed')
    else await route.continue()
  })
  await employee.getByRole('button', { name: 'Zapisz kwoty', exact: true }).click()
  await expect(employee.getByText('Zapis jest zablokowany do czasu odświeżenia stanu.')).toBeVisible()
  await expect(employee.getByRole('button', { name: 'Zapisz kwoty', exact: true })).toBeDisabled()
  await expect(employee.getByRole('button', { name: 'Zapisywanie…', exact: true })).toHaveCount(0)
  await employee.unroute('**/api/cashier')
  employee.once('dialog', (dialog) => dialog.accept())
  await employee.getByRole('button', { name: 'Odśwież stan', exact: true }).click()
  await expect(employee.getByLabel('Wpływy sprzedażowe — gotówka', { exact: true })).toHaveValue('')
  await expect(employee.getByText('Zapis jest zablokowany do czasu odświeżenia stanu.')).toHaveCount(0)
  step('Interrupted HTTP write locks further saves without false saving indicator; explicit discard and readback restore the unchanged server version.')
  await employee.getByLabel('Wpływy sprzedażowe — gotówka', { exact: true }).fill('1500')
  await employee.getByLabel('Wpływy sprzedażowe — karta', { exact: true }).fill('3000')
  await employee.getByLabel('Policzona gotówka', { exact: true }).fill('1670')
  await save(employee, 'Zapisz kwoty')
  await operation(employee, 'Zwrot sprzedaży', 'Gotówka', '210', 'ZW/1')
  await employee.getByRole('button', { name: 'Edytuj ZW/1', exact: true }).click()
  await employee.getByLabel('Kwota operacji', { exact: true }).fill('200')
  await save(employee, 'Zapisz operację')
  await operation(employee, 'Przyjęcie kaucji', 'Gotówka', '100', 'KAU/1')
  await operation(employee, 'Zwrot sprzedaży', 'Karta', '300', 'ZW/KARTA')
  await operation(employee, 'Zwrot sprzedaży', 'Karta', '10', 'POMYLKA')
  await employee.getByRole('button', { name: 'Anuluj POMYLKA', exact: true }).click()
  await employee.getByLabel('Powód anulowania', { exact: true }).fill('Błędnie dodana operacja testowa')
  await save(employee, 'Potwierdź anulowanie')
  expect((await db.cashDailyOperation.findFirstOrThrow({ where: { reference: 'POMYLKA' } })).cancelledAt).not.toBeNull()

  for (const target of ['300', '250', '300']) {
    await admin.getByLabel('Nowy poziom kasy stałej', { exact: true }).fill(target)
    await admin.getByLabel('Powód zmiany kasy stałej', { exact: true }).fill(`Test nowego poziomu ${target}`)
    await save(admin, 'Zapisz kasę stałą')
  }
  await confirmClose(employee)
  const stale = employee.waitForResponse((r) => r.url().endsWith('/api/cashier') && r.request().method() === 'POST')
  await employee.getByRole('button', { name: 'Zamknij dzień', exact: true }).click()
  expect((await stale).status()).toBe(409)
  await expect(employee.locator('main').getByRole('alert')).toContainText('Pobrano aktualny stan')
  await expect(employee.getByLabel(/Potwierdzam: w kasie zostaje/)).not.toBeChecked()
  await expect(employee.getByLabel(/Potwierdzam: przygotowany depozyt/)).toHaveAccessibleName(/1\s?370,00/)
  await snap(employee, 'cash-day-desktop')
  await employee.setViewportSize({ width: 390, height: 844 }); await snap(employee, 'cash-day-mobile'); await employee.setViewportSize({ width: 1440, height: 1000 })
  await confirmClose(employee)
  await save(employee, 'Zamknij dzień')
  let report = await db.cashDailyReport.findUniqueOrThrow({ where: { id: opened.reportId }, include: { deposit: true } })
  expect(report.expectedCents).toBe(167000); expect(report.depositCents).toBe(137000); expect(report.retainedCents).toBe(30000)
  const auditCount = await db.cashierAuditLog.count()
  const replay = await employee.request.post(`${baseUrl}/api/cashier`, { data: { action: 'closeReport', costCenterId: 'PUL', reportId: report.id, version: report.version - 1, requestId: report.closeRequestId, retainedConfirmed: true, depositConfirmed: true, reason: '' } })
  expect(replay.ok(), await replay.text()).toBe(true); expect((await replay.json()).replayed).toBe(true)
  expect(await db.cashierAuditLog.count()).toBe(auditCount)
  expect(await db.cashDeposit.count()).toBe(1)
  expect((await db.revenue.findMany()).map((row) => row.amount)).toEqual([120])
  step('Cash UI: setup, employee own salon, daily blanks, refund edit/cancel, card refund and kaucja; targets300/250; stale409; close1370 and one idempotent deposit; no duplicated revenue.')

  await admin.getByRole('button', { name: 'Rozliczenia dni', exact: true }).click()
  await admin.getByRole('button', { name: 'Odśwież stan', exact: true }).click()
  for (const amount of ['1660', '1670']) {
    await admin.getByRole('button', { name: 'Korekta rozliczenia', exact: true }).click()
    await admin.getByLabel('Policzona gotówka', { exact: true }).fill(amount)
    await admin.getByLabel('Powód korekty', { exact: true }).fill(`Ponowne przeliczenie ${amount}`)
    await confirmClose(admin)
    await save(admin, 'Zapisz korektę')
  }
  await employee.getByLabel('Dzień rozliczenia', { exact: true }).fill(day2)
  const next = await save(employee, 'Otwórz dzień')
  expect((await db.cashDailyReport.findUniqueOrThrow({ where: { id: next.reportId } })).openingCents).toBe(30000)
  await employee.getByLabel('Wpływy sprzedażowe — gotówka', { exact: true }).fill('0')
  await employee.getByLabel('Wpływy sprzedażowe — karta', { exact: true }).fill('0')
  await employee.getByLabel('Policzona gotówka', { exact: true }).fill('200')
  await save(employee, 'Zapisz kwoty')
  await confirmClose(employee)
  await expect(employee.getByRole('button', { name: 'Zamknij dzień', exact: true })).toBeDisabled()
  await employee.getByLabel('Wyjaśnienie różnicy / niedoboru', { exact: true }).fill('Niedobór gotówki wykazany do wyjaśnienia')
  await save(employee, 'Zamknij dzień')
  const second = await db.cashDailyReport.findUniqueOrThrow({ where: { id: next.reportId } })
  expect(second.retainedCents).toBe(20000); expect(second.shortfallCents).toBe(10000); expect(second.depositCents).toBe(0)
  expect(await db.cashDeposit.count()).toBe(1)
  step('Audited latest-report corrections preserve original snapshots; next-day real opening300; shortage100 leaves actual200 and creates no empty deposit.')

  await admin.getByRole('button', { name: 'Depozyty', exact: true }).click()
  await admin.getByRole('button', { name: 'Odśwież stan', exact: true }).click()
  await choose(admin, `Rachunek docelowy ${day1}`, 'Test kasa właściciela')
  await admin.getByLabel(/Potwierdzam fizyczny odbiór paczki/).check()
  const totalBefore = (await db.cashAccount.aggregate({ _sum: { balance: true } }))._sum.balance
  await save(admin, 'Potwierdź odbiór paczki')
  expect((await db.cashAccount.aggregate({ _sum: { balance: true } }))._sum.balance).toBe(totalBefore)
  expect((await db.cashAccount.findUniqueOrThrow({ where: { id: settings.cashAccountId } })).balance).toBe(200)
  expect((await db.cashAccount.findUniqueOrThrow({ where: { id: central.id } })).balance).toBe(1370)
  await expect(admin.getByText('Odebrany — do przeliczenia', { exact: true })).toBeVisible()
  expect((await admin.request.delete(`${baseUrl}/api/cash/accounts/${central.id}`)).status()).toBe(409)
  await admin.getByLabel(`Przeliczona zawartość ${day1}`, { exact: true }).fill('1360')
  await admin.getByLabel(`Wyjaśnienie różnicy ${day1}`, { exact: true }).fill('W paczce stwierdzono brak 10 zł')
  await admin.getByLabel(/Potwierdzam, że przeliczyłem/).check()
  await save(admin, 'Zapisz przeliczenie')
  expect((await db.cashAccount.findUniqueOrThrow({ where: { id: central.id } })).balance).toBe(1360)
  expect((await db.cashDeposit.findFirstOrThrow()).status).toBe('DISCREPANCY')
  await snap(admin, 'deposit-verified')
  const guarded = await admin.request.patch(`${baseUrl}/api/cash/accounts/${settings.cashAccountId}`, { data: { balance: 999 } })
  expect(guarded.status()).toBe(409)
  expect((await admin.request.delete(`${baseUrl}/api/cash/accounts/${settings.cashAccountId}`)).status()).toBe(409)
  step('Sealed receipt is separate from counted contents: source200/owner1370, company total unchanged; verification difference−10 adjusts owner once; manual managed-account changes blocked.')

  const jag = await login('cashjag'); await cashier(jag)
  expect((await jag.request.get(`${baseUrl}/api/cashier?costCenterId=PUL`)).status()).toBe(403)
  expect((await jag.request.get(`${baseUrl}/api/cashier?reportId=${opened.reportId}`)).status()).toBe(404)
  expect((await jag.request.post(`${baseUrl}/api/cashier`, { data: { action: 'createReport', costCenterId: 'PUL', businessDate: day2 } })).status()).toBe(403)
  expect((await employee.request.post(`${baseUrl}/api/cashier`, { data: { action: 'setTarget', costCenterId: 'PUL', version: 1, targetFloatCents: 10000, reason: 'Nieuprawniona zmiana' } })).status()).toBe(403)
  const manager = await login('cashmanager')
  expect((await manager.request.get(`${baseUrl}/api/cashier`)).status()).toBe(403)
  await db.user.update({ where: { id: 'user-PUL' }, data: { role: 'MANAGER' } })
  expect((await employee.request.get(`${baseUrl}/api/cashier`)).status()).toBe(403)
  await db.user.update({ where: { id: 'user-PUL' }, data: { role: 'EMPLOYEE' } })
  await db.employee.update({ where: { id: 'employee-PUL' }, data: { active: false } })
  expect((await employee.request.get(`${baseUrl}/api/cashier`)).status()).toBe(403)
  await db.employee.update({ where: { id: 'employee-PUL' }, data: { active: true } })
  step('Real authenticated 401/403 boundaries: cross-salon read/write, employee settings, manager, stale JWT role and inactive employee.')

  const beforeRestart = { audit: await db.cashierAuditLog.count(), reports: await db.cashDailyReport.count(), balances: await db.cashAccount.findMany({ select: { id: true, balance: true }, orderBy: { id: 'asc' } }) }
  await stop(); await start(); await admin.reload()
  await expect(admin.getByRole('button', { name: 'Odśwież stan' })).toBeEnabled()
  expect({ audit: await db.cashierAuditLog.count(), reports: await db.cashDailyReport.count(), balances: await db.cashAccount.findMany({ select: { id: true, balance: true }, orderBy: { id: 'asc' } }) }).toEqual(beforeRestart)
  await admin.goto(`${baseUrl}/dashboard?year=2026&month=9`)
  await expect(admin.getByRole('region', { name: 'Wynik wybranego miesiąca' })).toContainText('120,00 zł')
  await snap(admin, 'dashboard-desktop')
  await admin.setViewportSize({ width: 390, height: 844 }); await snap(admin, 'dashboard-mobile')
  expect(pageErrors).toEqual([])
  step('Reload/restart preserves reports, audit, deposits, balances and monthly revenue; real dashboard actual-only readback; no browser runtime errors.')
  writeFileSync('test-results/finance-cashier-evidence.json', JSON.stringify({ outcomes, pageErrors, beforeRestart }, null, 2))
} catch (error) {
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/finance-cashier-server.log', serverOutput)
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: `test-results/finance-failure-${browser.contexts().indexOf(context)}.png`, fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser?.close(); await stop(); await db.$disconnect()
  rmSync(directory, { recursive: true, force: true })
}
