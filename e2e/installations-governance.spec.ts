import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@/generated/prisma'
import { getInstallationReadiness } from '@/lib/installations/readiness'

const databaseUrl = process.env.E2E_DATABASE_URL
const password = 'E2E-Governance-2026!'

if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E governance wymaga izolowanego E2E_DATABASE_URL.')
}

let db: PrismaClient
let orderId: string
let clientToken: string
let unapprovedToken: string
let postSubmitOrderId: string
let postSubmitToken: string

async function makeOrder(number: string, ownerId: string, backupId: string, templateId: string, email: string) {
  const client = await db.installationClient.create({ data: { name: `Klient ${number}`, email, phone: '+48 501 888 111' } })
  const order = await db.installationOrder.create({ data: {
    number, clientId: client.id, addressStreet: 'Testowa', addressBuildingNumber: '1', addressPostalCode: '00-001', addressCity: 'Warszawa', primaryEmployeeId: ownerId, backupEmployeeId: backupId,
  } })
  await db.installationOrderFormSnapshot.create({ data: {
    orderId: order.id, templateId, templateVersion: 1,
    schemaJson: JSON.stringify({ templateId, questions: [{ key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true }] }),
  } })
  const token = randomBytes(32).toString('base64url')
  await db.installationClientLink.create({ data: { orderId: order.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000), createdById: 'e2e-admin' } })
  return { order, token }
}

async function login(page: Page, username: string) {
  await page.goto('/login')
  await page.fill('input[name="username"]', username)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/(dashboard|finance)/)
}

