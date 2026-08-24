import bcrypt from 'bcryptjs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@/generated/prisma'
import { processInstallationCalendarBatch } from '@/lib/installations/calendar-worker'
import { FakeInstallationCalendarAdapter } from '@/lib/installations/fake-calendar-adapter'

const databaseUrl = process.env.E2E_DATABASE_URL
const password = 'E2E-Calendar-UI-2026!'

if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E UI kalendarza wymaga izolowanego E2E_DATABASE_URL=file:/tmp/walldecor-installations-e2e-*.db')
}

let db: PrismaClient

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name="username"]', 'calendaruiadmin')
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/(dashboard|finance)/)
}

async function createOrderThroughUi(page: Page, suffix: string): Promise<string> {
  await page.goto('/installations/new')
  await page.getByLabel('Klient').fill(`Kalendarz UI ${suffix}`)
  await page.getByLabel('E-mail').fill(`calendar-ui-${suffix}@example.test`)
  await page.getByLabel('Telefon').fill('+48 501 222 333')
  await page.getByLabel('Ulica').fill('Testowa')
  await page.getByLabel('Numer budynku').fill('12')
  await page.getByLabel('Kod pocztowy').fill('00-001')
  await page.getByLabel('Miejscowość').fill('Warszawa')
  await page.getByRole('button', { name: 'Wybierz głównego opiekuna' }).click()
  await page.getByRole('option', { name: 'Ustaw Alicja Kalendarz UI jako głównego opiekuna' }).click()
  await page.getByRole('button', { name: 'Wybierz zastępcę opiekuna' }).click()
  await page.getByRole('option', { name: 'Ustaw Bartek Kalendarz UI jako zastępcę opiekuna' }).click()
  await page.getByRole('button', { name: 'Utwórz kartę' }).click()
  await expect(page).not.toHaveURL(/\/installations\/new$/)
  await expect(page).toHaveURL(/\/installations\/[^/]+$/)
  const orderId = new URL(page.url()).pathname.split('/').at(-1)
  if (!orderId || orderId === 'new') throw new Error('CALENDAR_UI_ORDER_ID_MISSING')
  return orderId
}

async function createRoomAndScopesThroughUi(page: Page) {
  const roomPanel = page.locator('section[aria-labelledby="room-scope-heading"]')
  await expect(roomPanel).toBeVisible()
  await roomPanel.getByLabel('Nazwa pomieszczenia').fill('Salon')
  await roomPanel.getByRole('button', { name: 'Dodaj pomieszczenie' }).click()
  await expect(roomPanel.getByRole('heading', { name: 'Salon' })).toBeVisible()

  const scopeInput = roomPanel.getByLabel('Nowy zakres w Salon')
  const addScope = roomPanel.getByRole('button', { name: 'Dodaj zakres w Salon' })
  await scopeInput.fill('Tapety tekstylne')
  await addScope.click()
  await expect(roomPanel.getByRole('heading', { name: 'Tapety tekstylne' })).toBeVisible()
  await scopeInput.fill('Sztukateria ścienna')
  await addScope.click()
  await expect(roomPanel.getByRole('heading', { name: 'Sztukateria ścienna' })).toBeVisible()

  // The map editor refreshes its own state, while the independent visits panel
  // receives its scope choices as server props.
  await page.reload()
}

function expandedVisitCard(visitsPanel: Locator) {
  return visitsPanel.locator('article:has(button[aria-expanded="true"])')
}

