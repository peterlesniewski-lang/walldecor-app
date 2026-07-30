import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma'

const QA_DATABASE_URL = 'file:/tmp/walldecor-hr-qa.db'
const TEST_MONTH = '2026-07'
const DIVISION_A_ID = 'e2e-division-a'
const DIVISION_B_ID = 'e2e-division-b'
const EMPLOYEE_A_ID = 'e2e-employee-a'
const EMPLOYEE_B_ID = 'e2e-employee-b'
const EMPLOYEE_C_ID = 'e2e-employee-c'
const TEST_EMPLOYEE_IDS = [EMPLOYEE_A_ID, EMPLOYEE_B_ID, EMPLOYEE_C_ID]

function requiredEnvironment(name: 'ADMIN_PASSWORD'): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be set for authenticated HR E2E tests`)
  return value
}

function adminUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || 'admin'
}

function assertQaDatabase(): void {
  if (process.env.DATABASE_URL !== QA_DATABASE_URL) {
    throw new Error(
      `HR E2E tests may only mutate ${QA_DATABASE_URL}; received ` +
      `${process.env.DATABASE_URL ?? 'no DATABASE_URL'}`
    )
  }
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function julyClock(date: string, hour: number, minute = 0): Date {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`)
}

async function prepareQaCatalog(prisma: PrismaClient): Promise<void> {
  assertQaDatabase()
  const username = adminUsername()
  const passwordHash = bcrypt.hashSync(requiredEnvironment('ADMIN_PASSWORD'), 12)
  const existingAdmin = await prisma.user.findUnique({ where: { username } })

  if (existingAdmin) {
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        role: 'ADMIN',
        passwordHash,
        mustChangePassword: false,
        isActive: true,
      },
    })
  } else {
    await prisma.user.create({
      data: {
        id: 'e2e-admin',
        username,
        email: 'e2e-admin@walldecor.test',
        name: 'E2E Admin',
        role: 'ADMIN',
        passwordHash,
        mustChangePassword: false,
        isActive: true,
      },
    })
  }

  await prisma.costCenter.upsert({
    where: { id: 'E2E' },
    update: { name: 'E2E QA' },
    create: { id: 'E2E', name: 'E2E QA', description: 'Temporary Playwright fixtures' },
  })

  await prisma.division.upsert({
    where: { id: DIVISION_A_ID },
    update: { name: 'QA Warszawa', costCenterId: 'E2E' },
    create: { id: DIVISION_A_ID, name: 'QA Warszawa', costCenterId: 'E2E' },
  })
  await prisma.division.upsert({
    where: { id: DIVISION_B_ID },
    update: { name: 'QA Kraków', costCenterId: 'E2E' },
    create: { id: DIVISION_B_ID, name: 'QA Kraków', costCenterId: 'E2E' },
  })

  await prisma.timeTrackingRule.upsert({
    where: { id: 'e2e-time-rule-a' },
    update: {
      divisionId: DIVISION_A_ID,
      dailyHours: 8,
      weeklyHours: 40,
      overtimeThreshold: 8,
    },
    create: {
      id: 'e2e-time-rule-a',
      divisionId: DIVISION_A_ID,
      name: 'QA Warszawa',
      dailyHours: 8,
      weeklyHours: 40,
      overtimeThreshold: 8,
    },
  })
  await prisma.timeTrackingRule.upsert({
    where: { id: 'e2e-time-rule-b' },
    update: {
      divisionId: DIVISION_B_ID,
      dailyHours: 8,
      weeklyHours: 40,
      overtimeThreshold: 8,
    },
    create: {
      id: 'e2e-time-rule-b',
      divisionId: DIVISION_B_ID,
      name: 'QA Kraków',
      dailyHours: 8,
      weeklyHours: 40,
      overtimeThreshold: 8,
    },
  })

  const employees = [
    {
      id: EMPLOYEE_A_ID,
      firstName: 'Alicja',
      lastName: 'Tester',
      email: 'e2e-alicja@walldecor.test',
      divisionId: DIVISION_A_ID,
    },
    {
      id: EMPLOYEE_B_ID,
      firstName: 'Bartosz',
      lastName: 'Tester',
      email: 'e2e-bartosz@walldecor.test',
      divisionId: DIVISION_A_ID,
    },
    {
      id: EMPLOYEE_C_ID,
      firstName: 'Celina',
      lastName: 'Tester',
      email: 'e2e-celina@walldecor.test',
      divisionId: DIVISION_B_ID,
    },
  ]

  for (const employee of employees) {
    await prisma.employee.upsert({
      where: { id: employee.id },
      update: {
        ...employee,
        position: 'Tester QA',
        costCenterId: 'E2E',
        startDate: utcDate('2026-01-01'),
        endDate: null,
        active: true,
      },
      create: {
        ...employee,
        position: 'Tester QA',
        costCenterId: 'E2E',
        startDate: utcDate('2026-01-01'),
        active: true,
      },
    })
  }

  await prisma.leaveType.upsert({
    where: { code: 'E2E_VL' },
    update: {
      name: 'Urlop QA',
      color: '#2563EB',
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
      isActive: true,
    },
    create: {
      id: 'e2e-leave-type',
      code: 'E2E_VL',
      name: 'Urlop QA',
      color: '#2563EB',
      isPaid: true,
      requiresApproval: true,
      tracksBalance: true,
      isActive: true,
    },
  })

  await prisma.customHoliday.upsert({
    where: { id: 'e2e-holiday-global' },
    update: {
      name: 'Święto QA',
      date: utcDate('2026-07-10'),
      divisionId: null,
      isRecurring: false,
      country: 'PL',
    },
    create: {
      id: 'e2e-holiday-global',
      name: 'Święto QA',
      date: utcDate('2026-07-10'),
      divisionId: null,
      isRecurring: false,
      country: 'PL',
    },
  })
}

