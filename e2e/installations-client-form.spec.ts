import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@/generated/prisma'

const databaseUrl = process.env.E2E_DATABASE_URL
const password = 'E2E-Client-Form-2026!'
if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) throw new Error('E2E_DATABASE_URL musi wskazywać izolowaną SQLite montaży.')
const databasePath = databaseUrl.replace(/^file:/, '')
let db: PrismaClient
let templateId: string

function applyMigrations() {
  for (const migrationPath of readdirSync(path.join(process.cwd(), 'prisma', 'migrations')).sort()
    .map((directory) => path.join(process.cwd(), 'prisma', 'migrations', directory, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], { cwd: process.cwd(), input: readFileSync(migrationPath, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

test.beforeAll(async () => {
  rmSync(databasePath, { force: true })
  applyMigrations()
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'FORM', name: 'E2E formularza klienta' } })
  const passwordHash = await bcrypt.hash(password, 10)
  await db.user.create({ data: { username: 'formadmin', email: 'formadmin@example.test', name: 'Administrator formularza', role: 'ADMIN', passwordHash, passwordChangedAt: new Date() } })
  await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'e2e.form.owner@example.test', position: 'Koordynator', costCenterId: 'FORM', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'e2e.form.backup@example.test', position: 'Koordynator', costCenterId: 'FORM', startDate: new Date('2026-01-01'), active: true } }),
  ])
  const template = await db.installationFormTemplate.create({ data: {
    familyId: 'e2e-client-form', name: 'E2E klient', nameKey: 'e2e-klient', version: 1, status: 'PUBLISHED', publishedAt: new Date(), createdById: 'e2e',
    questionDefinitions: { create: [
      { key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', riskLevel: 'HIGH', sortOrder: 0 },
      { key: 'glify-cm', type: 'DIMENSION', label: 'Ile cm ma glif?', conditionJson: JSON.stringify({ questionKey: 'glify', equals: 'YES' }), sortOrder: 1 },
      { key: 'kolor', type: 'SINGLE', label: 'Kolor ściany', optionsJson: JSON.stringify(['biały', 'beżowy']), sortOrder: 2 },
      { key: 'referencja', type: 'FILE', label: 'Zdjęcie referencyjne', sortOrder: 3 },
    ] },
  } })
  templateId = template.id
})

test.afterAll(async () => { await db?.$disconnect(); rmSync(databasePath, { force: true }) })