async function configureAndConfirmDraft(
  visitsPanel: Locator,
  input: {
    scopeLabel: string
    installerNames: string[]
    startsAt: string
    endsAt: string
  },
) {
  const visitCard = expandedVisitCard(visitsPanel)
  await expect(visitCard).toHaveCount(1)
  await visitCard.getByLabel('Początek wizyty').fill(input.startsAt)
  await visitCard.getByLabel('Koniec wizyty').fill(input.endsAt)
  await visitCard.getByLabel(input.scopeLabel).check()
  for (const installerName of input.installerNames) {
    await visitCard.getByLabel(`${installerName} dla ${input.scopeLabel}`).check()
  }
  await visitCard.getByRole('button', { name: 'Zapisz ekipę' }).click()
  await expect(visitsPanel.getByRole('status')).toHaveText(`Zapisano ekipę dla ${input.scopeLabel}.`)
  await visitCard.getByRole('button', { name: 'Zapisz szkic' }).click()
  await expect(visitsPanel.getByRole('status')).toHaveText('Zapisano szkic wizyty.')
  await visitCard.getByRole('button', { name: 'Potwierdź i wyślij zaproszenia' }).click()
  await expect(visitsPanel.getByRole('status')).toHaveText('Wizyta została potwierdzona. Zaproszenia oczekują na wysyłkę.')
}

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'CUI', name: 'E2E Calendar UI' } })
  await db.user.create({ data: {
    username: 'calendaruiadmin', email: 'calendar-ui-admin@example.test', name: 'Administrator UI kalendarza', role: 'ADMIN', passwordHash: await bcrypt.hash(password, 10), passwordChangedAt: new Date(),
  } })
  await Promise.all([
    db.employee.create({ data: { firstName: 'Alicja', lastName: 'Kalendarz UI', email: 'calendar-ui-a@example.test', position: 'Instalator', costCenterId: 'CUI', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Kalendarz UI', email: 'calendar-ui-b@example.test', position: 'Instalator', costCenterId: 'CUI', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Celina', lastName: 'Kalendarz UI', email: 'calendar-ui-c@example.test', position: 'Instalator', costCenterId: 'CUI', startDate: new Date('2026-01-01'), active: true } }),
  ])
})

test.afterAll(async () => {
  await db?.$disconnect()
})

