import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma'

// Monthly payroll acceptance on the isolated, freshly migrated Playwright database.
// Every person and amount below is synthetic test data.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const EVIDENCE_DIR = path.join(process.cwd(), 'docs/evidence/payroll-2026-09-22')
const EMPLOYEE_A = { id: 'e2e-payroll-a', username: 'payrolla', firstName: 'Testowa', lastName: 'Płacowa' }
const EMPLOYEE_B = { id: 'e2e-payroll-b', username: 'payrollb', firstName: 'Testowy', lastName: 'Sąsiad' }
const EMPLOYEE_PASSWORD = 'Test-Employee-123!'

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Payroll E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
  }
  return databaseUrl
}

async function login(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Login').fill(username)
  await page.getByLabel('Hasło').fill(password)
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function restartServer(databaseUrl: string) {
  const directory = path.dirname(databaseUrl.slice('file:'.length))
  const restartId = `payroll-${Date.now()}`
  await writeFile(path.join(directory, 'restart-request'), restartId, { mode: 0o600 })
  await expect.poll(
    async () => readFile(path.join(directory, 'restart-complete'), 'utf8').catch(() => ''),
    { timeout: 100_000 }
  ).toBe(restartId)
}

async function settlementCard(page: Page) {
  return page.getByRole('region', { name: 'Podsumowanie rozliczenia' })
}

async function employeeContext(browser: Browser, username: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await login(page, username, EMPLOYEE_PASSWORD)
  return { context, page }
}

test.describe('HR payroll — admin monthly settlement', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let databaseUrl = ''
  let settlementId = ''

  test.beforeAll(async () => {
    databaseUrl = assertQaDatabase()
    await mkdir(EVIDENCE_DIR, { recursive: true })
    const prisma = new PrismaClient()
    try {
      await prisma.costCenter.upsert({ where: { id: 'JAG' }, create: { id: 'JAG', name: 'Salon JAG' }, update: {} })
      const passwordHash = await bcrypt.hash(EMPLOYEE_PASSWORD, 10)
      for (const employee of [EMPLOYEE_A, EMPLOYEE_B]) {
        await prisma.employee.create({
          data: {
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            email: `${employee.username}@example.test`,
            position: 'Doradca (test)',
            costCenterId: 'JAG',
            startDate: new Date('2025-01-01T00:00:00Z'),
            employmentType: 'UoP',
          },
        })
        await prisma.user.create({
          data: {
            username: employee.username,
            email: `${employee.username}@example.test`,
            name: `${employee.firstName} ${employee.lastName}`,
            role: 'EMPLOYEE',
            employeeId: employee.id,
            passwordHash,
            passwordChangedAt: new Date(),
          },
        })
      }
      const at = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`)
      await prisma.timeEntry.createMany({
        data: [
          { id: 'e2e-pay-te-wed', employeeId: EMPLOYEE_A.id, date: at('2026-08-05', 0), clockIn: at('2026-08-05', 9), clockOut: at('2026-08-05', 18), totalMinutes: 540, breakMinutes: 0, overtimeMinutes: 60, status: 'approved', source: 'bulk' },
          { id: 'e2e-pay-te-sat', employeeId: EMPLOYEE_A.id, date: at('2026-08-08', 0), clockIn: at('2026-08-08', 9), clockOut: at('2026-08-08', 12), totalMinutes: 180, breakMinutes: 0, overtimeMinutes: 180, status: 'approved', source: 'bulk' },
          { id: 'e2e-pay-te-pending', employeeId: EMPLOYEE_A.id, date: at('2026-08-12', 0), clockIn: at('2026-08-12', 9), clockOut: at('2026-08-12', 17), totalMinutes: 510, breakMinutes: 0, overtimeMinutes: 30, status: 'pending', source: 'manual' },
        ],
      })
      await prisma.overtimeRequest.create({
        data: { employeeId: EMPLOYEE_A.id, date: at('2026-08-08', 0), minutes: 180, reason: 'Sobota (test)', status: 'approved', resolution: 'time_off' },
      })
    } finally {
      await prisma.$disconnect()
    }
  })

  test('sets base, pulls calendar hours, adds bonus/correction, confirms payroll office data and approves', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await login(page, process.env.ADMIN_USERNAME ?? 'admin', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
    await page.goto('/hr/payroll?month=2026-08')
    await expect(page.getByRole('heading', { name: /sierpień/ })).toBeVisible()

    // 1. Base salary with an effective date.
    const row = page.getByTestId(`payroll-row-${EMPLOYEE_A.id}`)
    await row.getByRole('button', { name: 'Podstawa' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Obowiązuje od').fill('2026-01-01')
    await dialog.getByLabel('Kwota (PLN)').fill('4321,00')
    await dialog.getByRole('button', { name: 'Dodaj podstawę' }).click()
    await expect(dialog.getByText('od 2026-01-01')).toBeVisible()
    await dialog.getByRole('button', { name: 'Zamknij' }).first().click()
    await expect(row.getByText('4321,00 zł')).toBeVisible()

    // 2. Draft settlement pulls overtime from the HR calendar; pending entries do not count.
    await row.getByRole('button', { name: 'Przygotuj rozliczenie' }).click()
    await expect(page).toHaveURL(/\/hr\/payroll\/[^/?]+$/)
    settlementId = page.url().split('/').pop()!
    await expect(page.getByTestId('ot-2026-08-12').getByText('niezatwierdzony wpis')).toBeVisible()
    await expect(page.getByTestId('ot-2026-08-08').getByText('z wniosku')).toBeVisible()
    await expect(page.getByTestId('approval-blockers')).toContainText('nie zostały zatwierdzone')
    // The staggered entrance animation must finish: content ends fully opaque for the user.
    await expect(page.getByRole('region', { name: 'Podsumowanie rozliczenia' })).toHaveCSS('opacity', '1')
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-draft-pending-calendar.png'), fullPage: true, animations: 'disabled' })

    // Manager approves the entry in the existing calendar module; payroll detects the change.
    const approve = await page.request.patch('/api/hr/time-tracking/e2e-pay-te-pending/approve')
    expect(approve.status()).toBe(200)
    await page.reload()
    await expect(page.getByRole('status').filter({ hasText: 'zmieniły się od ostatniego pobrania' })).toBeVisible()
    await page.getByRole('button', { name: 'Pobierz ponownie' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'zmieniły się od ostatniego pobrania' })).toBeHidden()

    for (const day of ['2026-08-05', '2026-08-12']) {
      await page.getByTestId(`ot-${day}`).getByRole('button', { name: 'Wypłata' }).click()
      await expect(page.getByTestId(`ot-${day}`).getByRole('button', { name: 'Wypłata' })).toHaveAttribute('aria-pressed', 'true')
    }
    await expect(page.getByText('do wypłaty 1 h 30 min · czas wolny 3 h')).toBeVisible()

    // 3. Bonus + correction with change history.
    const adjustments = page.getByRole('region', { name: 'Premie i korekty' })
    await adjustments.getByLabel('Kwota (PLN)').fill('250,00')
    await adjustments.getByLabel('Nazwa').fill('Premia sprzedażowa (test)')
    await adjustments.getByRole('button', { name: 'Dodaj pozycję' }).click()
    await expect(adjustments.getByText('250,00 zł').first()).toBeVisible()
    await adjustments.getByRole('button', { name: 'Popraw' }).click()
    const editForm = adjustments.locator('form').first()
    await editForm.getByLabel('Kwota (PLN)').fill('300,00')
    await editForm.getByLabel('Powód zmiany (trafi do historii)').fill('Weryfikacja wyniku sprzedaży')
    await editForm.getByRole('button', { name: 'Zapisz zmianę' }).click()
    await expect(adjustments.getByText('premie 300,00 zł')).toBeVisible()

    await adjustments.getByLabel('Rodzaj').selectOption('CORRECTION')
    await adjustments.getByLabel('Kwota (PLN)').fill('-40,00')
    await adjustments.getByLabel('Nazwa').fill('Korekta omyłkowa (test)')
    await adjustments.getByRole('button', { name: 'Dodaj pozycję' }).click()
    await expect(adjustments.getByText('korekty -40,00 zł')).toBeVisible()
    await adjustments.getByRole('button', { name: 'Popraw' }).nth(1).click()
    const deleteForm = adjustments.locator('form').first()
    await deleteForm.getByLabel('Powód zmiany (trafi do historii)').fill('Wpisana omyłkowo')
    await deleteForm.getByRole('button', { name: 'Usuń' }).click()
    await expect(adjustments.getByText('korekty 0,00 zł')).toBeVisible()

    // 4. Payroll office data — employer cost entered explicitly, never derived.
    const office = page.getByRole('region', { name: 'Dane od kadrowej' })
    await office.getByLabel('Brutto (ostateczne)').fill('4 781,11')
    await office.getByLabel('Netto do wypłaty').fill('3 518,34')
    await office.getByLabel('Pełny koszt pracodawcy').fill('5 760,26')
    await office.getByLabel('Numer listy płac / notatka').fill('LP test 08/2026')
    await office.getByRole('button', { name: 'Potwierdź dane kadrowej' }).click()
    const card = await settlementCard(page)
    await expect(card.getByText('5760,26 zł')).toBeVisible()
    await expect(card.getByText('Kadrowa potwierdziła')).toBeVisible()

    // 5. Approval freezes version 1.
    await page.getByRole('button', { name: 'Zatwierdź wersję 1' }).click()
    await expect(card.getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Wersje' }).getByText('obowiązuje')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('region', { name: 'Podsumowanie rozliczenia' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-approved-v1.png'), fullPage: true, animations: 'disabled' })
  })

  test('re-reads the approved settlement after a real server restart', async ({ page }) => {
    await restartServer(databaseUrl)
    await login(page, process.env.ADMIN_USERNAME ?? 'admin', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
    await page.goto(`/hr/payroll/${settlementId}`)
    const card = await settlementCard(page)
    await expect(card.getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(card.getByText('4781,11 zł')).toBeVisible()
    await expect(card.getByText('3518,34 zł')).toBeVisible()
    await expect(card.getByText('5760,26 zł')).toBeVisible()
    const history = page.getByRole('region', { name: 'Historia zmian' })
    await expect(history.getByText('Zmieniono pozycję · E2E Administrator')).toBeVisible()
    await expect(history.getByText('Powód: Wpisana omyłkowo')).toBeVisible()
    await page.goto('/hr/payroll?month=2026-08')
    await expect(page.getByTestId(`payroll-row-${EMPLOYEE_A.id}`).getByText('5760,26 zł')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Pracownicy w miesiącu' })).toHaveCSS('opacity', '1')
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '00-month-list.png'), animations: 'disabled' })

    await page.goto(`/hr/payroll/${settlementId}`)
    await expect(card).toHaveCSS('opacity', '1')
    const narrowDesktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(narrowDesktopOverflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02b-detail-1280.png'), animations: 'disabled' })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/hr/payroll/${settlementId}`)
    await expect(card.getByText('Zatwierdzone · v1')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-after-restart-mobile.png'), fullPage: true, animations: 'disabled' })
  })

  test('denies payroll data to another employee and to the settled employee', async ({ browser }) => {
    for (const employee of [EMPLOYEE_B, EMPLOYEE_A]) {
      const { context, page } = await employeeContext(browser, employee.username)
      try {
        const api = await Promise.all([
          page.request.get(`/api/hr/payroll/settlements/${settlementId}`),
          page.request.get('/api/hr/payroll/settlements?month=2026-08'),
          page.request.get(`/api/hr/payroll/base-salaries?employeeId=${EMPLOYEE_A.id}`),
          page.request.patch(`/api/hr/payroll/settlements/${settlementId}`, { data: { action: 'reopen', expectedRevision: 1, reason: 'próba' } }),
        ])
        expect(api.map((response) => response.status())).toEqual([403, 403, 403, 403])
        const body = await api[0].text()
        expect(body).not.toContain('5760')

        await page.goto(`/hr/payroll/${settlementId}`)
        await expect(page).not.toHaveURL(/\/hr\/payroll/)
        await expect(page.getByRole('link', { name: 'Wynagrodzenia' })).toHaveCount(0)
      } finally {
        await context.close()
      }
    }
  })
})
