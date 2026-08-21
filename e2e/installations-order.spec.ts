import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@/generated/prisma'
import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'

const databaseUrl = process.env.E2E_DATABASE_URL
const e2ePassword = 'E2E-Installation-2026!'

if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E montaży wymaga izolowanego E2E_DATABASE_URL=file:/tmp/walldecor-installations-e2e-*.db')
}

const databasePath = databaseUrl.replace(/^file:/, '')
let db: PrismaClient

function applyCommittedMigrations() {
  const migrationRoot = path.join(process.cwd(), 'prisma', 'migrations')
  const migrationSqlPaths = readdirSync(migrationRoot)
    .sort()
    .map((directory) => path.join(migrationRoot, directory, 'migration.sql'))
    .filter(existsSync)

  for (const migrationSqlPath of migrationSqlPaths) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], {
      cwd: process.cwd(),
      input: readFileSync(migrationSqlPath, 'utf8'),
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      throw new Error(`Nie udało się zastosować migracji ${migrationSqlPath}: ${result.stderr || result.stdout}`)
    }
  }
}

test.beforeAll(async () => {
  rmSync(databasePath, { force: true })
  applyCommittedMigrations()
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'JAG', name: 'Jagiellońska' } })
  await db.user.create({
    data: {
      username: 'installationadmin',
      email: 'installation-admin@example.test',
      name: 'Installation Admin',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(e2ePassword, 12),
      passwordChangedAt: new Date(),
    },
  })
  const outsider = await db.employee.create({
    data: {
      firstName: 'Ola',
      lastName: 'Obca',
      email: 'installation-outsider@example.test',
      position: 'Koordynator',
      costCenterId: 'JAG',
      startDate: new Date('2026-01-01T12:00:00.000Z'),
    },
  })
  await db.user.create({
    data: {
      username: 'installationoutsider',
      email: 'installation-outsider-user@example.test',
      name: 'Installation Outsider',
      role: 'EMPLOYEE',
      employeeId: outsider.id,
      passwordHash: await bcrypt.hash(e2ePassword, 12),
      passwordChangedAt: new Date(),
    },
  })
})

test.afterAll(async () => {
  await db?.$disconnect()
  if (existsSync(databasePath)) rmSync(databasePath, { force: true })
})

async function createEmployee(page: Page, suffix: string, firstName: string, lastName: string) {
  return page.evaluate(async ({ suffix, firstName, lastName }) => {
    const response = await fetch('/api/hr/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName,
        lastName,
        email: `${suffix}.${firstName.toLowerCase()}@example.test`,
        position: 'Koordynator montaży',
        costCenterId: 'JAG',
        startDate: '2026-01-01T12:00:00.000Z',
      }),
    })
    return { status: response.status, body: await response.json() }
  }, { suffix, firstName, lastName })
}

test.describe('Installation order workflow', () => {
  test('admin creates, edits, persists and archives an installation order', async ({ page, browser }) => {
    const suffix = `e2e-${Date.now()}`
    await page.goto('/login')
    await page.fill('input[name="username"]', 'installationadmin')
    await page.fill('input[type="password"]', e2ePassword)
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/\/dashboard/)

    const primary = await createEmployee(page, suffix, 'Anna', 'Opiekun')
    const backup = await createEmployee(page, suffix, 'Bartek', 'Zastępca')
    expect(primary.status).toBe(201)
    expect(backup.status).toBe(201)

    await page.goto('/installations/new')
    await page.getByLabel('Klient').fill('Jan E2E Kowalski')
    await page.getByLabel('E-mail').fill(`${suffix}@example.test`)
    await page.getByLabel('Telefon').fill('+48 501 234 567')
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
    const orderUrl = page.url()
    expect(orderUrl).toMatch(/\/installations\/[^/]+$/)
    await page.goto('/installations')
    const orderCard = page.getByRole('link', { name: /Jan E2E Kowalski/ })
    await expect(orderCard).toBeVisible()
    await orderCard.click()
    await expect(page).toHaveURL(orderUrl)
    await expect(page.getByRole('heading', { name: 'Jan E2E Kowalski' })).toBeVisible()
    await expect(page.getByText('Opiekun: Anna Opiekun')).toBeVisible()
    await expect(page.getByText('Zastępca: Bartek Zastępca')).toBeVisible()

    const orderId = page.url().split('/').at(-1)
    const outsiderContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
    const outsiderPage = await outsiderContext.newPage()
    await outsiderPage.goto('/login')
    await outsiderPage.fill('input[name="username"]', 'installationoutsider')
    await outsiderPage.fill('input[type="password"]', e2ePassword)
    await outsiderPage.click('button[type="submit"]')
    await expect(outsiderPage).toHaveURL(/\/dashboard/)
    const deniedResponse = await outsiderPage.goto(`/api/installations/${orderId}`)
    expect(deniedResponse?.status()).toBe(403)
    await outsiderContext.close()

    await page.getByLabel('Numer budynku').fill('19B')
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click()
    await expect(page.getByRole('status')).toHaveText('Wszystko zapisane')
    await page.reload()
    await expect(page.getByLabel('Numer budynku')).toHaveValue('19B')

    await page.getByRole('button', { name: 'Archiwizuj zlecenie' }).click()
    await expect(page).toHaveURL(/\/installations$/)
    await expect(page.getByText('Brak aktywnych kart')).toBeVisible()
  })
})