test('admin schedules, reschedules and cancels visits entirely through the calendar UI', async ({ page }) => {
  // Next development mode compiles each first-visited server route on demand;
  // this full lifecycle deliberately spans several such routes without sleeps.
  test.setTimeout(180_000)
  const suffix = `ui-${Date.now()}`
  await login(page)
  const orderId = await createOrderThroughUi(page, suffix)
  await createRoomAndScopesThroughUi(page)

  const visitsPanel = page.locator('#visits')
  await expect(visitsPanel).toBeVisible()
  await visitsPanel.getByRole('button', { name: 'Dodaj wizytę' }).click()
  await configureAndConfirmDraft(visitsPanel, {
    scopeLabel: 'Salon — Tapety tekstylne',
    installerNames: ['Alicja Kalendarz UI'],
    startsAt: '2027-02-15T09:00',
    endsAt: '2027-02-15T13:00',
  })

  await visitsPanel.getByRole('button', { name: 'Dodaj wizytę' }).click()
  await configureAndConfirmDraft(visitsPanel, {
    scopeLabel: 'Salon — Sztukateria ścienna',
    installerNames: ['Bartek Kalendarz UI', 'Celina Kalendarz UI'],
    startsAt: '2027-02-16T09:00',
    endsAt: '2027-02-16T13:00',
  })

  const visits = await db.installationVisit.findMany({
    where: { orderId }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true },
  })
  expect(visits).toEqual([
    { id: expect.any(String), status: 'CONFIRMED' },
    { id: expect.any(String), status: 'CONFIRMED' },
  ])
  const [firstVisit, secondVisit] = visits
  const fake = new FakeInstallationCalendarAdapter()
  expect(await processInstallationCalendarBatch(db, fake, 10)).toMatchObject({ claimed: 2, completed: 2, retried: 0, attention: 0 })

  await page.reload()
  const syncedFirstCard = visitsPanel.locator('article').filter({ hasText: '15.02.2027, 09:00–13:00' })
  const syncedSecondCard = visitsPanel.locator('article').filter({ hasText: '16.02.2027, 09:00–13:00' })
  await expect(syncedFirstCard.getByText('W Google Calendar', { exact: true })).toBeVisible()
  await expect(syncedSecondCard.getByText('W Google Calendar', { exact: true })).toBeVisible()
  await syncedFirstCard.getByRole('button', { name: /15\.02\.2027, 09:00–13:00/u }).click()
  const editingFirstCard = expandedVisitCard(visitsPanel)
  await expect(editingFirstCard.getByRole('link', { name: 'Otwórz w Google Calendar' })).toBeVisible()

  const beforeReschedule = await db.integrationSyncState.findUniqueOrThrow({
    where: { visitId_kind: { visitId: firstVisit.id, kind: 'GOOGLE_CALENDAR' } },
    select: { externalId: true, externalEtag: true },
  })
  expect(beforeReschedule.externalId).not.toBeNull()
  expect(beforeReschedule.externalEtag).not.toBeNull()

  await editingFirstCard.getByLabel('Początek wizyty').fill('2027-02-17T11:00')
  await editingFirstCard.getByLabel('Koniec wizyty').fill('2027-02-17T15:00')
  await editingFirstCard.getByRole('button', { name: 'Zapisz zmianę terminu i wyślij aktualizacje' }).click()
  await expect(visitsPanel.getByRole('status')).toHaveText('Zapisano zmianę terminu. Aktualizacje oczekują na wysyłkę.')
  expect(await processInstallationCalendarBatch(db, fake, 10)).toMatchObject({ claimed: 1, completed: 1, retried: 0, attention: 0 })

  const afterReschedule = await db.integrationSyncState.findUniqueOrThrow({
    where: { visitId_kind: { visitId: firstVisit.id, kind: 'GOOGLE_CALENDAR' } },
    select: { externalId: true, externalEtag: true },
  })
  expect(afterReschedule.externalId).toBe(beforeReschedule.externalId)
  expect(afterReschedule.externalEtag).not.toBe(beforeReschedule.externalEtag)

  await page.reload()
  const rescheduledFirstCard = visitsPanel.locator('article').filter({ hasText: '17.02.2027, 11:00–15:00' })
  await expect(rescheduledFirstCard.getByText('W Google Calendar', { exact: true })).toBeVisible()
  await rescheduledFirstCard.getByRole('button', { name: /17\.02\.2027, 11:00–15:00/u }).click()
  await expect(rescheduledFirstCard.getByRole('link', { name: 'Otwórz w Google Calendar' })).toBeVisible()

  const cancellableSecondCard = visitsPanel.locator('article').filter({ hasText: '16.02.2027, 09:00–13:00' })
  await cancellableSecondCard.getByRole('button', { name: /16\.02\.2027, 09:00–13:00/u }).click()
  const editingSecondCard = expandedVisitCard(visitsPanel)
  await expect(editingSecondCard.getByRole('link', { name: 'Otwórz w Google Calendar' })).toBeVisible()
  await editingSecondCard.getByRole('button', { name: 'Odwołaj wizytę' }).click()
  await expect(visitsPanel.getByRole('status')).toHaveText('Wizyta została odwołana.')
  expect(await processInstallationCalendarBatch(db, fake, 10)).toMatchObject({ claimed: 1, completed: 1, retried: 0, attention: 0 })

  expect(await db.integrationOutbox.findMany({
    where: { visitId: secondVisit.id }, orderBy: { createdAt: 'asc' }, select: { operation: true, status: true },
  })).toEqual([
    { operation: 'CALENDAR_UPSERT', status: 'COMPLETED' },
    { operation: 'CALENDAR_CANCEL', status: 'COMPLETED' },
  ])
  expect(await db.integrationAttempt.count({ where: { outbox: { visitId: secondVisit.id } } })).toBe(2)
  expect(fake.snapshot()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: expect.objectContaining({ visitId: firstVisit.id }), cancelled: false }),
    expect.objectContaining({ event: expect.objectContaining({ visitId: secondVisit.id }), cancelled: true }),
  ]))

  await page.reload()
  const cancelledSecondCard = visitsPanel.locator('article').filter({ hasText: '16.02.2027, 09:00–13:00' })
  await expect(cancelledSecondCard).toContainText('Odwołana')
  await cancelledSecondCard.getByRole('button', { name: /16\.02\.2027, 09:00–13:00/u }).click()
  await expect(cancelledSecondCard.getByRole('link', { name: 'Otwórz w Google Calendar' })).toHaveCount(0)
})