function localDateTimeInput(value: Date) {
  const part = (number: number) => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}`
}

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'GOV', name: 'E2E Governance' } })
  const passwordHash = await bcrypt.hash(password, 10)
  await db.user.create({ data: { username: 'governanceadmin', email: 'governance-admin@example.test', name: 'Administrator', role: 'ADMIN', passwordHash, passwordChangedAt: new Date() } })
  const [owner, backup, delegate] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Governance', email: 'governance.e2e.owner@example.test', position: 'Koordynator', costCenterId: 'GOV', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Governance', email: 'governance.e2e.backup@example.test', position: 'Koordynator', costCenterId: 'GOV', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Celina', lastName: 'Governance', email: 'governance.e2e.delegate@example.test', position: 'Koordynator', costCenterId: 'GOV', startDate: new Date('2026-01-01'), active: true } }),
  ])
  await db.user.create({ data: { username: 'governancebackup', email: 'governance-backup-user@example.test', name: 'Zastępca', role: 'EMPLOYEE', employeeId: backup.id, passwordHash, passwordChangedAt: new Date() } })
  await db.user.create({ data: { username: 'governancedelegate', email: 'governance-delegate-user@example.test', name: 'Delegatka', role: 'EMPLOYEE', employeeId: delegate.id, passwordHash, passwordChangedAt: new Date() } })
  const template = await db.installationFormTemplate.create({ data: { familyId: 'governance-e2e', name: 'Governance E2E', nameKey: 'governance-e2e', version: 1, status: 'PUBLISHED', publishedAt: new Date(), questionDefinitions: { create: [{ key: 'glify', type: 'YES_NO_UNKNOWN', label: 'Czy są glify?', required: true, sortOrder: 0 }] } } })
  const main = await makeOrder('MON-GOV-E2E-1', owner.id, backup.id, template.id, 'governance-client@example.test')
  orderId = main.order.id
  clientToken = main.token
  const unapproved = await makeOrder('MON-GOV-E2E-2', owner.id, backup.id, template.id, 'governance-unapproved@example.test')
  unapprovedToken = unapproved.token
  const postSubmit = await makeOrder('MON-GOV-E2E-3', owner.id, backup.id, template.id, 'governance-post-submit@example.test')
  postSubmitOrderId = postSubmit.order.id
  postSubmitToken = postSubmit.token
  await db.installationVisitFeePolicy.create({ data: { version: 1, grossAmount: '249.90', clauseText: 'Jeżeli stan rzeczywisty jest niezgodny z formularzem, może obowiązywać opłata za bezskuteczny podjazd w zaakceptowanej kwocie.', legalApprovedAt: new Date('2026-08-20'), isDefault: true, createdById: 'e2e-admin' } })
  await db.installationOrder.update({ where: { id: unapproved.order.id }, data: { visitFeeStatus: 'APPROVED', visitFeeGrossAmount: '249.90', visitFeeClauseText: 'Nieaktywna obrona warstwy publicznej.', visitFeeClauseVersion: 99, visitFeeLegalApprovedAt: null } })
})

test.afterAll(async () => { await db?.$disconnect() })

test('backup takes over, admin delegates, and the client must accept an approved fee', async ({ page, browser }) => {
  await login(page, 'governanceadmin')
  await page.goto(`/installations/${orderId}`)
  await expect(page.getByRole('heading', { name: /Opiekun, zastępstwo i czasowe przejęcie/i })).toBeVisible()
  await page.getByRole('button', { name: 'Użyj domyślnej kwoty' }).click()
  await expect(page.getByText(/Zatwierdzona kwota: 249,90 zł brutto/i)).toBeVisible()

  await page.getByLabel('Osoba przejmująca').selectOption({ label: 'Celina Governance' })
  await page.getByLabel('Początek delegacji').fill(localDateTimeInput(new Date(Date.now() - 5 * 60_000)))
  await page.getByLabel('Koniec delegacji').fill(localDateTimeInput(new Date(Date.now() + 24 * 60 * 60_000)))
  await page.getByLabel('Powód delegacji').fill('Zaplanowane przejęcie kontaktu.')
  await page.getByRole('button', { name: 'Ustanów czasowe zastępstwo' }).click()
  await expect(page.locator('li').filter({ hasText: 'Celina Governance' })).toBeVisible()
  await expect.poll(async () => db.installationDelegation.count({ where: { orderId } })).toBe(1)

  const delegateContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const delegatePage = await delegateContext.newPage()
  await login(delegatePage, 'governancedelegate')
  await delegatePage.goto(`/installations/${orderId}`)
  await expect(delegatePage.getByRole('heading', { name: /Klient MON-GOV-E2E-1/ })).toBeVisible()
  await delegateContext.close()

  await page.getByRole('button', { name: 'Zakończ teraz' }).click()
  await expect.poll(async () => (await db.installationDelegation.findFirstOrThrow({ where: { orderId } })).endedAt).not.toBeNull()
  const endedDelegateContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const endedDelegatePage = await endedDelegateContext.newPage()
  await login(endedDelegatePage, 'governancedelegate')
  const endedResponse = await endedDelegatePage.goto(`/installations/${orderId}`)
  expect(endedResponse?.status()).toBe(404)
  await endedDelegateContext.close()

  const backupContext = await browser.newContext({ baseURL: 'http://localhost:3000' })
  const backupPage = await backupContext.newPage()
  await login(backupPage, 'governancebackup')
  await backupPage.goto(`/installations/${orderId}`)
  await expect(backupPage.getByRole('heading', { name: /Klient MON-GOV-E2E-1/ })).toBeVisible()
  await backupPage.getByLabel('Numer budynku').fill('2A')
  await backupPage.getByRole('button', { name: 'Zapisz zmiany' }).click()
  await expect(backupPage.getByRole('status')).toHaveText('Wszystko zapisane')
  await backupContext.close()

  const clientContext = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 390, height: 844 } })
  const clientPage = await clientContext.newPage()
  await clientPage.goto(`/m/${clientToken}`)
  await expect(clientPage.locator('strong').filter({ hasText: '249,90 zł brutto' })).toBeVisible()
  await clientPage.getByRole('button', { name: 'Nie', exact: true }).click()
  await expect(clientPage.getByRole('status')).toContainText('Wszystko zapisane')
  await expect(clientPage.getByRole('button', { name: 'Wyślij formularz' })).toBeDisabled()
  await clientPage.getByRole('checkbox', { name: /Akceptuję informację o opłacie/i }).check()
  const feeBeforeConflict = await db.installationOrder.findUniqueOrThrow({ where: { id: orderId } })
  await db.installationOrder.update({ where: { id: orderId }, data: {
    // Same policy, amount and version: the full digest must still catch the
    // changed legal text between what was ticked and what reaches POST.
    visitFeeClauseText: `${feeBeforeConflict.visitFeeClauseText} Aktualne doprecyzowanie przed wysłaniem.`,
  } })
  await clientPage.getByRole('button', { name: 'Wyślij formularz' }).click()
  await expect(clientPage.getByText(/Aktualne doprecyzowanie przed wysłaniem/i)).toBeVisible()
  await expect(clientPage.getByRole('checkbox', { name: /Akceptuję informację o opłacie/i })).not.toBeChecked()
  await expect(clientPage.getByRole('button', { name: 'Wyślij formularz' })).toBeDisabled()
  expect((await db.installationOrder.findUniqueOrThrow({ where: { id: orderId } })).visitFeeClientAcceptedAt).toBeNull()
  await clientPage.getByRole('checkbox', { name: /Akceptuję informację o opłacie/i }).check()
  await clientPage.getByRole('button', { name: 'Wyślij formularz' }).click()
  await expect(clientPage.getByText(/Formularz został wysłany/i)).toBeVisible()
  await expect.poll(async () => (await db.installationOrder.findUniqueOrThrow({ where: { id: orderId } })).visitFeeClientAcceptedAt).not.toBeNull()

  const unapprovedPage = await clientContext.newPage()
  await unapprovedPage.goto(`/m/${unapprovedToken}`)
  await expect(unapprovedPage.getByRole('checkbox', { name: /Akceptuję informację o opłacie/i })).toHaveCount(0)
  await clientContext.close()
})

test('a fee chosen after form submission is accepted without restarting the questionnaire', async ({ page, browser }) => {
  const clientContext = await browser.newContext({ baseURL: 'http://localhost:3000', viewport: { width: 390, height: 844 } })
  const clientPage = await clientContext.newPage()
  await clientPage.goto(`/m/${postSubmitToken}`)
  await clientPage.getByRole('button', { name: 'Nie', exact: true }).click()
  await expect(clientPage.getByRole('status')).toContainText('Wszystko zapisane')
  await clientPage.getByRole('button', { name: 'Wyślij formularz' }).click()
  await expect(clientPage.getByText(/Formularz został wysłany/i)).toBeVisible()
  await expect(await getInstallationReadiness(db, postSubmitOrderId)).toMatchObject({ isReady: true, visitFeeAcceptanceRequired: false })

  await login(page, 'governanceadmin')
  await page.goto(`/installations/${postSubmitOrderId}`)
  await page.getByRole('button', { name: 'Użyj domyślnej kwoty' }).click()
  await expect(page.getByText(/Zatwierdzona kwota: 249,90 zł brutto/i)).toBeVisible()
  await expect(await getInstallationReadiness(db, postSubmitOrderId)).toMatchObject({ isReady: false, visitFeeAcceptanceRequired: true })

  await clientPage.reload()
  await expect(clientPage.getByText(/Formularz został wysłany/i)).toBeVisible()
  await expect(clientPage.getByText(/249,90 zł brutto/i).first()).toBeVisible()
  await expect(clientPage.getByRole('button', { name: 'Potwierdź informację o opłacie' })).toBeDisabled()
  await clientPage.getByRole('checkbox', { name: /Akceptuję informację o opłacie/i }).check()
  await clientPage.getByRole('button', { name: 'Potwierdź informację o opłacie' }).click()
  await expect(clientPage.getByText(/Informację o opłacie potwierdzono/i)).toBeVisible()
  await expect(await getInstallationReadiness(db, postSubmitOrderId)).toMatchObject({ isReady: true, visitFeeAcceptanceRequired: false })
  await clientContext.close()
})
