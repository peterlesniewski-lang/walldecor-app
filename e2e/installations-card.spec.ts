import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@/generated/prisma'

const databaseUrl = process.env.E2E_DATABASE_URL
if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) throw new Error('Card E2E requires its isolated database')
const password = 'Card-Test-2026!'
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLxVwAAAABJRU5ErkJggg==', 'base64')
let db: PrismaClient
let templateId: string
let categoryId: string
test.use({ actionTimeout: 20_000 })

async function login(page: Page, username = 'cardowner') {
  await page.goto('/login')
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /Zaloguj/ }).click()
  await expect(page).toHaveURL(/\/(dashboard|finance|installations)/)
}

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  // Fixtures are only accounts/catalogue/template; the order lifecycle below is all UI.
  await db.costCenter.create({ data: { id: 'CARD', name: 'Test karty' } })
  for (const [username, firstName, role] of [['cardowner', 'Anna', 'EMPLOYEE'], ['cardbackup', 'Bartek', 'EMPLOYEE'], ['cardinstaller', 'Celina', 'INSTALLER']]) {
    const employee = await db.employee.create({ data: { firstName, lastName: 'Karta', email: `${username}@example.test`, position: 'Test', costCenterId: 'CARD', startDate: new Date('2026-01-01'), active: true } })
    await db.user.create({ data: { username, name: `${firstName} Karta`, email: `${username}@example.test`, role, employeeId: employee.id, passwordHash: await bcrypt.hash(password, 10), passwordChangedAt: new Date() } })
  }
  categoryId = (await db.installationCatalogCategory.create({ data: { name: 'Tapetowanie testowe', nameKey: 'tapetowanie testowe' } })).id
  templateId = (await db.installationFormTemplate.create({ data: { name: 'Przygotowanie ściany', nameKey: 'przygotowanie ściany', familyId: 'card', version: 1, status: 'PUBLISHED', publishedAt: new Date(), questionDefinitions: { create: [{ key: 'grunt', label: 'Czy ściana jest zagruntowana?', type: 'YES_NO_UNKNOWN', riskLevel: 'HIGH', sortOrder: 0 }] } } })).id
})
test.afterAll(async () => { await db?.$disconnect() })

