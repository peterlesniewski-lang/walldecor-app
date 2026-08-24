import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@/generated/prisma'

const databaseUrl = process.env.E2E_DATABASE_URL
const password = 'E2E-Client-Form-2026!'
if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) throw new Error('E2E_DATABASE_URL musi wskazywać izolowaną SQLite montaży.')
let db: PrismaClient
let templateId: string

function localDateTimeInput(value: Date) {
  const part = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}`
}

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name="username"]', 'formadmin')
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/dashboard/)
}

async function expectOrderFormStatus(
  page: import('@playwright/test').Page,
  orderId: string,
  status: string,
  requiresClarification = false,
) {
  await page.goto('/installations')
  const card = page.locator(`a[href="/installations/${orderId}"]`)
  await expect(card).toContainText(status)
  if (requiresClarification) await expect(card).toContainText('Wymaga ustalenia')
  else await expect(card).not.toContainText('Wymaga ustalenia')
}

async function chooseAnswer(
  page: import('@playwright/test').Page,
  question: string,
  answer: 'Tak' | 'Nie' | 'Nie wiem',
) {
  const autosave = page.waitForRequest((request) => request.url().endsWith('/autosave') && request.method() === 'PATCH')
  await page.getByRole('group', { name: question }).getByRole('button', { name: answer, exact: true }).click()
  const request = await autosave
  await expect(page.getByRole('status')).toContainText('Wszystko zapisane', { timeout: 5000 })
  return request.postData() ?? ''
}

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  const existingTemplate = await db.installationFormTemplate.findFirst({ where: { familyId: 'e2e-client-form', version: 1 } })
  if (existingTemplate) {
    templateId = existingTemplate.id
    return
  }
  await db.costCenter.create({ data: { id: 'FORM', name: 'E2E formularza klienta' } })
  const passwordHash = await bcrypt.hash(password, 10)
  await db.user.create({ data: { username: 'formadmin', email: 'formadmin@example.test', name: 'Administrator formularza', role: 'ADMIN', passwordHash, passwordChangedAt: new Date() } })
  await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Formularz', email: 'e2e.form.owner@example.test', position: 'Koordynator', costCenterId: 'FORM', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Formularz', email: 'e2e.form.backup@example.test', position: 'Koordynator', costCenterId: 'FORM', startDate: new Date('2026-01-01'), active: true } }),
  ])
  const template = await db.installationFormTemplate.create({ data: {
    familyId: 'e2e-client-form', name: 'E2E klient', nameKey: 'e2e-klient', version: 1, status: 'PUBLISHED', publishedAt: new Date(), createdById: 'e2e',
    questionDefinitions: { create: [
      { key: 'e2e_okna', type: 'YES_NO_UNKNOWN', label: 'Czy na tapetowanej ścianie znajdują się okna?', sortOrder: 0 },
      { key: 'e2e_glify', type: 'YES_NO_UNKNOWN', label: 'Czy tapetujemy glify?', riskLevel: 'HIGH', conditionJson: JSON.stringify({ questionKey: 'e2e_okna', equals: 'YES' }), sortOrder: 1 },
      { key: 'e2e_glify_cm', type: 'DIMENSION', label: 'Podaj głębokość glifów', conditionJson: JSON.stringify({ questionKey: 'e2e_glify', equals: 'YES' }), sortOrder: 2 },
      { key: 'e2e_kolor', type: 'SINGLE', label: 'Kolor ściany', optionsJson: JSON.stringify(['biały', 'beżowy']), sortOrder: 3 },
      { key: 'e2e_referencja', type: 'FILE', label: 'Zdjęcie referencyjne', sortOrder: 4 },
    ] },
  } })
  templateId = template.id
  await db.installationFormTemplate.create({ data: {
    familyId: 'e2e-path-designer', name: 'E2E projektant', nameKey: 'e2e-projektant', version: 1, status: 'DRAFT', createdById: 'e2e',
    questionDefinitions: { create: [
      { key: 'designer-okna', type: 'YES_NO_UNKNOWN', label: 'Czy są okna?', sortOrder: 0 },
      { key: 'designer-glify', type: 'YES_NO_UNKNOWN', label: 'Czy tapetujemy glify?', conditionJson: JSON.stringify({ questionKey: 'designer-okna', equals: 'YES' }), sortOrder: 1 },
      { key: 'designer-glebokosc', type: 'DIMENSION', label: 'Podaj głębokość', conditionJson: JSON.stringify({ questionKey: 'designer-glify', equals: 'YES' }), sortOrder: 2 },
    ] },
  } })
})

test.afterAll(async () => { await db?.$disconnect() })

test('admin sends an anonymous client link through autosave, clarification and immutable correction', async ({ page, browser }) => {
  test.setTimeout(300_000)
  await login(page)

  await page.goto('/installations/new')
  await page.getByLabel('Klient').fill('Marta E2E')
  await page.getByLabel('E-mail').fill('marta.e2e@example.test')
  await page.getByLabel('Telefon').fill('+48 501 222 333')
  await page.getByLabel('Ulica').fill('Puławska')
  await page.getByLabel('Numer budynku').fill('17')
  await page.getByLabel('Kod pocztowy').fill('02-515')
  await page.getByLabel('Miejscowość').fill('Warszawa')
  await page.getByRole('button', { name: 'Wybierz głównego opiekuna' }).click()
  await page.getByRole('option', { name: 'Ustaw Anna Formularz jako głównego opiekuna' }).click()
  await page.getByRole('button', { name: 'Wybierz zastępcę opiekuna' }).click()
  await page.getByRole('option', { name: 'Ustaw Bartek Formularz jako zastępcę opiekuna' }).click()
  await page.getByRole('button', { name: 'Utwórz kartę' }).click()
  await expect(page).not.toHaveURL(/\/installations\/new$/)
  const orderId = page.url().split('/').at(-1)!
  await expect(page.getByText('Najpierw przypnij dokładnie jeden formularz klienta do zlecenia.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Wygeneruj link' })).toBeDisabled()

  const setup = await page.evaluate(async ({ orderId, templateId }) => {
    const room = await fetch(`/api/installations/${orderId}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Salon' }) })
    const snapshot = await fetch(`/api/installations/${orderId}/form-snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId }) })
    return { room: room.status, snapshot: snapshot.status }
  }, { orderId, templateId })
  expect(setup).toEqual({ room: 201, snapshot: 201 })
  await page.reload()
  await expectOrderFormStatus(page, orderId, 'Do wysłania')
  await page.goto(`/installations/${orderId}`)
  const requestedExpiry = new Date(Date.now() + 30 * 24 * 60 * 60_000)
  await page.getByLabel(/Ważny do/).fill(localDateTimeInput(requestedExpiry))
  await page.getByRole('button', { name: 'Wygeneruj link' }).click()
  const linkPanel = page.getByRole('heading', { name: 'Bezpieczny link do przygotowania montażu' }).locator('..')
  const clientUrl = await linkPanel.locator('output').textContent()
  expect(clientUrl).toMatch(/\/m\/[A-Za-z0-9_-]{43}$/)
  await page.getByRole('button', { name: 'Przedłuż o 14 dni' }).click()
  await expect.poll(async () => (await db.installationClientLink.findFirstOrThrow({ where: { orderId, revokedAt: null } })).expiresAt.getTime()).toBeGreaterThan(requestedExpiry.getTime() + 13 * 24 * 60 * 60_000)
  await expect(linkPanel.locator('output')).toHaveCount(0)
  await page.getByRole('button', { name: 'Oznacz jako wysłany' }).click()
  await expect(linkPanel.getByRole('status')).toContainText('Wysłano:')
  await expect(linkPanel.getByRole('status')).toBeFocused()
  await expectOrderFormStatus(page, orderId, 'Wysłany · czeka na klienta')
  await page.goto(`/installations/${orderId}`)

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
  for (const forbidden of ['Marta E2E', 'marta.e2e@example.test', 'Anna Formularz', 'Puławska', 'orderId', 'linkId', 'templateId', 'revisionOfId']) expect(publicProjectionText).not.toContain(forbidden)
  expect(publicProjection.projection).toMatchObject({ contact: { label: 'WallDecor', email: 'info@walldecor.pl' } })
  expect(publicProjection.projection.submission).not.toHaveProperty('id')
  await expectOrderFormStatus(page, orderId, 'Rozpoczęty')

  const rootYes = client.getByRole('group', { name: 'Czy na tapetowanej ścianie znajdują się okna?' }).getByRole('button', { name: 'Tak', exact: true })
  await rootYes.focus()
  await expect(rootYes).toBeFocused()
  await chooseAnswer(client, 'Czy na tapetowanej ścianie znajdują się okna?', 'Tak')
  await expect(client.getByRole('group', { name: 'Czy tapetujemy glify?' })).toBeVisible()
  await chooseAnswer(client, 'Czy tapetujemy glify?', 'Tak')
  const depth = client.getByLabel('Podaj głębokość glifów')
  await expect(depth).toBeVisible()
  const depthAutosave = client.waitForRequest((request) => request.url().endsWith('/autosave') && request.method() === 'PATCH')
  await depth.fill('12,5')
  await depthAutosave
  await expect(client.getByRole('status')).toContainText('Wszystko zapisane', { timeout: 5000 })

  await chooseAnswer(client, 'Czy na tapetowanej ścianie znajdują się okna?', 'Nie')
  await expect(client.getByRole('group', { name: 'Czy tapetujemy glify?' })).toHaveCount(0)
  await expect(client.getByLabel('Podaj głębokość glifów')).toHaveCount(0)
  await expect.poll(async () => client.evaluate(async () => {
    const token = location.pathname.split('/').at(-1)
    const current = await (await fetch(`/api/public/installations/${token}`)).json()
    return current.submission.answers.map((answer) => answer.questionKey).sort()
  })).not.toContain('e2e_glify')
  const prunedKeys = await client.evaluate(async () => {
    const token = location.pathname.split('/').at(-1)
    const current = await (await fetch(`/api/public/installations/${token}`)).json()
    return current.submission.answers.map((answer) => answer.questionKey)
  })
  expect(prunedKeys).not.toContain('e2e_glify_cm')

  await chooseAnswer(client, 'Czy na tapetowanej ścianie znajdują się okna?', 'Tak')
  await expect(client.getByRole('group', { name: 'Czy tapetujemy glify?' })).toBeVisible()
  await expect(client.getByLabel('Podaj głębokość glifów')).toHaveCount(0)
  const acceptedAutosaveBody = await chooseAnswer(client, 'Czy tapetujemy glify?', 'Nie wiem')
  await expect(client.getByLabel('Podaj głębokość glifów')).toHaveCount(0)
  await expect(client.getByText(/Ustalimy przed montażem/)).toBeVisible()
  const colorAutosave = client.waitForRequest((request) => request.url().endsWith('/autosave') && request.method() === 'PATCH')
  await client.getByLabel('Kolor ściany').selectOption('biały')
  await colorAutosave
  expect(acceptedAutosaveBody).toContain('UNKNOWN')
  await expect.poll(async () => client.evaluate(async () => {
    const token = location.pathname.split('/').at(-1)
    const current = await (await fetch(`/api/public/installations/${token}`)).json()
    return current.submission.answers.find((answer) => answer.questionKey === 'e2e_glify')?.value
  })).toBe('UNKNOWN')
  await expect(client.getByRole('status')).toContainText('Wszystko zapisane')
  await client.reload()
  await expect(client.getByRole('group', { name: 'Czy tapetujemy glify?' }).getByRole('button', { name: 'Nie wiem' })).toHaveAttribute('aria-pressed', 'true')
  await client.getByRole('button', { name: 'Wyślij formularz' }).click()
  await expect(client.getByText(/Formularz został wysłany/)).toBeVisible()

  await expectOrderFormStatus(page, orderId, 'Wypełniony', true)
  await page.goto(`/installations/${orderId}`)
  await expect(page.getByText('Wymaga ustalenia przed terminem montażu')).toBeVisible()
  const revisionPanel = page.getByRole('region', { name: 'Wersje odpowiedzi klienta' })
  await expect(revisionPanel).toContainText('Czy na tapetowanej ścianie znajdują się okna?')
  await expect(revisionPanel).toContainText('Czy tapetujemy glify?')
  await expect(revisionPanel).toContainText('Nie wiem')
  await expect(revisionPanel).not.toContainText('e2e_glify_cm')
  let previewAutosaveRequests = 0
  const countPreviewAutosave = (request: import('@playwright/test').Request) => {
    if (request.url().endsWith('/autosave')) previewAutosaveRequests += 1
  }
  page.on('request', countPreviewAutosave)
  const previewOpener = revisionPanel.getByRole('button', { name: 'Podgląd jak klient · wersja 1' })
  await previewOpener.click()
  const preview = revisionPanel.getByRole('region', { name: 'Podgląd formularza klienta, wersja 1' })
  await expect(preview.getByRole('button', { name: 'Zamknij podgląd' })).toBeFocused()
  await expect(preview).toContainText('Czy tapetujemy glify?')
  await expect(preview).toContainText('Nie wiem')
  await expect(preview).toContainText('Pliki są zapisane w sekcji dokumentów')
  await expect(preview.getByRole('button', { name: 'Wyślij formularz' })).toHaveCount(0)
  await expect(preview.locator('input[type="file"], input, textarea, select, [aria-pressed]')).toHaveCount(0)
  expect(await preview.innerText()).not.toMatch(/e2e_okna|e2e_glify|e2e_kolor|e2e_referencja/)
  await page.waitForTimeout(650)
  expect(previewAutosaveRequests).toBe(0)
  await preview.getByRole('button', { name: 'Zamknij podgląd' }).click()
  await expect(previewOpener).toBeFocused()
  page.off('request', countPreviewAutosave)

  await page.getByLabel('Ustalenie dla Czy tapetujemy glify?').fill('Glif ma 12 cm')
  await page.getByLabel('Notatka dla Czy tapetujemy glify?').fill('Potwierdzone z klientką')
  await page.getByRole('button', { name: 'Oznacz jako ustalone' }).click()
  await expect(page.getByText('Ustalono.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Gotowe do planowania')).toBeVisible()

  const correctionResponsePromise = client.waitForResponse((response) => response.url().endsWith('/correction') && response.request().method() === 'POST')
  await client.getByRole('button', { name: 'Zgłoś korektę' }).click()
  const correctionResponse = await correctionResponsePromise
  expect({ status: correctionResponse.status(), body: await correctionResponse.json() }).toMatchObject({ status: 201 })
  await expect(client.getByRole('button', { name: 'Wyślij formularz' })).toBeVisible()
  await chooseAnswer(client, 'Czy tapetujemy glify?', 'Tak')
  const correctionDepthAutosave = client.waitForRequest((request) => request.url().endsWith('/autosave') && request.method() === 'PATCH')
  await client.getByLabel('Podaj głębokość glifów').fill('12,5')
  await correctionDepthAutosave
  await expect(client.getByRole('status')).toContainText('Wszystko zapisane', { timeout: 5000 })
  await client.getByRole('button', { name: 'Wyślij formularz' }).click()
  await expect(client.getByText(/wersję 2/i)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Podgląd jak klient · wersja 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Podgląd jak klient · wersja 2' })).toBeVisible()

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
  for (const forbidden of ['Marta E2E', 'marta.e2e@example.test', 'Anna Formularz', 'Puławska', 'revoked', 'expired', 'token']) expect(body).not.toContain(forbidden)
    unavailableBodies.push(body)
  }
  expect(new Set(unavailableBodies).size).toBe(1)
  await clientContext.close()
})

test('path designer stays keyboard-operable without horizontal overflow on mobile', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 375, height: 812 })
  await login(page)
  await page.goto('/installations/catalog')
  await page.getByLabel('Wybierz szkic do edycji').selectOption({ label: 'E2E projektant · v1 · szkic' })

  const collapse = page.getByRole('button', { name: 'Zwiń gałęzie pytania Czy są okna?' })
  await collapse.focus()
  await expect(collapse).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(collapse).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')

  const branchAction = page.getByRole('button', { name: 'Dodaj pytanie po odpowiedzi Nie' }).first()
  await branchAction.scrollIntoViewIfNeeded()
  await branchAction.focus()
  await expect(branchAction).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('form', { name: 'Dodaj pytanie' })).toBeVisible()
  await page.getByRole('button', { name: 'Anuluj' }).click()

  const edit = page.getByRole('button', { name: 'Edytuj pytanie Podaj głębokość' })
  await edit.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('form', { name: 'Edytuj pytanie Podaj głębokość' })).toBeVisible()
  await page.getByRole('button', { name: 'Anuluj' }).click()

  const testForm = page.getByRole('button', { name: 'Testuj formularz' })
  await testForm.focus()
  await expect(testForm).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Test formularza' })).toBeVisible()
  await page.getByRole('group', { name: 'Czy są okna?' }).getByRole('button', { name: 'Tak', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Czy tapetujemy glify?' })).toBeVisible()
  await page.getByRole('button', { name: 'Wróć do mapy' }).click()

  const remove = page.getByRole('button', { name: 'Usuń pytanie Podaj głębokość' })
  await remove.focus()
  await page.keyboard.press('Enter')
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(remove).toBeFocused()

  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }))
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.innerWidth + 1)
  expect(viewport.bodyWidth).toBeLessThanOrEqual(viewport.innerWidth + 1)
})
