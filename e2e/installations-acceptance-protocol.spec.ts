import { expect, test } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@/generated/prisma'

const databaseUrl = process.env.E2E_DATABASE_URL
if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) throw new Error('Acceptance E2E requires isolated SQLite')
const password = 'Acceptance-E2E-2026!'
let db: PrismaClient
let orderId: string

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'ACCEPT-E2E', name: 'Odbiory E2E' } })
  const [owner, backup, installer] = await Promise.all([
    db.employee.create({ data: { firstName: 'Anna', lastName: 'Odbiór', email: 'accept-owner@example.test', position: 'Opiekun', costCenterId: 'ACCEPT-E2E', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Odbiór', email: 'accept-backup@example.test', position: 'Opiekun', costCenterId: 'ACCEPT-E2E', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Celina', lastName: 'Odbiór', email: 'accept-installer@example.test', position: 'Wykonawca', costCenterId: 'ACCEPT-E2E', startDate: new Date('2026-01-01'), active: true } }),
  ])
  await db.user.create({ data: { username: 'acceptinstaller', email: 'accept-installer@example.test', name: 'Celina Odbiór', role: 'INSTALLER', employeeId: installer.id, passwordHash: await bcrypt.hash(password, 10), passwordChangedAt: new Date() } })
  const order = await db.installationOrder.create({ data: {
    number: 'MON-ACCEPT-E2E', client: { create: { name: 'Ewa Klientka', email: 'ewa@example.test', phone: '+48 500 100 200' } },
    addressStreet: 'Warsztatowa', addressBuildingNumber: '4', addressPostalCode: '00-001', addressCity: 'Warszawa',
    primaryEmployee: { connect: { id: owner.id } }, backupEmployee: { connect: { id: backup.id } },
  } })
  orderId = order.id
  const category = await db.installationCatalogCategory.create({ data: { name: 'Tapetowanie', nameKey: 'tapetowanie-odbior-e2e' } })
  const room = await db.installationRoom.create({ data: { orderId, name: 'Salon' } })
  const scope = await db.installationScope.create({ data: { roomId: room.id, catalogCategoryId: category.id, name: 'Tapetowanie ściany' } })
  await db.installationScopeAssignment.create({ data: { orderId, scopeId: scope.id, employeeId: installer.id, createdById: 'e2e' } })
  await db.installationVisit.create({ data: {
    orderId, status: 'CONFIRMED', startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000), endsAt: new Date(Date.now() - 60 * 60 * 1000), createdById: 'e2e',
    scopes: { create: { orderId, scopeId: scope.id } },
  } })
})

test.afterAll(async () => { await db?.$disconnect() })

test('installer and client sign on separate mobile views without photos', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await page.locator('input[name="username"]').fill('acceptinstaller')
  await page.locator('input[type="password"]').fill(password)
  await page.getByRole('button', { name: /Zaloguj/ }).click()
  await expect(page).toHaveURL(/\/(dashboard|finance|installations)/)
  await page.goto(`/installations/${orderId}`)
  await expect(page.locator('#acceptance').getByRole('heading', { name: 'Protokoły odbioru' })).toBeVisible()
  await page.locator('#acceptance').getByRole('button', { name: 'Przygotuj protokół' }).click()
  await expect(page).toHaveURL(/\/protocols\//)
  await expect(page.getByRole('heading', { name: 'Tapetowanie', exact: true })).toBeVisible()
  await expect(page.getByText('Tapetowanie ściany')).toBeVisible()
  await page.getByLabel('Wynik pracy').selectOption('PARTIAL')
  await page.getByRole('button', { name: 'Podpisz protokół' }).click()
  await expect(page.getByText('Złóż podpis przed zapisaniem.')).toBeVisible()
  await page.getByLabel('Opis powodu (wymagany)').fill('Pozostał fragment przy drzwiach.')
  const box = await page.getByLabel('Pole podpisu wykonawcy').boundingBox()
  if (!box) throw new Error('Signature canvas missing')
  await page.mouse.move(box.x + 30, box.y + 70)
  await page.mouse.down()
  await page.mouse.move(box.x + 130, box.y + 45, { steps: 8 })
  await page.mouse.move(box.x + 230, box.y + 75, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Podpisz protokół' }).click()
  await expect(page.getByText('Podpis wykonawcy został zapisany.')).toBeVisible()
  await page.screenshot({ path: info.outputPath('signed-protocol-mobile.png'), fullPage: true })
  const stored = await db.installationAcceptanceProtocol.findFirstOrThrow({ where: { orderId } })
  expect(stored.status).toBe('INSTALLER_SIGNED')
  expect(stored.contentHash).toMatch(/^[a-f0-9]{64}$/)
  expect(await db.installationFile.count({ where: { acceptanceProtocolId: stored.id } })).toBe(0)
  await page.getByRole('button', { name: 'Otwórz widok klienta na tym telefonie' }).click()
  await expect(page).toHaveURL(/\/p\/[A-Za-z0-9_-]+/)
  await expect(page.getByRole('heading', { name: 'Sprawdź wykonane prace' })).toBeVisible()
  await expect(page.getByText('Pozostał fragment przy drzwiach.')).toBeVisible()
  await expect(page.getByRole('link', { name: /Wróć do karty/ })).toHaveCount(0)
  await expect(page.getByText('accept-owner@example.test')).toHaveCount(0)
  await page.getByLabel('Odbieram z uwagami').check()
  await page.getByLabel('Imię').fill('Ewa')
  await page.getByLabel('Nazwisko').fill('Klientka')
  await page.getByLabel('Kim jesteś wobec zlecenia?').fill('klientka')
  await page.getByLabel('Uwagi').fill('Proszę dokończyć przy drzwiach.')
  const clientBox = await page.getByLabel('Pole podpisu klienta').boundingBox()
  if (!clientBox) throw new Error('Client signature canvas missing')
  await page.mouse.move(clientBox.x + 20, clientBox.y + 75)
  await page.mouse.down()
  await page.mouse.move(clientBox.x + 130, clientBox.y + 50, { steps: 8 })
  await page.mouse.move(clientBox.x + 240, clientBox.y + 75, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Potwierdź decyzję' }).click()
  await expect(page.getByRole('heading', { name: 'Odebrano z uwagami' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('client-response-mobile.png'), fullPage: true })
  const accepted = await db.installationAcceptanceProtocol.findUniqueOrThrow({ where: { id: stored.id } })
  expect(accepted.status).toBe('ACCEPTED_WITH_REMARKS')
  expect(accepted.clientSignature).not.toBeNull()
})
