import bcrypt from 'bcryptjs'
import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '@/generated/prisma'
import { processInstallationCalendarBatch } from '@/lib/installations/calendar-worker'
import { FakeInstallationCalendarAdapter } from '@/lib/installations/fake-calendar-adapter'

const databaseUrl = process.env.E2E_DATABASE_URL
const password = 'E2E-Calendar-2026!'

if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E kalendarza wymaga izolowanego E2E_DATABASE_URL=file:/tmp/walldecor-installations-e2e-*.db')
}

let db: PrismaClient
let primaryEmployeeId: string
let backupEmployeeId: string
let thirdInstallerId: string

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name="username"]', 'calendaradmin')
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/(dashboard|finance)/)
}

async function setupCalendarWorkflow(page: Page, suffix: string) {
  return page.evaluate(async ({ suffix, primaryEmployeeId, backupEmployeeId, thirdInstallerId }) => {
    async function request(path: string, init: RequestInit) {
      const response = await fetch(path, init)
      const body = await response.json()
      return { status: response.status, body }
    }

    const order = await request('/api/installations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { name: `Kalendarz E2E ${suffix}`, email: `calendar-${suffix}@example.test`, phone: '+48 501 222 333' },
        address: { street: 'Testowa', buildingNumber: '12', postalCode: '00-001', city: 'Warszawa' },
        primaryEmployeeId,
        backupEmployeeId,
      }),
    })
    if (order.status !== 201) throw new Error(`CALENDAR_E2E_SETUP_ORDER_${order.status}`)

    const room = await request(`/api/installations/${order.body.id}/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Salon' }),
    })
    if (room.status !== 201) throw new Error(`CALENDAR_E2E_SETUP_ROOM_${room.status}`)

    const wallpaper = await request(`/api/installations/${order.body.id}/rooms/${room.body.id}/scopes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tapety tekstylne' }),
    })
    const moulding = await request(`/api/installations/${order.body.id}/rooms/${room.body.id}/scopes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sztukateria ścienna' }),
    })
    if (wallpaper.status !== 201 || moulding.status !== 201) throw new Error('CALENDAR_E2E_SETUP_SCOPES')

    const wallpaperTeam = await request(`/api/installations/${order.body.id}/scope-assignments/${wallpaper.body.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeIds: [primaryEmployeeId] }),
    })
    const mouldingTeam = await request(`/api/installations/${order.body.id}/scope-assignments/${moulding.body.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeIds: [backupEmployeeId, thirdInstallerId] }),
    })
    if (wallpaperTeam.status !== 200 || mouldingTeam.status !== 200) throw new Error('CALENDAR_E2E_SETUP_TEAMS')

    const firstDraft = await request(`/api/installations/${order.body.id}/visits`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scopeIds: [wallpaper.body.id] }),
    })
    const secondDraft = await request(`/api/installations/${order.body.id}/visits`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scopeIds: [moulding.body.id] }),
    })
    if (firstDraft.status !== 201 || secondDraft.status !== 201) throw new Error('CALENDAR_E2E_SETUP_VISITS')

    const firstVisit = await request(`/api/installations/${order.body.id}/visits/${firstDraft.body.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CONFIRM', expectedRevision: firstDraft.body.revision,
        startsAt: '2027-02-15T08:00:00.000Z', endsAt: '2027-02-15T12:00:00.000Z',
        scopeIds: [wallpaper.body.id], note: 'Pierwsza wizyta',
      }),
    })
    const secondVisit = await request(`/api/installations/${order.body.id}/visits/${secondDraft.body.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CONFIRM', expectedRevision: secondDraft.body.revision,
        startsAt: '2027-02-16T08:00:00.000Z', endsAt: '2027-02-16T12:00:00.000Z',
        scopeIds: [moulding.body.id], note: 'Druga wizyta',
      }),
    })
    return { order, room, wallpaper, moulding, wallpaperTeam, mouldingTeam, firstVisit, secondVisit }
  }, { suffix, primaryEmployeeId, backupEmployeeId, thirdInstallerId })
}

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON')
  await db.costCenter.create({ data: { id: 'CAL', name: 'E2E Calendar' } })
  const passwordHash = await bcrypt.hash(password, 10)
  await db.user.create({ data: {
    username: 'calendaradmin', email: 'calendar-admin@example.test', name: 'Administrator kalendarza', role: 'ADMIN', passwordHash, passwordChangedAt: new Date(),
  } })
  const [primary, backup, third] = await Promise.all([
    db.employee.create({ data: { firstName: 'Alicja', lastName: 'Kalendarz', email: 'calendar-a@example.test', position: 'Instalator', costCenterId: 'CAL', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Bartek', lastName: 'Kalendarz', email: 'calendar-b@example.test', position: 'Instalator', costCenterId: 'CAL', startDate: new Date('2026-01-01'), active: true } }),
    db.employee.create({ data: { firstName: 'Celina', lastName: 'Kalendarz', email: 'calendar-c@example.test', position: 'Instalator', costCenterId: 'CAL', startDate: new Date('2026-01-01'), active: true } }),
  ])
  primaryEmployeeId = primary.id
  backupEmployeeId = backup.id
  thirdInstallerId = third.id
})

test.afterAll(async () => {
  await db?.$disconnect()
})

test('keeps one calendar event per visit through reschedule and cancellation', async ({ page }) => {
  test.setTimeout(120_000)
  const suffix = `calendar-${Date.now()}`
  await login(page)
  const workflow = await setupCalendarWorkflow(page, suffix)

  expect(workflow.order.status).toBe(201)
  expect(workflow.room.status).toBe(201)
  expect(workflow.wallpaperTeam.body.employeeIds).toEqual([primaryEmployeeId])
  expect(workflow.mouldingTeam.body.employeeIds).toEqual([backupEmployeeId, thirdInstallerId].sort())
  expect(workflow.firstVisit.status).toBe(200)
  expect(workflow.secondVisit.status).toBe(200)

  const orderId = workflow.order.body.id as string
  const firstVisitId = workflow.firstVisit.body.id as string
  const secondVisitId = workflow.secondVisit.body.id as string
  const fake = new FakeInstallationCalendarAdapter()
  const initialBatch = await processInstallationCalendarBatch(db, fake, 10)
  expect(initialBatch).toMatchObject({ claimed: 2, completed: 2, retried: 0, attention: 0 })

  await page.goto('/installations')
  const orderCard = page.locator('article').filter({ hasText: `Kalendarz E2E ${suffix}` })
  await expect(orderCard.getByRole('link', { name: 'Wizyty i terminy' })).toBeVisible()
  await orderCard.getByRole('link', { name: 'Wizyty i terminy' }).click()
  await expect(page).toHaveURL(new RegExp(`/installations/${orderId}#visits$`))
  await expect(page.locator('#visits')).toBeVisible()

  const beforeReschedule = await db.integrationSyncState.findUniqueOrThrow({
    where: { visitId_kind: { visitId: firstVisitId, kind: 'GOOGLE_CALENDAR' } },
  })
  expect(beforeReschedule.externalId).not.toBeNull()
  expect(beforeReschedule.externalEtag).not.toBeNull()
  expect(await db.integrationSyncState.count({ where: { visitId: firstVisitId } })).toBe(1)

  const rescheduled = await page.evaluate(async ({ orderId, firstVisitId, expectedRevision, wallpaperScopeId }) => {
    const response = await fetch(`/api/installations/${orderId}/visits/${firstVisitId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CHANGE_SCHEDULE', expectedRevision,
        startsAt: '2027-02-17T09:00:00.000Z', endsAt: '2027-02-17T13:00:00.000Z',
        scopeIds: [wallpaperScopeId], note: 'Przeniesiony termin',
      }),
    })
    return { status: response.status, body: await response.json() }
  }, {
    orderId, firstVisitId, expectedRevision: workflow.firstVisit.body.revision as number,
    wallpaperScopeId: workflow.wallpaper.body.id as string,
  })
  expect(rescheduled.status).toBe(200)
  expect(await processInstallationCalendarBatch(db, fake, 10)).toMatchObject({ claimed: 1, completed: 1, retried: 0, attention: 0 })

  const afterReschedule = await db.integrationSyncState.findUniqueOrThrow({
    where: { visitId_kind: { visitId: firstVisitId, kind: 'GOOGLE_CALENDAR' } },
  })
  expect(afterReschedule.externalId).toBe(beforeReschedule.externalId)
  expect(afterReschedule.externalEtag).not.toBe(beforeReschedule.externalEtag)
  expect(await db.integrationSyncState.count({ where: { visitId: firstVisitId } })).toBe(1)

  const cancelled = await page.evaluate(async ({ orderId, secondVisitId, expectedRevision }) => {
    const response = await fetch(`/api/installations/${orderId}/visits/${secondVisitId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'CANCEL', expectedRevision }),
    })
    return { status: response.status, body: await response.json() }
  }, { orderId, secondVisitId, expectedRevision: workflow.secondVisit.body.revision as number })
  expect(cancelled.status).toBe(200)
  expect(await processInstallationCalendarBatch(db, fake, 10)).toMatchObject({ claimed: 1, completed: 1, retried: 0, attention: 0 })

  expect(await db.integrationOutbox.findMany({
    where: { visitId: secondVisitId }, orderBy: { createdAt: 'asc' }, select: { operation: true, status: true },
  })).toEqual([
    { operation: 'CALENDAR_UPSERT', status: 'COMPLETED' },
    { operation: 'CALENDAR_CANCEL', status: 'COMPLETED' },
  ])
  expect(await db.integrationAttempt.count({ where: { outbox: { visitId: secondVisitId } } })).toBe(2)
  expect(await db.integrationSyncState.count({ where: { visitId: secondVisitId } })).toBe(1)
  expect(fake.snapshot()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: expect.objectContaining({ visitId: firstVisitId }), cancelled: false }),
    expect.objectContaining({ event: expect.objectContaining({ visitId: secondVisitId }), cancelled: true }),
  ]))
})
