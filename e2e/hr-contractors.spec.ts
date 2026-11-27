import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma'

// External contractors (B2B cards) acceptance on the isolated, freshly migrated Playwright database.
// Every person below is synthetic test data.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const EVIDENCE_DIR = path.join(process.cwd(), 'docs/evidence/2026-11-24-hr-contractors')
const PASSWORD = 'Test-Contractors-123!'

const DIV_A = 'e2e-ctr-div-a'
const DIV_B = 'e2e-ctr-div-b'
const DEPARTMENT = 'e2e-ctr-dep'

type Person = { id: string; firstName: string; lastName: string }
const STAFF: Person = { id: 'e2e-ctr-staff', firstName: 'Testowa', lastName: 'Pracownicza' }
const BLANK: Person = { id: 'e2e-ctr-blank', firstName: 'Testowa', lastName: 'Bezumowna' }
const MANAGER_CARD: Person = { id: 'e2e-ctr-manager', firstName: 'Testowa', lastName: 'Kierownicza' }
const CONTRACTOR: Person = { id: 'e2e-ctr-contractor', firstName: 'Testowy', lastName: 'Wykonawczy' }
const SWITCHER: Person = { id: 'e2e-ctr-switcher', firstName: 'Testowy', lastName: 'Przechodni' }
const STAFF_B: Person = { id: 'e2e-ctr-staff-b', firstName: 'Testowa', lastName: 'Obcodzialowa' }
const CONTRACTOR_B: Person = { id: 'e2e-ctr-contractor-b', firstName: 'Testowy', lastName: 'Obcowykonawczy' }
const EMPLOYEE_LOGIN = 'ctremployee'
const MANAGER_LOGIN = 'ctrmanager'
const INSTALLER_LOGIN = 'ctrinstaller'

const nameOf = (person: Person) => `${person.firstName} ${person.lastName}`

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Contractors E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
  }
}

async function login(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Login').fill(username)
  await page.getByLabel('Hasło').fill(password)
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const loginAdmin = (page: Page) => login(page, process.env.ADMIN_USERNAME ?? 'admin', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')

async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient()
  try {
    return await fn(db)
  } finally {
    await db.$disconnect()
  }
}

const rows = (page: Page) => page.locator('table.data-table tbody tr')
const staffCounter = (page: Page) => page.getByTestId('employees-tab-count-staff')
const contractorsCounter = (page: Page) => page.getByTestId('employees-tab-count-contractors')
const staffTab = (page: Page) => page.getByRole('tab', { name: /^Pracownicy/ })
const contractorsTab = (page: Page) => page.getByRole('tab', { name: /^Wykonawcy/ })

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: path.join(EVIDENCE_DIR, name), fullPage, animations: 'disabled' })
}

/** Open a page and wait until it shows `visible`; then assert `hidden` is not on it. */
async function expectPeopleOn(page: Page, url: string, visible: Person[], hidden: Person[], shortNames = false) {
  // The schedule grid shortens last names to eight characters.
  const label = (person: Person) => (shortNames ? person.lastName.slice(0, 7) : person.lastName)
  await page.goto(url)
  for (const person of visible) {
    await expect(page.getByText(label(person)).first(), `${person.lastName} on ${url}`).toBeAttached()
  }
  for (const person of hidden) {
    await expect(page.getByText(label(person)), `${person.lastName} must not be on ${url}`).toHaveCount(0)
  }
}

