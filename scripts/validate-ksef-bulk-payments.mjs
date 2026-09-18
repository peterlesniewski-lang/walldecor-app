import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { PrismaClient } from '../src/generated/prisma/index.js'
import bcrypt from 'bcryptjs'
import { chromium, expect } from '@playwright/test'

const directory = mkdtempSync(path.join(tmpdir(), 'ksef-browser-'))
const databasePath = path.join(directory, 'browser.db')
const databaseUrl = `file:${databasePath}`
const baseUrl = 'http://127.0.0.1:3117'
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const password = 'Ksef-Test-Only-2026!'
let server
let browser
let serverOutput = ''
const pageErrors = []
async function start() {
  serverOutput = ''
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3117', '-H', '127.0.0.1'], {
    env: { ...process.env, DATABASE_URL: databaseUrl, NEXTAUTH_URL: baseUrl, NEXTAUTH_SECRET: 'ksef-local-browser-test-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (data) => { serverOutput += data.toString() })
  server.stderr.on('data', (data) => { serverOutput += data.toString() })
  for (let i = 0; i < 100; i++) {
    if (server.exitCode != null) throw new Error(serverOutput)
    if (await fetch(`${baseUrl}/api/health`).then((r) => r.ok).catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Test server did not start')
}
async function stop() {
  if (!server || server.exitCode != null) return
  const exited = once(server, 'exit')
  server.kill('SIGTERM')
  await exited
}
try {
  execFileSync('sqlite3', [databasePath, 'VACUUM;'])
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' })
  await db.user.create({ data: { username: 'kseftest', name: 'KSeF Test', email: 'ksef@example.test', role: 'ADMIN', passwordHash: await bcrypt.hash(password, 10) } })
  await db.costCenter.create({ data: { id: 'GLOBAL', name: 'Koszty centralne' } })
  await db.costTagGroup.create({ data: { id: 'role', name: 'Typ wydatku', slug: 'role', tags: { create: [
    { id: 'goods', name: 'Zakup towarów i materiałów', slug: 'goods' }, { id: 'services', name: 'Usługi', slug: 'services' },
  ] } } })
  const amounts = [1194.23, 1567.13, 1555.21, 1125.45, 2951.67]
  for (let i = 0; i < 55; i++) {
    await db.ksefInvoice.create({ data: {
      id: `invoice-${i}`, invoiceNumber: `TEST/${String(i).padStart(3, '0')}`,
      supplierName: 'Dostawca testowy', supplierNip: '0000000000',
      grossAmount: amounts[i] ?? 100, currency: i === 7 ? 'EUR' : 'PLN',
      issueDate: new Date('2026-09-01T12:00:00Z'), dueDate: new Date('2026-09-15T12:00:00Z'),
      status: i === 6 ? 'NEW' : 'APPROVED', paymentStatus: i === 5 ? 'PAID' : 'UNPAID',
      paidAt: i === 5 ? new Date('2026-08-20T12:00:00Z') : null, costCenterId: 'GLOBAL',
      parts: { create: { label: 'Cała faktura', grossAmount: amounts[i] ?? 100,
        tags: { create: { tagId: 'goods' } }, allocations: { create: { costCenterId: 'GLOBAL', percent: 100 } },
      } },
    } })
  }
  for (const month of ['08', '10']) {
    await db.ksefInvoice.create({ data: { id: `outside-${month}`, invoiceNumber: `OUTSIDE/${month}`,
      supplierName: 'Inny okres', issueDate: new Date(`2026-${month}-01T00:00:00Z`), grossAmount: 50, status: 'APPROVED',
    } })
  }
  await start()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1512, height: 982 } })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${baseUrl}/login`)
  await page.getByLabel('Login', { exact: true }).fill('kseftest')
  await page.getByLabel('Hasło', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click()
  await page.waitForURL('**/dashboard')
  await page.goto(`${baseUrl}/finance/ksef`)
  const bar = page.getByRole('region', { name: 'Zaznaczone faktury' })
  await expect(bar).toContainText('Zaznaczono: 0')
  await page.getByLabel('Zaznacz wszystkie faktury na stronie').check()
  await expect(bar).toContainText('Zaznaczono: 50')
  await expect(bar).toContainText('100,00 EUR')
  await page.getByTitle('Następna strona').first().click()
  await expect(bar).toContainText('Zaznaczono: 0')
  await page.getByTitle('Poprzednia strona').first().click()
  for (let i = 0; i < 5; i++) await page.getByLabel(`Zaznacz fakturę TEST/${String(i).padStart(3, '0')}`, { exact: true }).check()
  await expect(bar).toContainText(/8\s?393,69 PLN/)
  await bar.getByLabel('Data płatności grupowej').fill('2026-09-08')
  await page.getByLabel('Zaznacz fakturę TEST/010', { exact: true }).scrollIntoViewIfNeeded()
  await expect(bar).toBeInViewport()
  mkdirSync('test-results', { recursive: true })
  await page.screenshot({ path: 'test-results/ksef-bulk-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(bar.getByRole('button', { name: 'Oznacz jako zapłacone (5)', exact: true })).toBeInViewport()
  await page.screenshot({ path: 'test-results/ksef-bulk-mobile.png' })
  await page.setViewportSize({ width: 1512, height: 982 })
  await bar.getByRole('button', { name: 'Oznacz jako zapłacone (5)', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Oznaczono jako zapłacone: 5.')
  await expect(bar).toContainText('Zaznaczono: 0')
  const changed = await db.ksefInvoice.findMany({ where: { id: { in: [0, 1, 2, 3, 4].map((id) => `invoice-${id}`) } } })
  expect(changed).toHaveLength(5)
  for (const row of changed) {
    expect(row.paymentStatus).toBe('PAID')
    expect(row.status).toBe('APPROVED')
    expect(row.dueDate.toISOString()).toBe('2026-09-15T12:00:00.000Z')
    expect(row.paidAt.toISOString()).toBe('2026-09-08T10:00:00.000Z')
  }
  expect(await db.costAuditLog.count()).toBe(5)
  const retry = await page.request.post(`${baseUrl}/api/finance/ksef/invoices/bulk-payment`, { data: { invoiceIds: ['invoice-0', 'invoice-5'], paidDate: '2026-09-09' } })
  expect((await retry.json()).results.every((row) => row.outcome === 'already_paid')).toBe(true)
  expect(await db.costAuditLog.count()).toBe(5)
  expect((await db.ksefInvoice.findUniqueOrThrow({ where: { id: 'invoice-5' } })).paidAt.toISOString()).toBe('2026-08-20T12:00:00.000Z')
  expect((await db.ksefInvoice.findUniqueOrThrow({ where: { id: 'invoice-6' } })).paymentStatus).toBe('UNPAID')

  // Date controls drive the real list API; totals/counts are not current-page calculations.
  await page.getByLabel('Miesiąc wystawienia').fill('2026-09')
  await expect(page.getByLabel('Data wystawienia od')).toHaveValue('2026-09-01')
  await expect(page.getByLabel('Data wystawienia do')).toHaveValue('2026-09-30')
  const filteredResponse = page.waitForResponse((response) => response.url().includes('/api/finance/ksef/invoices?') && response.url().includes('issueDateFrom=2026-09-01'))
  await page.getByRole('button', { name: 'Filtruj', exact: true }).click()
  const filtered = await (await filteredResponse).json()
  expect(filtered.total).toBe(55)
  expect(filtered.totalPages).toBe(2)
  expect(filtered.grossAmountTotal).toBe(13393.69)
  await expect(page.getByText('OUTSIDE/10', { exact: true })).toHaveCount(0)

  const editableRow = page.getByRole('row').filter({ has: page.getByText('TEST/006', { exact: true }) })
  await expect(editableRow.getByText('Zakup towarów i materiałów', { exact: true })).toBeVisible()
  await expect(editableRow.getByRole('button', { name: 'Usługi', exact: true })).toHaveCount(0)
  await editableRow.getByRole('button', { name: 'Edytuj tagi', exact: true }).click()
  await editableRow.getByRole('button', { name: 'Usługi', exact: true }).click()
  await editableRow.getByRole('button', { name: 'Zwiń tagi', exact: true }).click()
  await expect(editableRow.getByText('Niezapisane zmiany')).toBeVisible()
  await editableRow.getByTitle('Zapisz klasyfikację', { exact: true }).click()
  await expect(editableRow.getByText('Niezapisane zmiany')).toHaveCount(0)
  await expect(page.getByText('Okres wystawienia:', { exact: false })).toContainText('2026-09-01')
  const savedTags = await db.ksefInvoicePartTag.findMany({ where: { part: { invoiceId: 'invoice-6' } } })
  expect(savedTags.map((tag) => tag.tagId).sort()).toEqual(['goods', 'services'])
  await page.getByLabel('Miesiąc wystawienia').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/ksef-compact-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Miesiąc wystawienia').scrollIntoViewIfNeeded()
  await expect(page.getByLabel('Data wystawienia od')).toBeInViewport()
  await page.screenshot({ path: 'test-results/ksef-compact-mobile.png' })
  await page.setViewportSize({ width: 1512, height: 982 })
  await page.getByLabel('Data wystawienia od').fill('2026-09-02')
  await expect(page.getByLabel('Miesiąc wystawienia')).toHaveValue('')
  await page.getByRole('button', { name: 'Filtruj', exact: true }).click()
  await expect(page.getByText('Brak faktur dla wybranego filtra.')).toBeVisible()
  await page.getByRole('button', { name: 'Wyczyść', exact: true }).click()
  await expect(page.getByLabel('Data wystawienia od')).toHaveValue('')
  await expect(page.getByText('OUTSIDE/10', { exact: true })).toBeVisible()
  await stop()
  await start()
  await page.reload()
  await page.getByLabel('Zaznacz fakturę TEST/000', { exact: true }).check()
  await expect(bar.getByRole('button', { name: 'Oznacz jako zapłacone (0)', exact: true })).toBeDisabled()
  await expect(editableRow.getByText('Usługi', { exact: true })).toBeVisible()
  await expect(editableRow.getByRole('button', { name: 'Usługi', exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
  console.log('PASS: login, selection, currency totals, pagination, sticky desktop/mobile toolbar, bulk payments, audit, date filters/totals/clearing, collapsed tag editing/save/readback, idempotent retry and restart persistence.')
} finally {
  await browser?.close()
  await stop()
  await db.$disconnect()
  rmSync(directory, { recursive: true, force: true })
}