test('employee completes the simplified card workflow, without manual reload between mutations', async ({ page, browser }, info) => {
  test.setTimeout(300_000)
  await login(page)
  await page.goto('/installations/new')
  for (const [label, value] of [['Klient', 'Joanna Test Karty'], ['E-mail', 'joanna@example.test'], ['Telefon', '+48500123456'], ['Ulica', 'Testowa'], ['Numer budynku', '12'], ['Kod pocztowy', '00-001'], ['Miejscowość', 'Warszawa']]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByRole('button', { name: 'Wybierz zastępcę opiekuna' }).click()
  await page.getByRole('option', { name: 'Ustaw Bartek Karta jako zastępcę opiekuna' }).click()
  await page.getByRole('button', { name: 'Utwórz kartę' }).click()
  await expect(page).not.toHaveURL(/\/installations\/new$/)
  await expect(page).toHaveURL(/\/installations\/[^/]+$/)
  const orderId = page.url().split('/').at(-1)!
  await expect(page.getByRole('link', { name: 'joanna@example.test' })).toHaveAttribute('href', 'mailto:joanna@example.test')
  await expect(page.getByLabel('Klient', { exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 360, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  const templateChoice = page.getByLabel('Wersja formularza dla zlecenia')
  expect(await templateChoice.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const panel = element.closest('section')!.getBoundingClientRect()
    return bounds.left >= panel.left && bounds.right <= panel.right - 16
  })).toBe(true)
  await page.locator('#settings > summary').click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.locator('#settings > summary').click()
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.getByRole('button', { name: 'Edytuj dane' }).click()
  await page.getByLabel('Telefon', { exact: true }).fill('+48500654321')
  await page.route(`**/api/installations/${orderId}`, (route) => route.abort('failed'), { times: 1 })
  await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()
  await expect(page.getByLabel('Telefon', { exact: true })).toHaveValue('+48500654321')
  await expect(page.getByText('Nie udało się połączyć z serwerem. Spróbuj ponownie.')).toBeVisible()
  await page.route(`**/api/installations/${orderId}`, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Karta została zmieniona w innym oknie.' }) }), { times: 1 })
  await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()
  await expect(page.getByText('Karta została zmieniona w innym oknie.')).toBeVisible()
  await expect(page.getByLabel('Telefon', { exact: true })).toHaveValue('+48500654321')
  await page.screenshot({ path: info.outputPath('card-edit.png'), fullPage: false })
  await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click()
  await expect(page.getByRole('link', { name: '+48500654321' })).toBeVisible()
  await expect(page.getByLabel('Telefon', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Edytuj dane' }).click()
  await page.getByLabel('Klient', { exact: true }).fill('Nie zapisuj')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Anuluj', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Joanna Test Karty', exact: true })).toBeVisible()

  const scope = page.locator('#scope')
  await scope.getByLabel('Nazwa pomieszczenia').fill('Salon')
  await scope.getByRole('button', { name: 'Dodaj pomieszczenie', exact: true }).click()
  await scope.getByRole('combobox', { name: 'Rodzaj prac dla Salon' }).selectOption(categoryId)
  await scope.getByRole('button', { name: 'Dodaj zakres w Salon', exact: true }).click()
  await expect(scope.getByRole('heading', { name: 'Tapetowanie testowe', exact: true })).toBeVisible()

  await page.getByLabel('Wersja formularza dla zlecenia').selectOption(templateId)
  await page.getByRole('button', { name: 'Wybierz formularz', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Wygeneruj link', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Wygeneruj link', exact: true }).click()
  const link = (await page.locator('#client-form output').innerText()).trim()
  await page.getByRole('button', { name: 'Oznacz jako wysłany' }).click()
  await expect(page.locator('#client-form output')).toHaveText(link)
  await page.locator('#client-form').getByText('Zarządzaj linkiem', { exact: true }).click()
  await page.locator('#client-form').getByText('Zarządzaj linkiem', { exact: true }).click()
  await expect(page.locator('#client-form output')).toHaveText(link)

  const clientContext = await browser.newContext()
  const client = await clientContext.newPage()
  await client.goto(link)
  await client.getByRole('group', { name: 'Czy ściana jest zagruntowana?' }).getByRole('button', { name: 'Nie wiem', exact: true }).click()
  await expect(client.getByRole('status')).toContainText('Wszystko zapisane')
  await client.getByRole('button', { name: 'Wyślij formularz', exact: true }).click()
  await expect.poll(() => db.installationFormSubmission.count({ where: { orderId, status: 'SUBMITTED' } })).toBe(1)
  await page.bringToFront()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('#preparation')).toContainText('Otwarte kwestie: 1')
  await page.locator('#preparation').getByRole('button', { name: 'Zapisz ustalenie', exact: true }).click()
  await page.getByLabel('Ustalenie dla Czy ściana jest zagruntowana?').fill('Potwierdzono z wykonawcą przygotowanie ściany.')
  await page.getByRole('button', { name: 'Oznacz jako ustalone' }).click()
  await expect(page.locator('#preparation')).toContainText('Brak otwartych kwestii w systemie.')
  await expect(page.locator('#preparation')).not.toContainText('Gotowe do planowania')
  await page.getByRole('button', { name: 'Zobacz odpowiedzi klienta' }).click()
  await expect(page.getByRole('heading', { name: 'Podgląd formularza klienta · wersja 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Zamknij podgląd' }).click()

  const visits = page.locator('#visits')
  await visits.getByRole('button', { name: 'Dodaj wizytę' }).click()
  await visits.getByLabel('Początek wizyty').fill('2027-03-10T09:00')
  await visits.getByLabel('Koniec wizyty').fill('2027-03-10T13:00')
  await visits.getByLabel('Salon — Tapetowanie testowe', { exact: true }).check()
  await visits.getByLabel('Celina Karta dla Salon — Tapetowanie testowe').check()
  await visits.getByRole('button', { name: 'Zapisz ekipę' }).click()
  await expect(visits.getByRole('status')).toContainText('Zapisano ekipę')
  await expect(visits.getByLabel('Początek wizyty')).toHaveValue('2027-03-10T09:00')
  await visits.getByRole('button', { name: 'Potwierdź i wyślij zaproszenia' }).click()
  await expect(page.getByText('Najbliższa wizyta: 10.03.2027, 09:00')).toBeVisible()
  await visits.getByLabel('Początek wizyty').fill('2027-03-11T10:00')
  await visits.getByLabel('Koniec wizyty').fill('2027-03-11T14:00')
  await visits.getByRole('button', { name: 'Zapisz zmianę terminu i wyślij aktualizacje' }).click()
  await expect(page.getByText('Najbliższa wizyta: 11.03.2027, 10:00')).toBeVisible()

  const attachments = page.locator('#attachments')
  await attachments.getByRole('button', { name: 'Dodaj załącznik', exact: true }).click()
  await attachments.getByLabel('Wybierz prywatny plik').setInputFiles({ name: 'rzut.png', mimeType: 'image/png', buffer: image })
  await attachments.getByRole('button', { name: 'Zapisz załącznik' }).click()
  const downloadLink = attachments.getByRole('link', { name: 'Pobierz' })
  await expect(downloadLink).toBeVisible()
  const fileUrl = (await downloadLink.getAttribute('href'))!
  const download = await page.request.get(fileUrl)
  expect(download.status()).toBe(200)
  expect((await download.body()).equals(image)).toBe(true)
  expect((await client.request.get(new URL(fileUrl, page.url()).href, { maxRedirects: 0 })).ok()).toBe(false)

  for (const width of [360, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('heading', { name: 'Joanna Test Karty', exact: true }).scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`card-${width}.png`), fullPage: true })
  }
  await page.getByRole('link', { name: 'Zakres prac', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#scope$/)

  const backupContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const backup = await backupContext.newPage()
  await login(backup, 'cardbackup')
  await backup.goto(`/installations/${orderId}`)
  await expect(backup.getByRole('button', { name: 'Edytuj dane' })).toBeVisible()
  await expect(backup.locator('#attachments').getByRole('link', { name: 'Pobierz' })).toBeVisible()
  const installerContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const installer = await installerContext.newPage()
  await login(installer, 'cardinstaller')
  await installer.goto(`/installations/${orderId}`)
  await expect(installer.getByRole('heading', { name: 'Joanna Test Karty', exact: true })).toBeVisible()
  await expect(installer.locator('#client-form')).toHaveCount(0)
  await expect(installer.locator('#preparation')).toHaveCount(0)
  await expect(installer.getByRole('link', { name: 'joanna@example.test' })).toHaveCount(0)
  const html = await (await installer.request.get(`/installations/${orderId}`)).text()
  expect(html).not.toContain('Potwierdzono z wykonawcą')
  expect(html).not.toContain('joanna@example.test')

  await page.goto(`/installations/${orderId}`)
  await expect(page.getByRole('link', { name: '+48500654321' })).toBeVisible()
  await expect(page.getByText('Najbliższa wizyta: 11.03.2027, 10:00')).toBeVisible()
  // A real server process restart, retaining the same database and private bytes.
  const testDirectory = path.dirname(databaseUrl!.slice('file:'.length))
  const restartId = `card-${Date.now()}`
  await writeFile(path.join(testDirectory, 'restart-request'), restartId, { mode: 0o600 })
  await expect.poll(async () => readFile(path.join(testDirectory, 'restart-complete'), 'utf8').catch(() => ''), { timeout: 100_000 }).toBe(restartId)
  await page.goto(`/installations/${orderId}`)
  await expect(page.getByRole('link', { name: '+48500654321' })).toBeVisible()
  await expect(page.getByText('Najbliższa wizyta: 11.03.2027, 10:00')).toBeVisible()
  const afterRestart = await page.request.get(fileUrl)
  expect(afterRestart.status()).toBe(200)
  expect((await afterRestart.body()).equals(image)).toBe(true)
  await page.locator('#attachments').getByRole('button', { name: 'Usuń plik rzut.png' }).click()
  await expect(page.locator('#attachments').getByRole('link', { name: 'Pobierz' })).toHaveCount(0)
  expect((await page.request.get(fileUrl)).ok()).toBe(false)
  if (process.env.WALLDECOR_E2E_KEEP_FOR_PREVIEW === '1') {
    await attachments.getByRole('button', { name: 'Dodaj załącznik', exact: true }).click()
    await attachments.getByLabel('Wybierz prywatny plik').setInputFiles({ name: 'rzut-podglad.png', mimeType: 'image/png', buffer: image })
    await attachments.getByRole('button', { name: 'Zapisz załącznik' }).click()
    await expect(attachments.getByRole('link', { name: 'Pobierz' })).toBeVisible()
    await writeFile(path.join(testDirectory, 'card-preview.json'), JSON.stringify({ orderId, databaseUrl, mediaRoot: path.join(testDirectory, 'media') }, null, 2), { mode: 0o600 })
  }
  await Promise.all([clientContext.close(), backupContext.close(), installerContext.close()])
})