async function resetQaScenario(): Promise<void> {
  assertQaDatabase()
  const prisma = new PrismaClient()
  try {
    await prisma.break.deleteMany({
      where: { timeEntry: { employeeId: { in: TEST_EMPLOYEE_IDS } } },
    })
    await prisma.timeEntry.deleteMany({
      where: { employeeId: { in: TEST_EMPLOYEE_IDS } },
    })
    await prisma.leaveRequestNew.deleteMany({
      where: { employeeId: { in: TEST_EMPLOYEE_IDS } },
    })

    await prisma.timeEntry.createMany({
      data: [
        {
          id: 'e2e-entry-a-01',
          employeeId: EMPLOYEE_A_ID,
          date: utcDate('2026-07-01'),
          clockIn: julyClock('2026-07-01', 6),
          clockOut: julyClock('2026-07-01', 14),
          totalMinutes: 480,
          breakMinutes: 0,
          overtimeMinutes: 0,
          source: 'manual',
          status: 'pending',
        },
        {
          id: 'e2e-entry-a-02',
          employeeId: EMPLOYEE_A_ID,
          date: utcDate('2026-07-02'),
          clockIn: julyClock('2026-07-02', 6),
          clockOut: julyClock('2026-07-02', 14),
          totalMinutes: 480,
          breakMinutes: 0,
          overtimeMinutes: 0,
          source: 'manual',
          status: 'approved',
        },
      ],
    })

    await prisma.leaveRequestNew.create({
      data: {
        id: 'e2e-leave-a-06',
        employeeId: EMPLOYEE_A_ID,
        leaveTypeId: 'e2e-leave-type',
        startDate: utcDate('2026-07-06'),
        endDate: utcDate('2026-07-06'),
        days: 1,
        status: 'approved',
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Login').fill(adminUsername())
  await page.getByLabel('Hasło').fill(requiredEnvironment('ADMIN_PASSWORD'))
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }))).toEqual({ documentWidth: 390, viewportWidth: 390 })
}