test('admin sends an anonymous client link through autosave, clarification and immutable correction', async ({ page, browser }) => {
  await page.goto('/login')
  await page.fill('input[name="username"]', 'formadmin')
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/installations/new')
  await page.getByLabel('Klient').fill('Marta E2E')
  await page.getByLabel('E-mail').fill('marta.e2e@example.test')
  await page.getByLabel('Telefon').fill('+48 501 222 333')
  await page.getByLabel('Ulica').fill('Puławska')
  await page.getByLabel('Numer budynku').fill('17')
  await page.getByLabel('Kod pocztowy').fill('02-515')
  await page.getByLabel('Miejscowość').fill('Warszawa')
  await page.getByRole('button', { name: 'Wybierz głównego opiekuna' }).click()
  await page.getByRole('option', { name: 'Ustaw Anna Opiekun jako głównego opiekuna' }).click()
  await page.getByRole('button', { name: 'Wybierz zastępcę opiekuna' }).click()
  await page.getByRole('option', { name: 'Ustaw Bartek Zastępca jako zastępcę opiekuna' }).click()
  await page.getByRole('button', { name: 'Utwórz kartę' }).click()
  await expect(page).not.toHaveURL(/\/installations\/new$/)
  const orderId = page.url().split('/').at(-1)!

  const setup = await page.evaluate(async ({ orderId, templateId }) => {
    const room = await fetch(`/api/installations/${orderId}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Salon' }) })
    const snapshot = await fetch(`/api/installations/${orderId}/form-snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId }) })
    return { room: room.status, snapshot: snapshot.status }
  }, { orderId, templateId })
  expect(setup).toEqual({ room: 201, snapshot: 201 })
  await page.reload()
  await page.getByLabel(/Ważny do/).fill('2027-01-01T12:00')
  await page.getByRole('button', { name: 'Wygeneruj link' }).click()
  const clientUrl = await page.locator('output').textContent()
  expect(clientUrl).toMatch(/\/m\/[A-Za-z0-9_-]{43}$/)
  await page.getByRole('button', { name: 'Przedłuż o 14 dni' }).click()
  await expect.poll(async () => (await db.installationClientLink.findFirstOrThrow({ where: { orderId, revokedAt: null } })).expiresAt.getTime()).toBeGreaterThan(new Date('2027-01-14T12:00:00.000Z').getTime())
  await expect(page.locator('output')).toHaveCount(0)

  const clientContext = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 375, height: 812 } })
  const client = await clientContext.newPage()
  await client.goto(clientUrl!)
  await expect(client.getByRole('heading', { name: 'Mapa zlecenia' })).toBeVisible()
  await expect(client.getByRole('complementary', { name: 'Mapa zlecenia' }).getByText('Salon')).toBeVisible()
  const publicProjection = await client.evaluate(async () => {
    const token = location.pathname.split('/').at(-1)
    const response = await fetch(`/api/public/installations/${token}`)
    return { status: response.status, projection: await response.json() }
  })
  expect(publicProjection.status).toBe(200)
  const publicProjectionText = JSON.stringify(publicProjection.projection)
  for (const forbidden of ['Marta E2E', 'marta.e2e@example.test', 'Anna Opiekun', 'Puławska', 'orderId', 'linkId', 'templateId', 'revisionOfId']) expect(publicProjectionText).not.toContain(forbidden)
  expect(publicProjection.projection).toMatchObject({ contact: { label: 'WallDecor', email: 'info@walldecor.pl' } })
  expect(publicProjection.projection.submission).not.toHaveProperty('id')
  await client.getByRole('button', { name: 'Tak' }).focus()
  await expect(client.getByRole('button', { name: 'Tak' })).toBeFocused()
  const acceptedAutosave = client.waitForRequest((request) => request.url().endsWith('/autosave') && request.method() === 'PATCH')
  await client.getByRole('button', { name: 'Tak' }).click()
  await expect(client.locator('#glify-cm')).toBeVisible()
  await client.getByRole('button', { name: 'Nie wiem' }).click()
  await expect(client.locator('#glify-cm')).toHaveCount(0)
  await expect(client.getByText(/Ustalimy przed montażem/)).toBeVisible()
  await client.locator('#kolor').selectOption('biały')
  const acceptedAutosaveBody = (await acceptedAutosave).postData()
  expect(acceptedAutosaveBody).toContain('UNKNOWN')
  await expect.poll(async () => client.evaluate(async () => {
    const token = location.pathname.split('/').at(-1)
    const current = await (await fetch(`/api/public/installations/${token}`)).json()
    return current.submission.answers.find((answer) => answer.questionKey === 'glify')?.value
  })).toBe('UNKNOWN')
  await expect(client.getByRole('status')).toContainText('Wszystko zapisane')
  await client.reload()
  await expect(client.getByRole('button', { name: 'Nie wiem' })).toHaveAttribute('aria-pressed', 'true')
  await client.getByRole('button', { name: 'Wyślij formularz' }).click()
  await expect(client.getByText(/Formularz został wysłany/)).toBeVisible()

  await page.reload()
  await expect(page.getByText('Wymaga ustalenia przed terminem montażu')).toBeVisible()
  await page.getByLabel('Ustalenie dla glify').fill('Glif ma 12 cm')
  await page.getByLabel('Notatka dla glify').fill('Potwierdzone z klientką')
  await page.getByRole('button', { name: 'Oznacz jako ustalone' }).click()
  await expect(page.getByText('Ustalono.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Gotowe do planowania')).toBeVisible()

  await client.getByRole('button', { name: 'Zgłoś korektę' }).click()
  await expect(client.getByRole('button', { name: 'Wyślij formularz' })).toBeVisible()
  await client.getByRole('button', { name: 'Tak' }).click()
  await client.locator('#glify-cm').fill('12,5')
  await expect(client.getByRole('status')).toContainText('Wszystko zapisane', { timeout: 5000 })
  await client.getByRole('button', { name: 'Wyślij formularz' }).click()
  await expect(client.getByText(/wersję 2/i)).toBeVisible()
  await page.reload()
  await expect(page.getByText('Wersja 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Wersja 2', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Cofnij link' }).click()
  await expect.poll(async () => (await db.installationClientLink.findFirstOrThrow({ where: { orderId, tokenHash: createHash('sha256').update(new URL(clientUrl!).pathname.split('/').at(-1)!).digest('hex') } })).revokedAt).not.toBeNull()
  const revokedReplay = await client.evaluate(async ({ clientUrl, body }) => {
    const token = new URL(clientUrl).pathname.split('/').at(-1)
    const response = await fetch(`/api/public/installations/${token}/autosave`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body })
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.text() }
  }, { clientUrl, body: acceptedAutosaveBody })
  expect(revokedReplay).toEqual({ status: 404, cacheControl: 'no-store', body: JSON.stringify({ error: 'Nie znaleziono strony.' }) })
  const expiredToken = randomBytes(32).toString('base64url')
  await db.installationClientLink.create({ data: { orderId, createdById: 'e2e', tokenHash: createHash('sha256').update(expiredToken).digest('hex'), expiresAt: new Date('2020-01-01') } })
  const unavailableBodies: string[] = []
  for (const [index, pathName] of [new URL(clientUrl!).pathname, `/m/${expiredToken}`, `/m/${randomBytes(32).toString('base64url')}`, '/m/not-a-token'].entries()) {
    // A unique query bypasses the browser document cache. The public page must
    // still take its server-side notFound branch for every unavailable token.
    const response = await client.goto(`${pathName}?unavailable=${index}`)
    const body = await client.locator('body').innerText()
    expect(response?.status()).toBe(404)
    expect(body).toContain('Nie znaleziono strony')
    for (const forbidden of ['Marta E2E', 'marta.e2e@example.test', 'Anna Opiekun', 'Puławska', 'revoked', 'expired', 'token']) expect(body).not.toContain(forbidden)
    unavailableBodies.push(body)
  }
  expect(new Set(unavailableBodies).size).toBe(1)
  await clientContext.close()
})
