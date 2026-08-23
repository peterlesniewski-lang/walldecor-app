import bcrypt from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@/generated/prisma'

const e2ePassword = 'E2E-Installation-Catalog-2026!'
const databaseUrl = process.env.E2E_DATABASE_URL
if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E katalogu montaży wymaga izolowanego E2E_DATABASE_URL=file:/tmp/walldecor-installations-e2e-*.db')
}
async function seedDatabase() {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
    await db.costCenter.create({ data: { id: 'E2ECAT', name: 'E2E katalog montaży' } })
    const primary = await db.employee.create({ data: { firstName: 'Anna', lastName: 'Katalog', email: 'e2e.catalog.primary@example.test', position: 'Koordynatorka', costCenterId: 'E2ECAT', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } })
    await db.employee.create({ data: { firstName: 'Bartek', lastName: 'Katalog', email: 'e2e.catalog.backup@example.test', position: 'Koordynator', costCenterId: 'E2ECAT', startDate: new Date('2026-01-01T00:00:00.000Z'), active: true } })
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

  test('admin builds catalog and template, then owner keeps immutable form and catalog snapshots after UI changes', async ({ page, browser }) => {
    await login(page, 'catalogadmin')
    await page.goto('/installations/catalog')

    await page.getByLabel('Nowa kategoria').fill('Tapety')
    await page.getByRole('button', { name: 'Dodaj kategorię' }).click()
    await page.getByLabel('Nowy typ w Tapety').fill('Winylowe')
    await page.getByRole('button', { name: 'Dodaj typ' }).click()
    await page.getByLabel('Nowy produkt w Winylowe').fill('Misty Grey')
    await page.getByLabel('Kod produktu w Winylowe').fill('MG-01')
    await page.getByLabel('Producent produktu w Winylowe').fill('WallDecor')
    await page.getByLabel('Kolekcja produktu w Winylowe').fill('Misty')
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
    await page.getByRole('option', { name: 'Ustaw Anna Katalog jako głównego opiekuna' }).click()
    await page.getByLabel('Wybierz zastępcę opiekuna').click()
    await page.getByRole('option', { name: 'Ustaw Bartek Katalog jako zastępcę opiekuna' }).click()
    await page.getByRole('button', { name: 'Utwórz kartę' }).click()
    await page.waitForURL((url) => /^\/installations\/[^/]+$/.test(url.pathname) && url.pathname !== '/installations/new')
    const orderId = page.url().split('/').pop()
    expect(orderId).toBeTruthy()

    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()
    await login(ownerPage, 'catalogowner')
    await ownerPage.goto(`/installations/${orderId}`)
    await ownerPage.getByLabel('Wersja formularza dla zlecenia').selectOption({ label: 'Wywiad o glifach · wersja 1' })
    await ownerPage.getByRole('button', { name: 'Przypnij formularz' }).click()
    await expect(ownerPage.getByText('Wywiad o glifach · wersja 1')).toBeVisible()
    await expect(ownerPage.getByText('Czy są glify?')).toBeVisible()
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
    await expect(ownerPage.getByText('Kolekcja: Misty')).toBeVisible()

    await page.goto('/installations/catalog')
    await page.getByRole('button', { name: 'Edytuj dane produktu Misty Grey' }).click()
    const nameEditor = page.getByLabel('Nazwa produktu Misty Grey')
    await nameEditor.fill('Misty Grey po zmianie')
    await nameEditor.locator('xpath=ancestor::form').getByRole('button', { name: 'Zapisz' }).click()
    await expect(page.getByText('Misty Grey po zmianie', { exact: true })).toBeVisible()

    await ownerPage.reload()
    await expect(ownerPage.locator('span.font-semibold').filter({ hasText: /^Misty Grey$/ })).toBeVisible()
    await expect(ownerPage.getByText('Kolekcja: Misty')).toBeVisible()
    await ownerPage.getByLabel('Nowy zakres w Salon').fill('Zakres po zmianie')
    await ownerPage.getByRole('button', { name: 'Dodaj zakres w Salon' }).click()
    const renamedScopePicker = ownerPage.getByLabel('Produkt dla Zakres po zmianie')
    await expect(renamedScopePicker.getByRole('option', { name: 'Misty Grey po zmianie · MG-01', exact: true })).toHaveCount(1)

    await page.getByRole('button', { name: 'Archiwizuj produkt Misty Grey po zmianie' }).click()
    await expect(page.getByText('Misty Grey po zmianie', { exact: true })).toHaveCount(0)

    await ownerPage.reload()
    await expect(ownerPage.locator('span.font-semibold').filter({ hasText: /^Misty Grey$/ })).toBeVisible()
    await expect(ownerPage.getByText('Kolekcja: Misty')).toBeVisible()
    await ownerPage.getByLabel('Nowy zakres w Salon').fill('Drugi zakres')
    await ownerPage.getByRole('button', { name: 'Dodaj zakres w Salon' }).click()
    const secondScopePicker = ownerPage.getByLabel('Produkt dla Drugi zakres')
    await expect(secondScopePicker.getByRole('option', { name: 'Misty Grey po zmianie · MG-01', exact: true })).toHaveCount(0)
    await expect(secondScopePicker.getByRole('option', { name: 'Ciepły len', exact: true })).toHaveCount(1)
    await ownerContext.close()
  })
})