test.describe('Monthly time tracking', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    assertQaDatabase()
    const prisma = new PrismaClient()
    try {
      await prepareQaCatalog(prisma)
    } finally {
      await prisma.$disconnect()
    }
  })

  test.beforeEach(async ({ page }) => {
    await resetQaScenario()
    await loginAsAdmin(page)
  })

  test('keeps the weekly scope and renders the complete team month on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/hr/time-tracking?view=week&week=2026-W27')

    await expect(page.getByRole('button', { name: 'Tydzień', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const weeklyDivision = page.locator('select').first()
    await weeklyDivision.selectOption(DIVISION_A_ID)
    await expect(page).toHaveURL(new RegExp(`divisionId=${DIVISION_A_ID}`))

    const weeklyEmployeeRow = page
      .getByRole('main')
      .getByRole('row')
      .filter({ hasText: 'Tester A.' })
    const approvedEntry = weeklyEmployeeRow.getByText('8h', { exact: true }).nth(1)
    await approvedEntry.click()

    const weeklyEntryDialog = page.getByRole('dialog')
    await expect(weeklyEntryDialog.getByRole('heading', { name: 'Edytuj wpis' })).toBeVisible()
    await weeklyEntryDialog.getByLabel('Notatka').fill('QA weekly edit')

    const weeklyPatchPromise = page.waitForResponse((response) => (
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === '/api/hr/time-tracking/e2e-entry-a-02'
    ))
    await weeklyEntryDialog.getByRole('button', { name: 'Zapisz', exact: true }).click()
    const weeklyPatchResponse = await weeklyPatchPromise
    expect(weeklyPatchResponse.ok()).toBe(true)
    await expect(weeklyEntryDialog).toBeHidden()

    await weeklyEmployeeRow.getByText('8h', { exact: true }).nth(1).click()
    await expect(weeklyEntryDialog.getByLabel('Notatka')).toHaveValue('QA weekly edit')
    await weeklyEntryDialog.getByRole('button', { name: 'Zamknij' }).click()

    await page.getByRole('button', { name: 'Miesiąc', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`view=month.*divisionId=${DIVISION_A_ID}`))
    await expect(page.getByLabel('Oddział')).toHaveValue(DIVISION_A_ID)

    const grid = page.getByRole('main').getByTestId('monthly-team-grid')
    await expect(grid).toBeVisible()
    await expect(grid.locator('th[id^="monthly-day-"]')).toHaveCount(31)
    await expect(grid.locator('#monthly-total-column')).toHaveText('Łącznie')
    await expect(grid.locator('[data-testid^="monthly-employee-cell-"]')).toHaveCount(2)
    await expect(grid.getByTestId(`monthly-total-${EMPLOYEE_A_ID}`)).toHaveText('16h')
    await expect(page.getByTestId(`monthly-cell-${EMPLOYEE_A_ID}-2026-07-06`)).toContainText('E2E_VL')
    await expect(page.getByTestId(`monthly-cell-${EMPLOYEE_A_ID}-2026-07-10`)).toContainText('Święto')

    const stickyPosition = await grid.getByTestId('monthly-employee-header').evaluate(
      (element) => getComputedStyle(element).position
    )
    expect(stickyPosition).toBe('sticky')

    await page.getByTestId(`monthly-cell-${EMPLOYEE_A_ID}-2026-07-01`).getByRole('button').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Edytuj wpis' })).toBeVisible()
    await page.getByRole('button', { name: 'Zamknij' }).click()

    await page.screenshot({
      path: 'test-results/hr-month-team-desktop.png',
      fullPage: true,
    })
  })

  test('saves only dirty rows, preserves failures, fills days, and guards browser history', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(
      `/hr/time-tracking?view=month&mode=employee&month=${TEST_MONTH}` +
      `&divisionId=${DIVISION_A_ID}&employeeId=${EMPLOYEE_A_ID}`
    )
    await expect(page.getByTestId('monthly-employee-mode')).toBeVisible()

    const batchPayloads: Array<{ rows: Array<{ date: string }> }> = []
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/hr/time-tracking/batch'
      ) {
        batchPayloads.push(request.postDataJSON() as { rows: Array<{ date: string }> })
      }
    })

    await page.getByLabel('Wejście 2026-07-01').fill('08:15')
    await page.getByLabel('Wyjście 2026-07-02').fill('07:00')
    await expect(page.getByRole('button', { name: 'Zapisz zmiany (2)' })).toBeEnabled()
    await page.getByRole('button', { name: 'Zapisz zmiany (2)' }).click()

    await expect(page.getByRole('button', { name: 'Zapisz zmiany (1)' })).toBeEnabled()
    await expect(page.getByLabel('Wyjście 2026-07-02')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.locator('#monthly-employee-error-2026-07-02')).not.toBeEmpty()
    expect(batchPayloads[0]?.rows.map((row) => row.date)).toEqual([
      '2026-07-01',
      '2026-07-02',
    ])

    await page.getByLabel('Wyjście 2026-07-02').fill('17:00')
    await page.getByRole('button', { name: 'Zapisz zmiany (1)' }).click()
    await expect(page.getByRole('button', { name: 'Zapisz zmiany (0)' })).toBeDisabled()
    expect(batchPayloads[1]?.rows.map((row) => row.date)).toEqual(['2026-07-02'])

    await page.getByRole('button', { name: 'Następny miesiąc' }).click()
    await expect(page).toHaveURL(/month=2026-08/)
    await page.getByLabel('Wejście 2026-08-03').fill('08:10')
    await expect(page.getByRole('button', { name: 'Zapisz zmiany (1)' })).toBeEnabled()

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Masz niezapisane zmiany. Odrzucić je?')
      await dialog.dismiss()
    })
    await page.evaluate(() => window.history.back())
    await expect(page).toHaveURL(/month=2026-08/)
    await expect(page.getByLabel('Wejście 2026-08-03')).toHaveValue('08:10')

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe('Masz niezapisane zmiany. Odrzucić je?')
      await dialog.accept()
    })
    await page.evaluate(() => window.history.back())
    await expect(page).toHaveURL(/month=2026-07/)
    await expect(page.getByRole('button', { name: 'Zapisz zmiany (0)' })).toBeDisabled()

    await page.evaluate(() => window.history.forward())
    await expect(page).toHaveURL(/month=2026-08/)
    const employeeSelect = page.getByRole('combobox', {
      name: 'Pracownik',
      exact: true,
    })
    await expect(employeeSelect).toHaveValue(EMPLOYEE_A_ID)

    await page.getByRole('button', { name: 'Poprzedni miesiąc' }).click()
    await expect(page).toHaveURL(/month=2026-07/)
    await employeeSelect.selectOption(EMPLOYEE_B_ID)
    await expect(page).toHaveURL(new RegExp(`employeeId=${EMPLOYEE_B_ID}`))

    await page.getByRole('button', { name: 'Wypełnij dni robocze' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Od', { exact: true }).fill('2026-07-20')
    await dialog.getByLabel('Do', { exact: true }).fill('2026-07-21')
    await dialog.getByLabel('Przerwa w minutach').fill('30')
    const defaultClockIn = await dialog.getByLabel('Godzina wejścia').inputValue()
    const defaultClockOut = await dialog.getByLabel('Godzina wyjścia').inputValue()

    const previewResponsePromise = page.waitForResponse((response) => {
      if (
        response.request().method() !== 'POST' ||
        new URL(response.url()).pathname !== '/api/hr/time-tracking/monthly/fill'
      ) {
        return false
      }
      return response.request().postDataJSON().preview === true
    })
    await dialog.getByRole('button', { name: 'Sprawdź' }).click()
    const preview = await (await previewResponsePromise).json()
    expect(preview.counts.eligible).toBe(2)
    await expect(dialog.getByText('Do zapisania').locator('..')).toContainText('2')

    const applyResponsePromise = page.waitForResponse((response) => {
      if (
        response.request().method() !== 'POST' ||
        new URL(response.url()).pathname !== '/api/hr/time-tracking/monthly/fill'
      ) {
        return false
      }
      return response.request().postDataJSON().preview === false
    })
    await dialog.getByRole('button', { name: 'Zastosuj' }).click()
    const applied = await (await applyResponsePromise).json()
    expect(applied.saved).toHaveLength(preview.counts.eligible)
    await expect(dialog).toBeHidden()
    await expect(page.getByLabel('Wejście 2026-07-20')).toHaveValue(defaultClockIn)
    await expect(page.getByLabel('Wyjście 2026-07-21')).toHaveValue(defaultClockOut)
  })

  test('keeps the monthly team and employee workflows usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(
      `/hr/time-tracking?view=month&mode=team&month=${TEST_MONTH}` +
      `&divisionId=${DIVISION_A_ID}`
    )

    const main = page.getByRole('main')
    const grid = main.getByTestId('monthly-team-grid')
    await expect(grid).toBeVisible()
    await expectNoDocumentOverflow(page)
    const gridDimensions = await grid.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(gridDimensions.scrollWidth).toBeGreaterThan(gridDimensions.clientWidth)

    const stickyHeader = grid.getByTestId('monthly-employee-header')
    const stickyXBefore = (await stickyHeader.boundingBox())?.x
    await grid.evaluate((element) => {
      element.scrollLeft = 720
    })
    await expect.poll(async () => grid.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    const stickyXAfter = (await stickyHeader.boundingBox())?.x
    expect(stickyXAfter).toBeCloseTo(stickyXBefore ?? 0, 0)

    await page.screenshot({
      path: 'test-results/hr-month-team-mobile.png',
      fullPage: true,
    })

    await page.getByRole('button', { name: 'Pracownik', exact: true }).click()
    await expect(page).toHaveURL(/mode=employee/)
    await expect(main.getByTestId('monthly-employee-mode')).toBeVisible()
    await expectNoDocumentOverflow(page)

    const timeInput = page.getByLabel('Wejście 2026-07-01')
    await timeInput.scrollIntoViewIfNeeded()
    await expect(timeInput).toBeVisible()
    const inputBox = await timeInput.boundingBox()
    expect(inputBox?.height).toBeGreaterThanOrEqual(36)
    await timeInput.fill('08:10')

    const saveButton = page.getByRole('button', { name: 'Zapisz zmiany (1)' })
    await saveButton.scrollIntoViewIfNeeded()
    await expect(saveButton).toBeVisible()

    await timeInput.fill('08:00')
    await page.getByRole('button', { name: 'Wypełnij dni robocze' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Godzina wejścia')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Sprawdź' })).toBeVisible()

    const dialogBox = await dialog.boundingBox()
    expect(dialogBox?.x).toBeGreaterThanOrEqual(0)
    expect((dialogBox?.x ?? 0) + (dialogBox?.width ?? 0)).toBeLessThanOrEqual(390)
    expect(dialogBox?.height).toBeLessThanOrEqual(812)

    await page.screenshot({
      path: 'test-results/hr-month-employee-mobile.png',
      fullPage: true,
    })
  })
})