test.describe('HR — external contractors outside HR', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  test.beforeAll(async () => {
    assertQaDatabase()
    await mkdir(EVIDENCE_DIR, { recursive: true })
    const passwordHash = await bcrypt.hash(PASSWORD, 10)
    await withDb(async (db) => {
      await db.costCenter.upsert({ where: { id: 'JAG' }, create: { id: 'JAG', name: 'Salon JAG' }, update: {} })
      await db.division.createMany({
        data: [
          { id: DIV_A, name: 'Oddział kontraktowy A', costCenterId: 'JAG' },
          { id: DIV_B, name: 'Oddział kontraktowy B', costCenterId: 'JAG' },
        ],
      })
      await db.department.create({ data: { id: DEPARTMENT, name: 'Dział kontraktowy', divisionId: DIV_A } })
      const card = (person: Person, extra: Record<string, unknown> = {}) => ({
        ...person,
        email: `${person.id}@example.test`,
        position: 'Doradca (test)',
        costCenterId: 'JAG',
        startDate: new Date('2026-01-01T00:00:00Z'),
        employmentType: 'UoP' as string | null,
        divisionId: DIV_A,
        departmentId: DEPARTMENT,
        ...extra,
      })
      await db.employee.createMany({
        data: [
          card(STAFF),
          card(BLANK, { employmentType: null }),
          card(MANAGER_CARD),
          card(CONTRACTOR, { employmentType: 'B2B' }),
          card(SWITCHER, { employmentType: 'B2B' }),
          card(STAFF_B, { divisionId: DIV_B, departmentId: null }),
          card(CONTRACTOR_B, { employmentType: 'B2B', divisionId: DIV_B, departmentId: null }),
        ],
      })
      const vl = await db.leaveType.upsert({ where: { code: 'VL' }, create: { name: 'Urlop wypoczynkowy', code: 'VL' }, update: {} })
      for (const person of [STAFF, BLANK, CONTRACTOR]) {
        await db.leaveRequestNew.create({
          data: {
            employeeId: person.id, leaveTypeId: vl.id, status: 'pending', days: 1,
            startDate: new Date('2026-12-14T12:00:00Z'), endDate: new Date('2026-12-14T12:00:00Z'),
          },
        })
        await db.overtimeRequest.create({
          data: { employeeId: person.id, date: new Date('2026-11-10T12:00:00Z'), minutes: 60, reason: 'Test nadgodzin', status: 'pending' },
        })
        // History of a contractor must stay in the database while no HR list shows it.
        await db.leaveBalanceNew.create({ data: { employeeId: person.id, leaveTypeId: vl.id, year: 2026, totalDays: 26 } })
        await db.timeEntry.create({
          data: {
            employeeId: person.id, date: new Date('2026-11-10T12:00:00Z'),
            clockIn: new Date('2026-11-10T09:00:00Z'), clockOut: new Date('2026-11-10T17:00:00Z'),
            totalMinutes: 480, breakMinutes: 30, status: 'approved',
          },
        })
      }
      await db.user.createMany({
        data: [
          { username: MANAGER_LOGIN, email: `${MANAGER_LOGIN}@example.test`, name: nameOf(MANAGER_CARD), role: 'MANAGER', employeeId: MANAGER_CARD.id, passwordHash, passwordChangedAt: new Date() },
          { username: EMPLOYEE_LOGIN, email: `${EMPLOYEE_LOGIN}@example.test`, name: nameOf(STAFF), role: 'EMPLOYEE', employeeId: STAFF.id, passwordHash, passwordChangedAt: new Date() },
          { username: INSTALLER_LOGIN, email: `${INSTALLER_LOGIN}@example.test`, name: nameOf(CONTRACTOR_B), role: 'INSTALLER', employeeId: CONTRACTOR_B.id, passwordHash, passwordChangedAt: new Date() },
        ],
      })
    })
  })

  test('splits staff and contractors into two tabs whose counters match the rows', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/employees')

    // Staff tab (default): no B2B card, the card with an empty employment type is present.
    await expect(staffTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(STAFF.lastName).first()).toBeVisible()
    await expect(page.getByText(BLANK.lastName).first()).toBeVisible()
    await expect(page.getByText(CONTRACTOR.lastName)).toHaveCount(0)
    await expect(page.locator('table.data-table tbody').getByText('B2B')).toHaveCount(0)

    const dbCounts = await withDb(async (db) => ({
      staff: await db.employee.count({ where: { active: true, OR: [{ employmentType: null }, { employmentType: { not: 'B2B' } }] } }),
      contractors: await db.employee.count({ where: { active: true, employmentType: 'B2B' } }),
    }))
    await expect(staffCounter(page)).toHaveText(String(dbCounts.staff))
    await expect(contractorsCounter(page)).toHaveText(String(dbCounts.contractors))
    await expect(rows(page)).toHaveCount(Math.min(dbCounts.staff, 20))

    // The employment-type filter on the staff tab does not offer B2B.
    const typeFilter = page.locator('select').filter({ has: page.locator('option', { hasText: 'Wszystkie typy' }) })
    await expect(typeFilter.locator('option', { hasText: 'B2B' })).toHaveCount(0)
    await shot(page, 'employees-staff-wide.png')

    // Contractors tab: only B2B, no employment-type filter at all.
    await contractorsTab(page).click()
    await expect(page).toHaveURL(/kind=contractors/)
    await expect(contractorsTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(CONTRACTOR.lastName).first()).toBeVisible()
    await expect(page.getByText(STAFF.lastName)).toHaveCount(0)
    await expect(page.getByText(BLANK.lastName)).toHaveCount(0)
    await expect(rows(page)).toHaveCount(Math.min(dbCounts.contractors, 20))
    for (const row of await rows(page).all()) await expect(row).toContainText('B2B')
    await expect(page.locator('select').filter({ has: page.locator('option', { hasText: 'Wszystkie typy' }) })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Dodaj wykonawcę' })).toBeVisible()
    await shot(page, 'employees-contractors-wide.png')

    // Search and tab switching keep working together.
    await page.getByPlaceholder('Szukaj wykonawcy...').fill(CONTRACTOR_B.lastName)
    await expect(rows(page)).toHaveCount(1)
    await expect(contractorsCounter(page)).toHaveText('1')
    await staffTab(page).click()
    await expect(page).toHaveURL(/search=/)
    await expect(page.getByText(CONTRACTOR_B.lastName)).toHaveCount(0)
    await expect(rows(page)).toHaveCount(0)
  })

  test('shows both tabs at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAdmin(page)
    await page.goto('/hr/employees')
    await expect(staffTab(page)).toBeVisible()
    await expect(contractorsTab(page)).toBeVisible()
    await shot(page, 'employees-staff-390.png')
    await contractorsTab(page).click()
    await expect(page.getByText(CONTRACTOR.lastName).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Dodaj wykonawcę' })).toBeVisible()
    await shot(page, 'employees-contractors-390.png')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('adds a contractor from the tab: no leave balances and a profile without time or leave tabs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/employees?kind=contractors')
    await page.getByRole('link', { name: 'Dodaj wykonawcę' }).click()
    await expect(page.getByRole('heading', { name: 'Nowy wykonawca' })).toBeVisible()

    await page.locator('#firstName').fill('Testowy')
    await page.locator('#lastName').fill('Dopisany')
    await page.locator('#email').fill('e2e-ctr-added@example.test')
    await page.getByRole('button', { name: 'Dalej' }).click()
    // The employment type is fixed to B2B and cannot be changed.
    await expect(page.locator('#employmentType')).toBeDisabled()
    await expect(page.locator('#employmentType')).toHaveValue(/B2B/)
    await page.locator('#costCenterId').selectOption('JAG')
    await page.locator('#position').fill('Montażysta (test)')
    await page.locator('#startDate').fill('2026-11-02')
    await page.getByRole('button', { name: 'Dalej' }).click()
    await page.getByRole('button', { name: 'Utwórz wykonawcę' }).click()

    await expect(page).toHaveURL(/\/hr\/employees\?kind=contractors/)
    await expect(page.getByText('Dopisany').first()).toBeVisible()
    await staffTab(page).click()
    await expect(page.getByText('Dopisany')).toHaveCount(0)

    const created = await withDb((db) => db.employee.findUniqueOrThrow({ where: { email: 'e2e-ctr-added@example.test' } }))
    expect(created.employmentType).toBe('B2B')
    expect(await withDb((db) => db.leaveBalanceNew.count({ where: { employeeId: created.id } }))).toBe(0)

    // Profile: basic data and the label only.
    await page.goto(`/hr/employees/${created.id}`)
    await expect(page.getByRole('heading', { name: 'Testowy Dopisany' })).toBeVisible()
    await expect(page.getByText('Wykonawca zewnętrzny').first()).toBeVisible()
    await expect(page.getByText('Dane wykonawcy')).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByText(/Roczny limit|Saldo urlopowe/)).toHaveCount(0)
    await shot(page, 'contractor-profile.png')
    await page.setViewportSize({ width: 390, height: 844 })
    await shot(page, 'contractor-profile-390.png')
  })

  test('edits a contractor and hides the card from the contractors tab like any other card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    const created = await withDb((db) => db.employee.findUniqueOrThrow({ where: { email: 'e2e-ctr-added@example.test' } }))

    await page.goto(`/hr/employees/${created.id}/edit`)
    await page.locator('#phone').fill('+48 500 100 200')
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click()
    await expect(page).toHaveURL(new RegExp(`/hr/employees/${created.id}$`))
    expect((await withDb((db) => db.employee.findUniqueOrThrow({ where: { id: created.id } }))).phone).toBe('+48 500 100 200')

    await page.goto('/hr/employees?kind=contractors&search=Dopisany')
    await expect(rows(page)).toHaveCount(1)
    await rows(page).first().getByRole('button', { name: 'Akcje' }).click()
    await page.getByRole('menuitem', { name: 'Ukryj' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Ukryj' }).click()
    await expect(page.getByText('Dopisany')).toHaveCount(0)
    expect((await withDb((db) => db.employee.findUniqueOrThrow({ where: { id: created.id } }))).active).toBe(false)
  })

  test('moves a card between the tabs when the employment type changes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)

    // Before: B2B — not in the schedule, the leave balances or the payroll sheet.
    await expectPeopleOn(page, '/hr/time-tracking/schedule', [STAFF], [SWITCHER], true)
    await page.goto('/hr/payroll?month=2026-10')
    await expect(page.getByTestId(`payroll-row-${STAFF.id}`)).toBeVisible()
    await expect(page.getByTestId(`payroll-row-${SWITCHER.id}`)).toHaveCount(0)

    // B2B -> UoP in the edit form.
    await page.goto(`/hr/employees/${SWITCHER.id}/edit`)
    await page.locator('#employmentType').selectOption('UoP')
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click()
    await expect(page).toHaveURL(new RegExp(`/hr/employees/${SWITCHER.id}$`))
    await expect(page.getByRole('tab', { name: 'Urlopy' })).toBeVisible()

    await page.goto('/hr/employees')
    await expect(page.getByText(SWITCHER.lastName).first()).toBeVisible()
    await page.goto('/hr/employees?kind=contractors')
    await expect(page.getByText(SWITCHER.lastName)).toHaveCount(0)

    await expectPeopleOn(page, '/hr/time-tracking/schedule', [STAFF, SWITCHER], [CONTRACTOR], true)
    await page.goto('/hr/leave/balances')
    await expect(page.locator('select option', { hasText: nameOf(SWITCHER) })).toHaveCount(1)
    await page.goto('/hr/payroll?month=2026-10')
    await expect(page.getByTestId(`payroll-row-${SWITCHER.id}`)).toBeVisible()

    // UoP -> B2B again: the card leaves all of them; its data stays in the database.
    await page.goto(`/hr/employees/${SWITCHER.id}/edit`)
    await page.reload() // do not reuse the client-side cache of the earlier edit page
    await expect(page.locator('#employmentType')).toHaveValue('UoP')
    await page.locator('#employmentType').selectOption('B2B')
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click()
    await expect(page).toHaveURL(new RegExp(`/hr/employees/${SWITCHER.id}$`))
    await expect(page.getByText('Wykonawca zewnętrzny').first()).toBeVisible()
    await expectPeopleOn(page, '/hr/time-tracking/schedule', [STAFF], [SWITCHER], true)
    await page.goto('/hr/leave/balances')
    await expect(page.locator('select option', { hasText: STAFF.lastName })).toHaveCount(1)
    await expect(page.locator('select option', { hasText: SWITCHER.lastName })).toHaveCount(0)
    await page.goto('/hr/payroll?month=2026-10')
    await expect(page.getByTestId(`payroll-row-${SWITCHER.id}`)).toHaveCount(0)
  })

  test('keeps a contractor out of every HR place while staff and an empty employment type stay', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    const staffShown = [STAFF, BLANK]
    const hidden = [CONTRACTOR, CONTRACTOR_B]

    await expectPeopleOn(page, '/hr/time-tracking/schedule', staffShown, hidden, true)
    await expectPeopleOn(page, '/hr/time-tracking', staffShown, hidden)
    await expectPeopleOn(page, '/hr/time-tracking/overtime', staffShown, hidden)
    await expectPeopleOn(page, '/hr/leave', staffShown, hidden)
    await expectPeopleOn(page, '/hr/leave/approval', staffShown, hidden)

    await page.goto('/hr/leave/balances')
    await expect(page.locator('select option', { hasText: STAFF.lastName })).toHaveCount(1)
    await expect(page.locator('select option', { hasText: BLANK.lastName })).toHaveCount(1)
    await expect(page.locator('select option', { hasText: CONTRACTOR.lastName })).toHaveCount(0)

    // Supervisor pickers on the new and edit forms (step 3 of the new form lists the supervisors).
    await page.goto('/hr/employees/new')
    await page.locator('#firstName').fill('Testowa')
    await page.locator('#lastName').fill('Podglad')
    await page.locator('#email').fill('e2e-ctr-preview@example.test')
    await page.getByRole('button', { name: 'Dalej' }).click()
    await page.locator('#employmentType').selectOption('UoP')
    await page.locator('#costCenterId').selectOption('JAG')
    await page.locator('#position').fill('Test')
    await page.locator('#startDate').fill('2026-11-02')
    await page.getByRole('button', { name: 'Dalej' }).click()
    await expect(page.locator('#managerId option', { hasText: STAFF.lastName })).toHaveCount(1)
    await expect(page.locator('#managerId option', { hasText: BLANK.lastName })).toHaveCount(1)
    await expect(page.locator('#managerId option', { hasText: CONTRACTOR.lastName })).toHaveCount(0)
    await page.goto(`/hr/employees/${STAFF.id}/edit`)
    await expect(page.locator('#managerId option', { hasText: BLANK.lastName })).toHaveCount(1)
    await expect(page.locator('#managerId option', { hasText: CONTRACTOR.lastName })).toHaveCount(0)

    // Organisation structure: the department counts staff only (staff, blank, manager = 3; contractors not counted).
    await page.goto('/hr/employees/structure')
    await page.getByRole('button', { name: /Oddział kontraktowy A/ }).click()
    const departmentRow = page.getByRole('button', { name: /Dział kontraktowy/ })
    await expect(departmentRow).toContainText('(3)')
    await departmentRow.click()
    await expect(page.getByText(STAFF.lastName)).toBeVisible()
    await expect(page.getByText(BLANK.lastName)).toBeVisible()
    await expect(page.getByText(CONTRACTOR.lastName)).toHaveCount(0)

    // Exports and reports (same session, real routes).
    const csvChecks = [
      '/api/hr/leave-requests/export',
      '/api/hr/reports/export?type=attendance&month=2026-11',
      '/api/hr/reports/export?type=overtime&month=2026-11',
    ]
    for (const url of csvChecks) {
      const response = await page.request.get(url)
      expect(response.status(), url).toBe(200)
      const text = await response.text()
      expect(text, url).toContain(STAFF.lastName)
      expect(text, url).not.toContain(CONTRACTOR.lastName)
    }
    const pdf = await page.request.get(`/api/hr/reports/monthly-pdf?month=2026-11&employeeId=${CONTRACTOR.id}`)
    expect(pdf.status()).toBe(404)
    const pdfAll = await page.request.get('/api/hr/reports/monthly-pdf?month=2026-11')
    expect(pdfAll.status()).toBe(200)
    expect(pdfAll.headers()['content-type']).toContain('pdf')

    // Nothing was deleted: the contractor's old rows are still in the database.
    expect(await withDb((db) => db.leaveBalanceNew.count({ where: { employeeId: CONTRACTOR.id } }))).toBe(1)
    expect(await withDb((db) => db.timeEntry.count({ where: { employeeId: CONTRACTOR.id } }))).toBe(1)
    expect(await withDb((db) => db.overtimeRequest.count({ where: { employeeId: CONTRACTOR.id } }))).toBe(1)
  })

  test('still offers the contractor in installations and in account management', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)

    await page.goto('/installations/new')
    await page.getByRole('button', { name: 'Wybierz głównego opiekuna' }).click()
    await expect(page.getByRole('option', { name: `Ustaw ${nameOf(CONTRACTOR)} jako głównego opiekuna` })).toBeVisible()

    await page.goto('/settings/users')
    await page.getByRole('button', { name: 'Dodaj użytkownika' }).first().click()
    await page.getByRole('dialog').locator('#u-name').fill('Konto Wykonawcy')
    await page.getByRole('dialog').locator('#u-username').fill('ctrinstallernew')
    await page.getByRole('dialog').locator('#u-email').fill('ctr-installer-new@example.test')
    await page.getByRole('dialog').locator('#u-role').selectOption('INSTALLER')
    await page.getByRole('dialog').getByRole('button', { name: 'Wybierz pracownika…' }).click()
    await page.getByRole('dialog').getByPlaceholder('Szukaj…').fill(CONTRACTOR.lastName)
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(nameOf(CONTRACTOR)) }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Utwórz konto' }).click()
    await expect(page.getByText('Konto utworzone')).toBeVisible()

    const account = await withDb((db) => db.user.findUniqueOrThrow({ where: { username: 'ctrinstallernew' } }))
    expect(account.role).toBe('INSTALLER')
    expect(account.employeeId).toBe(CONTRACTOR.id)
  })

  test('limits a MANAGER to the cards of their division on both tabs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await login(page, MANAGER_LOGIN, PASSWORD)
    await page.goto('/hr/employees')
    await expect(page.getByText(STAFF.lastName).first()).toBeVisible()
    await expect(page.getByText(STAFF_B.lastName)).toHaveCount(0)
    await expect(page.getByText(CONTRACTOR.lastName)).toHaveCount(0)
    await expect(staffCounter(page)).toHaveText(String(await rows(page).count()))

    await contractorsTab(page).click()
    await expect(page.getByText(CONTRACTOR.lastName).first()).toBeVisible()
    await expect(page.getByText(CONTRACTOR_B.lastName)).toHaveCount(0)
    await expect(page.getByText(STAFF.lastName)).toHaveCount(0)
    await expect(contractorsCounter(page)).toHaveText(String(await rows(page).count()))

    // The manager does not see contractors in the leave approvals either.
    await expectPeopleOn(page, '/hr/leave/approval', [STAFF], [CONTRACTOR])
  })

  test('gives EMPLOYEE and INSTALLER no list, as before', async ({ page }) => {
    await login(page, EMPLOYEE_LOGIN, PASSWORD)
    await page.goto('/hr/employees')
    await expect(page).toHaveURL(new RegExp(`/hr/employees/${STAFF.id}$`))
    await expect(page.getByRole('tab', { name: /^Wykonawcy/ })).toHaveCount(0)
    await page.context().clearCookies()

    await login(page, INSTALLER_LOGIN, PASSWORD)
    await page.goto('/hr/employees')
    await expect(page).not.toHaveURL(/\/hr\/employees/)
    await page.goto('/api/hr/employees?kind=contractors')
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(CONTRACTOR.lastName)
  })

  test('keeps a supervisor who is a contractor on the card when the edit form is saved', async ({ page }) => {
    // The supervisor list offers staff only. A supervisor already set must not be cleared by an unrelated edit.
    await withDb((db) => db.employee.update({ where: { id: STAFF.id }, data: { managerId: CONTRACTOR.id } }))
    await loginAdmin(page)
    await page.goto(`/hr/employees/${STAFF.id}/edit`)
    await expect(page.locator('#managerId')).toHaveValue(CONTRACTOR.id)
    // Other contractors are still not offered as a new supervisor.
    await expect(page.locator('#managerId option', { hasText: CONTRACTOR_B.lastName })).toHaveCount(0)
    await page.locator('#phone').fill('+48 500 300 400')
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click()
    await expect(page).toHaveURL(new RegExp(`/hr/employees/${STAFF.id}$`))
    const saved = await withDb((db) => db.employee.findUniqueOrThrow({ where: { id: STAFF.id } }))
    expect([saved.phone, saved.managerId]).toEqual(['+48 500 300 400', CONTRACTOR.id])
  })
})
