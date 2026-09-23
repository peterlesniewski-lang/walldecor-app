import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@/generated/prisma'

const databaseUrl = process.env.E2E_DATABASE_URL

if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E finansów CEO wymaga izolowanego E2E_DATABASE_URL.')
}

let db: PrismaClient
const createdCenters: string[] = []

async function login(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.fill('input[name="username"]', username)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|finance|change-password)/)
}

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  for (const center of [{ id: 'JAG', name: 'Jagiellońska' }, { id: 'PUL', name: 'Puławska' }]) {
    const existing = await db.costCenter.findUnique({ where: { id: center.id } })
    if (!existing) {
      await db.costCenter.create({ data: center })
      createdCenters.push(center.id)
    }
  }
})

test.afterAll(async () => {
  await db.breakEvenRevenueBasis.deleteMany({ where: { year: 2026, month: 6, costCenterId: 'JAG' } })
  await db.revenue.deleteMany({ where: { year: 2026, month: 6, costCenterId: 'JAG' } })
  if (createdCenters.length) await db.costCenter.deleteMany({ where: { id: { in: createdCenters } } })
  await db.$disconnect()
})

test('admin records mixed-rate net from the year chart and still sees it after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/dashboard?year=2026&month=6')
  await expect(page).toHaveURL(/\/login/)

  await login(page, process.env.ADMIN_USERNAME ?? 'admin', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
  await expect(page).toHaveURL(/\/dashboard/)

  for (const entry of [
    { channel: 'SALON', amount: 8000 },
    { channel: 'MONTAZ', amount: 2300 },
  ]) {
    const saved = await page.request.post('/api/revenue', { data: { year: 2026, month: 6, costCenterId: 'JAG', asOfDate: '2026-06-30', ...entry } })
    expect(saved.ok()).toBeTruthy()
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/dashboard?year=2026&month=6')
  await expect(page.getByRole('heading', { name: 'Finanse firmy' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Wykres stycznia do grudnia' })).toBeVisible()
  await expect(page.getByText('Brak pełnego netto').first()).toBeVisible()
  await expect(page.getByText(/8\s?373,98/)).toHaveCount(0)

  await page.getByLabel('Sprzedaż netto — Jagiellońska').fill('8500')
  await page.getByRole('button', { name: 'Zapisz sprzedaż netto' }).click()
  await expect(page.getByText(/8\s?500,00 zł/).first()).toBeVisible()
  await expect(page.getByText(/8\s?373,98/)).toHaveCount(0)

  await page.reload()
  await expect(page).toHaveURL(/year=2026&month=6/)
  await expect(page.getByText(/8\s?500,00 zł/).first()).toBeVisible()
  await expect(page.getByText(/Koszty pracownicze nie są włączone/)).toBeVisible()
  await expect(page.getByText(/Zysk netto/)).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /Lipiec 2026/ }).click()
  await expect(page).toHaveURL(/\/dashboard\?year=2026&month=7/)
  await expect(page.getByRole('button', { name: /Lipiec 2026/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Lipiec 2026', { exact: true })).toBeVisible()
})

test('a non-admin does not open the CEO net dashboard or save revenue net', async ({ page, request }) => {
  const anonymous = await request.post('/api/finance/break-even/settings', {
    data: { action: 'revenue.save', year: 2026, month: 6, costCenterId: 'JAG', netAmount: 1 },
    maxRedirects: 0,
  })
  expect(anonymous.ok()).toBeFalsy()
  expect(anonymous.status()).not.toBe(200)

  const username = `ceonet${Date.now()}`
  const adminLogin = await request.get('/api/auth/csrf')
  const adminCsrf = await adminLogin.json()
  await request.post('/api/auth/callback/credentials', {
    form: {
      username: process.env.ADMIN_USERNAME ?? 'admin',
      password: process.env.ADMIN_PASSWORD ?? 'ChangeMe123!',
      csrfToken: adminCsrf.csrfToken,
      callbackUrl: '/dashboard',
      json: 'true',
    },
  })
  const createdResponse = await request.post('/api/users', {
    data: { username, email: `${username}@example.test`, name: 'Podgląd finansów', role: 'EMPLOYEE' },
  })
  expect(createdResponse.ok()).toBeTruthy()
  const created = await createdResponse.json()
  await db.user.update({ where: { id: created.id }, data: { mustChangePassword: false, passwordChangedAt: new Date() } })

  await login(page, username, created.temporaryPassword)
  await page.goto('/dashboard?year=2026&month=6')
  await expect(page).toHaveURL(/\/finance/)
  await expect(page.getByRole('heading', { name: 'Finanse firmy' })).toHaveCount(0)

  const forbidden = await page.request.post('/api/finance/break-even/settings', {
    data: { action: 'revenue.save', year: 2026, month: 6, costCenterId: 'JAG', netAmount: 1 },
  })
  expect([401, 403]).toContain(forbidden.status())
  await request.delete(`/api/users/${created.id}`)
})
