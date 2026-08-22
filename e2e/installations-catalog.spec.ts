import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@/generated/prisma'

const e2ePassword = 'E2E-Installation-Catalog-2026!'
const databaseUrl = process.env.E2E_DATABASE_URL
if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E katalogu montaży wymaga izolowanego E2E_DATABASE_URL=file:/tmp/walldecor-installations-e2e-*.db')
}
const databasePath = databaseUrl.slice('file:'.length)

let primaryEmployeeId = ''
let backupEmployeeId = ''

function applyMigrations() {
  rmSync(databasePath, { force: true })
  const root = path.join(process.cwd(), 'prisma', 'migrations')
  for (const migrationPath of readdirSync(root).sort().map((directory) => path.join(root, directory, 'migration.sql')).filter(existsSync)) {
    const result = spawnSync('sqlite3', ['-bail', databasePath], { input: readFileSync(migrationPath, 'utf8'), encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  }
}

async function seedDatabase() {
  applyMigrations()
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
    await db.costCenter.create({ data: { id: 'E2ECAT', name: 'E2E katalog montaży' } })
    const [primary, backup] = await Promise.all([
      db.employee.create({ data: { firstName: 'Anna', lastName: 'Opiekun', email: 'e2e.catalog.primary@example.test', position: 'Koordynatorka', costCenterId: 'E2ECAT', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
      db.employee.create({ data: { firstName: 'Bartek', lastName: 'Zastępca', email: 'e2e.catalog.backup@example.test', position: 'Koordynator', costCenterId: 'E2ECAT', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } }),
    ])
    primaryEmployeeId = primary.id
    backupEmployeeId = backup.id
    const passwordHash = await bcrypt.hash(e2ePassword, 10)
    await Promise.all([
      db.user.create({ data: { username: 'catalogadmin', name: 'Admin katalogu', email: 'catalog.admin@example.test', role: 'ADMIN', passwordHash } }),
      db.user.create({ data: { username: 'catalogowner', name: 'Opiekun katalogu', email: 'catalog.owner@example.test', role: 'EMPLOYEE', employeeId: primary.id, passwordHash } }),
    ])
  } finally {
    await db.$disconnect()
  }
}

async function login(page: import('@playwright/test').Page, username: string) {
  await page.goto('/login')
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', e2ePassword)
  await page.getByRole('button', { name: /zaloguj/i }).click()
  await expect(page).not.toHaveURL(/\/login$/)
}

test.describe('installation catalog intake', () => {
  test.setTimeout(90_000)
  test.beforeAll(seedDatabase)

  test('admin builds catalog and template, then owner keeps historic scope snapshots after archive', async ({ page, browser }) => {
    await login(page, 'catalogadmin')
    await page.goto('/installations/catalog')

    await page.getByLabel('Nowa kategoria').fill('Tapety')
    await page.getByRole('button', { name: 'Dodaj kategorię' }).click()
    await page.getByLabel('Nowy typ w Tapety').fill('Winylowe')
    await page.getByRole('button', { name: 'Dodaj typ' }).click()
    await page.getByLabel('Nowy produkt w Winylowe').fill('Misty Grey')
    await page.getByLabel('Kod produktu w Winylowe').fill('MG-01')
    await page.getByRole('button', { name: 'Dodaj produkt' }).click()
    await expect(page.getByText('Misty Grey', { exact: true })).toBeVisible()
    await page.getByLabel('Nowy produkt w Winylowe').fill('Ciepły len')
    await page.getByRole('button', { name: 'Dodaj produkt' }).click()
    await expect(page.getByText('Ciepły len', { exact: true })).toBeVisible()

    await page.getByLabel('Nazwa szablonu').fill('Wywiad o glifach')
    await page.getByRole('button', { name: 'Utwórz szkic' }).click()
    await page.getByLabel('Klucz pytania', { exact: true }).fill('glify')
    await page.getByLabel('Etykieta pytania').fill('Czy są glify?')
    await page.getByLabel('Typ pytania').selectOption('YES_NO_UNKNOWN')
    await page.getByRole('button', { name: 'Zapisz pytanie' }).click()
    await page.getByRole('button', { name: 'Opublikuj v1' }).click()
    await expect(page.getByText('Opublikowano wersję 1')).toBeVisible()

    await page.goto('/installations/new')
    await page.getByLabel('Klient').fill('Klient katalogu')
    await page.getByLabel('E-mail').fill('katalog.e2e@example.test')
    await page.getByLabel('Telefon').fill('+48 501 111 222')
    await page.getByLabel('Ulica').fill('Dobra')
    await page.getByLabel('Numer budynku').fill('1')
    await page.getByLabel('Kod pocztowy').fill('00-001')
    await page.getByLabel('Miejscowość').fill('Warszawa')
    await page.getByLabel('Wybierz głównego opiekuna').click()
    await page.getByRole('option', { name: 'Ustaw Anna Opiekun jako głównego opiekuna' }).click()
    await page.getByLabel('Wybierz zastępcę opiekuna').click()
    await page.getByRole('option', { name: 'Ustaw Bartek Zastępca jako zastępcę opiekuna' }).click()
    await page.getByRole('button', { name: 'Utwórz kartę' }).click()
    await page.waitForURL((url) => /^\/installations\/[^/]+$/.test(url.pathname) && url.pathname !== '/installations/new')
    const orderId = page.url().split('/').pop()
    expect(orderId).toBeTruthy()

    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()
    await login(ownerPage, 'catalogowner')
    await ownerPage.goto(`/installations/${orderId}`)
    await ownerPage.getByLabel('Nazwa pomieszczenia').fill('Salon')
    await ownerPage.getByRole('button', { name: 'Dodaj pomieszczenie' }).click()
    await expect(ownerPage.getByRole('heading', { name: 'Salon', exact: true })).toBeVisible()
    await ownerPage.getByLabel('Nazwa pomieszczenia').fill('Sypialnia')
    await ownerPage.getByRole('button', { name: 'Dodaj pomieszczenie' }).click()
    await expect(ownerPage.getByRole('heading', { name: 'Sypialnia', exact: true })).toBeVisible()
    await ownerPage.getByLabel('Nowy zakres w Salon').fill('Ściana TV')
    await ownerPage.getByRole('button', { name: 'Dodaj zakres w Salon' }).click()
    await expect(ownerPage.getByRole('heading', { name: 'Ściana TV', exact: true })).toBeVisible()
    const salonProductPicker = ownerPage.getByLabel('Produkt dla Ściana TV')
    await salonProductPicker.selectOption({ label: 'Misty Grey · MG-01' })
    await ownerPage.getByRole('button', { name: 'Dodaj produkt do Ściana TV' }).click()
    await expect(salonProductPicker).toHaveValue('')
    await ownerPage.getByLabel('Nowy zakres w Sypialnia').fill('Ściana łóżka')
    await ownerPage.getByRole('button', { name: 'Dodaj zakres w Sypialnia' }).click()
    await expect(ownerPage.getByRole('heading', { name: 'Ściana łóżka', exact: true })).toBeVisible()
    const bedroomProductPicker = ownerPage.getByLabel('Produkt dla Ściana łóżka')
    await bedroomProductPicker.selectOption({ label: 'Ciepły len' })
    await ownerPage.getByRole('button', { name: 'Dodaj produkt do Ściana łóżka' }).click()
    await expect(bedroomProductPicker).toHaveValue('')
    await expect(ownerPage.locator('span.font-semibold').filter({ hasText: /^Misty Grey$/ })).toBeVisible()
    await expect(ownerPage.locator('span.font-semibold').filter({ hasText: /^Ciepły len$/ })).toBeVisible()

    await page.goto('/installations/catalog')
    await page.getByRole('button', { name: 'Archiwizuj produkt Misty Grey' }).click()
    await expect(page.getByText('Misty Grey', { exact: true })).toHaveCount(0)

    await ownerPage.reload()
    await expect(ownerPage.locator('span.font-semibold').filter({ hasText: /^Misty Grey$/ })).toBeVisible()
    await ownerPage.getByLabel('Nowy zakres w Salon').fill('Drugi zakres')
    await ownerPage.getByRole('button', { name: 'Dodaj zakres w Salon' }).click()
    await expect(ownerPage.getByLabel('Produkt dla Drugi zakres').locator('option')).not.toContainText('Misty Grey')
    await ownerContext.close()
  })
})
