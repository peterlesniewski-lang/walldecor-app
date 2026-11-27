import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '../src/generated/prisma'
import { formatGrosze } from '../src/lib/payroll/money'

// Plan §13 — "miesiąc właściciela": the final acceptance scenario of the payroll simplification, ten
// steps, one serial run on the isolated, freshly migrated Playwright database, everything through the UI.
// The only actions outside the UI are the two the plan allows: the automat run for the month
// (e2e/payroll-automation-run.ts, never an HTTP route) and the application restart. Reads of the
// database are used to find ids and to check, never to seed. Seeded without a UI (reported): the
// cost centres JAG and PUL (no screen creates them).
//
// Fixed months, independent of today's date: M-1 = June 2026, M = July 2026 (no other payroll spec
// settles these two months; every person here is employed 2026-06-01 .. 2026-07-31 only). The month
// must lie between the cost-event cut-over (April 2026) and today for step 8 — true from August 2026 on.
// Every person and amount is synthetic.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const EVIDENCE_DIR = path.join(process.cwd(), 'docs/evidence/2026-11-24-payroll-details')
const PREVIOUS = '2026-06'
const MONTH = '2026-07'
const LIST_REFERENCE = 'LP owner 06/2026'
const NEW_PASSWORD = 'Owner-Month-123!'

type Person = { key: string; firstName: string; lastName: string; email: string }
const UOP: Person = { key: 'uop', firstName: 'Testowa', lastName: 'Pracowita', email: 'owner-month-uop@example.test' }
const BOARD: Person = { key: 'board', firstName: 'Testowy', lastName: 'Zarządowy', email: 'owner-month-board@example.test' }
const HOURLY: Person = { key: 'hourly', firstName: 'Testowa', lastName: 'Zleceniowa', email: 'owner-month-hourly@example.test' }
const CONTRACTOR: Person = { key: 'contractor', firstName: 'Testowy', lastName: 'Montażowy', email: 'owner-month-contractor@example.test' }

// Typed by hand in June. Employer cost rates (default, unchanged by any spec): UoP 20,48%, UZ 17,93%, Zarząd 0%.
const JUNE = {
  uop: { base: '6000,00', gross: '6000,00', net: '4300,00' },
  board: { base: '8000,00', gross: '8000,00', net: '6000,00' },
  hourly: { base: '50,00', gross: '1300,00', net: '1040,00' },
} as const
const RATE = { uop: 2048, uz: 1793, board: 0 } // basis points of employer cost on top of gross
const costOf = (grossGrosze: number, basisPoints: number) => Math.round((grossGrosze * (10_000 + basisPoints)) / 10_000)
// 26 h × 50,00 zł = 1300,00; the UoP person is corrected from 6000,00 to 6500,00 after sick leave.
const CORRECTED_UOP_GROSS = '6500,00'
const CORRECTED_UOP_NET = '4650,00'
const DAYS = [
  { date: '2026-07-06', from: '09:00', to: '17:00' }, // Monday, 8 h
  { date: '2026-07-07', from: '09:00', to: '17:00' }, // 8 h
  { date: '2026-07-11', from: '10:00', to: '14:00' }, // Saturday, 4 h (overtime in the calendar, paid at the rate)
  { date: '2026-07-30', from: '09:00', to: '15:00' }, // 6 h, the end of the month
] as const

const state: {
  ids: Record<string, string>
  accounts: Record<string, { username: string; password: string; activated: boolean }>
  baseline: { pul: number; jag: number } | null
} = { ids: {}, accounts: {}, baseline: null }

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Owner-month E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
  }
  return databaseUrl
}

function automat(...args: string[]) {
  const result = spawnSync(process.execPath, ['--preserve-symlinks', '--import', 'tsx', 'e2e/payroll-automation-run.ts', ...args], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 120_000,
  })
  if (result.status !== 0) throw new Error(`automat runner failed: ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
}

async function restartServer(databaseUrl: string) {
  const directory = path.dirname(databaseUrl.slice('file:'.length))
  const restartId = `owner-month-${Date.now()}`
  await writeFile(path.join(directory, 'restart-request'), restartId, { mode: 0o600 })
  await expect.poll(async () => readFile(path.join(directory, 'restart-complete'), 'utf8').catch(() => ''), { timeout: 100_000 }).toBe(restartId)
}

async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient()
  try {
    return await fn(db)
  } finally {
    await db.$disconnect()
  }
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(700) // entrance animation settles
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `owner-month-${name}`), fullPage, animations: 'disabled' })
}

const payrollName = (person: Person) => `${person.lastName} ${person.firstName}`
const fullName = (person: Person) => `${person.firstName} ${person.lastName}`
const rowOf = (page: Page, person: Person) => page.getByTestId(`payroll-row-${state.ids[person.key]}`)
/** "7 228,80 zł" → 722880 */
const grosze = (text: string) => Math.round(Number(text.replace(/[^\d,-]/g, '').replace(',', '.')) * 100)
const money = (g: number) => formatGrosze(g)

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Login').fill(process.env.ADMIN_USERNAME ?? 'admin')
  await page.getByLabel('Hasło').fill(process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** First login with the temporary password goes through the forced password change, like a real user. */
async function loginAs(page: Page, key: string) {
  const account = state.accounts[key]
  await page.goto('/login')
  await page.getByLabel('Login').fill(account.username)
  await page.getByLabel('Hasło').fill(account.password)
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  if (!account.activated) {
    await expect(page).toHaveURL(/\/change-password/)
    await page.locator('#currentPassword').fill(account.password)
    await page.locator('#newPassword').fill(NEW_PASSWORD)
    await page.locator('#confirmPassword').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Zapisz hasło' }).click()
    await expect(page).not.toHaveURL(/\/(change-password|login)/)
    account.password = NEW_PASSWORD
    account.activated = true
  }
  await expect(page).not.toHaveURL(/\/(login|change-password)/)
}

async function logout(page: Page) {
  await page.context().clearCookies()
}

async function createCard(page: Page, person: Person, employmentType: string | null) {
  await page.goto(employmentType ? '/hr/employees/new' : '/hr/employees?kind=contractors')
  if (!employmentType) await page.getByRole('link', { name: 'Dodaj wykonawcę' }).click()
  await page.locator('#firstName').fill(person.firstName)
  await page.locator('#lastName').fill(person.lastName)
  await page.locator('#email').fill(person.email)
  await page.getByRole('button', { name: 'Dalej' }).click()
  if (employmentType) await page.locator('#employmentType').selectOption(employmentType)
  await page.locator('#costCenterId').selectOption(employmentType ? 'PUL' : 'JAG')
  await page.locator('#position').fill('Testowe stanowisko')
  await page.locator('#startDate').fill('2026-06-01')
  await page.locator('#endDate').fill('2026-07-31')
  await page.getByRole('button', { name: 'Dalej' }).click()
  await page.getByRole('button', { name: employmentType ? 'Utwórz pracownika' : 'Utwórz wykonawcę' }).click()
  if (employmentType) {
    await expect(page).toHaveURL(/\/hr\/employees\/(?!new$)[^/?]+$/)
    state.ids[person.key] = page.url().split('/').pop() ?? ''
  } else {
    await expect(page).toHaveURL(/\/hr\/employees\?kind=contractors/)
    state.ids[person.key] = (await withDb((db) => db.employee.findUniqueOrThrow({ where: { email: person.email } }))).id
  }
}

async function createAccount(page: Page, key: string, username: string, name: string, role: 'EMPLOYEE' | 'MANAGER' | 'INSTALLER', person?: Person) {
  await page.goto('/settings/users')
  await page.getByRole('button', { name: 'Dodaj użytkownika' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('#u-name').fill(name)
  await dialog.locator('#u-username').fill(username)
  await dialog.locator('#u-email').fill(`${username}@example.test`)
  await dialog.locator('#u-role').selectOption(role)
  if (person) {
    await dialog.getByRole('button', { name: 'Wybierz pracownika…' }).click()
    await dialog.getByPlaceholder('Szukaj…').fill(person.lastName)
    await dialog.getByRole('button', { name: new RegExp(fullName(person)) }).click()
  }
  await dialog.getByRole('button', { name: 'Utwórz konto' }).click()
  await expect(page.getByText('Konto utworzone')).toBeVisible()
  const password = (await page.getByRole('dialog').locator('code').innerText()).trim()
  await page.getByRole('dialog').getByRole('button', { name: 'Gotowe' }).click()
  state.accounts[key] = { username, password, activated: false }
}

/** PUL / JAG "w tym koszt pracodawcy" of the break-even screen for July, in grosze (0 when "brak danych"). */
async function employerCostOnBreakEven(page: Page) {
  await page.goto('/finance/break-even')
  const loaded = page.waitForResponse((response) => response.url().includes('year=2026&month=7') && response.ok())
  await page.getByLabel('Miesiąc raportu').fill(MONTH)
  await loaded
  const read = async (salonId: 'PUL' | 'JAG') => {
    const salon = page.getByTestId(`salon-${salonId}`)
    await expect(salon).toBeVisible()
    const text = await salon.locator('dl > div', { hasText: 'w tym koszt pracodawcy' }).locator('dd').textContent()
    return /\d/.test(text ?? '') ? grosze(text ?? '') : 0
  }
  return { pul: await read('PUL'), jag: await read('JAG'), body: await page.locator('main').innerText() }
}

test.describe('HR payroll — miesiąc właściciela (§13)', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let databaseUrl = ''

  test.beforeAll(async () => {
    databaseUrl = assertQaDatabase()
    await mkdir(EVIDENCE_DIR, { recursive: true })
    // No screen creates cost centres — the only seed of this scenario (reported as "no UI for cost centres").
    await withDb(async (db) => {
      await db.costCenter.upsert({ where: { id: 'JAG' }, create: { id: 'JAG', name: 'Salon JAG' }, update: {} })
      await db.costCenter.upsert({ where: { id: 'PUL' }, create: { id: 'PUL', name: 'Salon PUL' }, update: {} })
    })
  })

  test('step 1 — ADMIN creates three cards and a B2B contractor with an INSTALLER account', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    // Before anyone exists: the July employer cost of the salons, the reference for step 8.
    const before = await employerCostOnBreakEven(page)
    state.baseline = { pul: before.pul, jag: before.jag }

    await createCard(page, UOP, 'UoP')
    await createCard(page, BOARD, 'Zarząd')
    await createCard(page, HOURLY, 'UZ')
    await createCard(page, CONTRACTOR, null)
    const types = await withDb(async (db) => Promise.all([UOP, BOARD, HOURLY, CONTRACTOR].map((person) => db.employee.findUniqueOrThrow({ where: { id: state.ids[person.key] }, select: { employmentType: true } }))))
    expect(types.map((card) => card.employmentType)).toEqual(['UoP', 'Zarząd', 'UZ', 'B2B'])

    await createAccount(page, 'installer', 'ownermonthinstaller', 'Konto Montażysty', 'INSTALLER', CONTRACTOR)
    await createAccount(page, 'employee', 'ownermonthemployee', fullName(UOP), 'EMPLOYEE', UOP)
    await createAccount(page, 'manager', 'ownermonthmanager', 'Konto Kierownika', 'MANAGER')
    const installer = await withDb((db) => db.user.findUniqueOrThrow({ where: { username: 'ownermonthinstaller' } }))
    expect([installer.role, installer.employeeId]).toEqual(['INSTALLER', state.ids.contractor])
    await shot(page, '01-accounts.png', false)
  })

  test('step 2 — the contractor is only on "Wykonawcy", in Montaże and in Użytkownicy', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/employees')
    await expect(page.getByText(UOP.lastName).first()).toBeVisible()
    await expect(page.getByText(CONTRACTOR.lastName)).toHaveCount(0)
    await page.getByRole('tab', { name: /^Wykonawcy/ }).click()
    await expect(page.getByText(CONTRACTOR.lastName).first()).toBeVisible()
    await expect(page.getByText(UOP.lastName)).toHaveCount(0)

    await page.goto(`/hr/payroll?month=${PREVIOUS}`)
    await expect(rowOf(page, UOP)).toBeVisible()
    await expect(page.getByTestId(`payroll-row-${state.ids.contractor}`)).toHaveCount(0)
    await expect(page.getByText(CONTRACTOR.lastName)).toHaveCount(0)

    await page.goto('/installations/new')
    await page.getByRole('button', { name: 'Wybierz głównego opiekuna' }).click()
    await expect(page.getByRole('option', { name: `Ustaw ${fullName(CONTRACTOR)} jako głównego opiekuna` })).toBeVisible()
    await page.goto('/settings/users')
    await expect(page.getByText('ownermonthinstaller').first()).toBeVisible()
    await shot(page, '02-contractor-in-users.png', false)
  })

  test('step 3 — ADMIN sets the engagements, types June by hand and approves it, sets the list number', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await loginAdmin(page)
    await page.goto(`/hr/payroll?month=${PREVIOUS}`)

    const engagements: Array<[Person, 'MONTHLY_GROSS' | 'HOURLY_GROSS', string]> = [
      [UOP, 'MONTHLY_GROSS', JUNE.uop.base], [BOARD, 'MONTHLY_GROSS', JUNE.board.base], [HOURLY, 'HOURLY_GROSS', JUNE.hourly.base],
    ]
    for (const [person, basis, amount] of engagements) {
      await rowOf(page, person).getByRole('button', { name: `Akcje — ${payrollName(person)}` }).click()
      await page.getByRole('menuitem', { name: 'Angaż…' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Kwota (PLN)').fill(amount)
      await dialog.getByLabel('Rodzaj').selectOption(basis)
      await dialog.getByRole('button', { name: 'Dodaj podstawę' }).click()
      await expect(dialog.getByText(`od ${PREVIOUS}-01`)).toBeVisible()
      await dialog.locator('form').getByRole('button', { name: 'Zamknij' }).click()
    }

    const typed: Array<[Person, { gross: string; net: string }]> = [[UOP, JUNE.uop], [BOARD, JUNE.board], [HOURLY, JUNE.hourly]]
    for (const [person, amounts] of typed) {
      const row = rowOf(page, person)
      await row.getByLabel(`Brutto — ${payrollName(person)}`).fill(amounts.gross)
      await row.getByLabel(`Netto — ${payrollName(person)}`).fill(amounts.net)
      await row.getByLabel(`Zaznacz do zatwierdzenia — ${payrollName(person)}`).check()
    }
    // The calculated employer cost the sheet shows is the one computed here from the default rates.
    await expect(rowOf(page, UOP).getByTestId(`payroll-cost-${state.ids.uop}`)).toHaveText(money(costOf(600000, RATE.uop)))
    await expect(rowOf(page, BOARD).getByTestId(`payroll-cost-${state.ids.board}`)).toHaveText(money(costOf(800000, RATE.board)))
    await page.getByRole('button', { name: /^Zatwierdź zaznaczone \(3\)$/ }).click()
    for (const person of [UOP, BOARD, HOURLY]) await expect(rowOf(page, person).getByText('Zatwierdzone · v1')).toBeVisible()

    const reference = page.getByLabel('Numer listy płac')
    await reference.fill(LIST_REFERENCE)
    await reference.press('Enter')
    await expect.poll(() => withDb((db) => db.payrollMonth.findFirst({ where: { year: 2026, month: 6 } }).then((row) => row?.listReference))).toBe(LIST_REFERENCE)
    await shot(page, '03-june-approved.png')
    await page.reload()
    await expect(page.getByLabel('Numer listy płac')).toHaveValue(LIST_REFERENCE)
  })

  test('step 4 — ADMIN switches the automat on; the run for July is the script on the isolated database', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll/rates')
    const automatSwitch = page.locator('#automat').getByRole('switch')
    if ((await automatSwitch.getAttribute('aria-checked')) !== 'true') await automatSwitch.click()
    await expect(automatSwitch).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('#automat').getByText('Automat włączony')).toBeVisible()
    await expect.poll(() => withDb((db) => db.appSetting.findFirst({ where: { key: 'payroll_auto_carryover_enabled' } }).then((row) => row?.value))).toBe('true')
    await shot(page, '04-automat-on.png', false)

    // The allowed non-UI action: the run for the month (the real scheduler would do it at 6:00 on the 1st).
    const run = automat('run', MONTH)
    expect(run.errors).toEqual([])
    expect([...run.approved].sort()).toEqual([state.ids.uop, state.ids.board].sort())
    expect(run.attention.map((person: { employeeId: string }) => person.employeeId)).not.toContain(state.ids.contractor)
  })

  test('step 5 — two salaried people are "Zatwierdzone automatycznie"; the ADMIN is notified; the employee sees the payslip', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await loginAdmin(page)
    await page.goto(`/hr/payroll?month=${MONTH}`)
    for (const person of [UOP, BOARD]) await expect(rowOf(page, person).getByText('Zatwierdzone automatycznie · v1')).toBeVisible()
    await expect(rowOf(page, UOP).getByLabel(`Brutto — ${payrollName(UOP)}`)).toHaveValue(JUNE.uop.gross)
    await expect(rowOf(page, BOARD).getByLabel(`Brutto — ${payrollName(BOARD)}`)).toHaveValue(JUNE.board.gross)
    await expect(rowOf(page, HOURLY).getByText(/^Zatwierdzone/)).toHaveCount(0) // hourly pay is never carried over (D18)
    await shot(page, '05-july-auto-approved.png')

    await page.getByRole('button', { name: 'Powiadomienia' }).click()
    await expect(page.getByText(/^Wynagrodzenia za lipiec: 2 zatwierdzone automatycznie/)).toBeVisible()
    await shot(page, '05b-bell.png', false)

    await logout(page)
    await loginAs(page, 'employee')
    await page.goto('/hr/my-pay')
    await expect(page.getByText(/lipiec 2026/i).first()).toBeVisible()
    await expect(page.getByText(money(600000)).first()).toBeVisible()
    await shot(page, '05c-employee-payslip.png')
  })

  test('step 6 — ADMIN enters the hourly person\'s hours to the end of the month, approves them and the row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await loginAdmin(page)
    await page.goto(`/hr/time-tracking?view=month&mode=employee&month=${MONTH}&employeeId=${state.ids.hourly}`)
    await expect(page.getByTestId('monthly-employee-mode')).toBeVisible()
    for (const day of DAYS) {
      await page.getByLabel(`Wejście ${day.date}`).fill(day.from)
      await page.getByLabel(`Wyjście ${day.date}`).fill(day.to)
    }
    await page.getByRole('button', { name: `Zapisz zmiany (${DAYS.length})` }).click()
    await expect(page.getByRole('button', { name: 'Zapisz zmiany (0)' })).toBeDisabled()

    await page.goto(`/hr/payroll?month=${MONTH}`)
    const row = rowOf(page, HOURLY)
    await expect(row.getByTestId('payroll-hours')).toHaveText('0 h zatwierdzone · 26 h czeka')
    await expect(row.getByLabel(`Zaznacz do zatwierdzenia — ${payrollName(HOURLY)}`)).toBeDisabled()
    await row.getByRole('button', { name: `Zatwierdź godziny — ${payrollName(HOURLY)}` }).click()
    await expect(row.getByTestId('payroll-hours')).toHaveText('26 h zatwierdzone')
    // 26 h × 50,00 zł; the net keeps June's proportion 1040 / 1300.
    await expect(row.getByLabel(`Brutto — ${payrollName(HOURLY)}`)).toHaveValue('1300,00')
    await expect(row.getByTestId(`payroll-calc-${state.ids.hourly}`)).toHaveText('= 26 h × 50,00 zł')
    await expect(row.getByLabel(`Netto — ${payrollName(HOURLY)}`)).toHaveValue('1040,00')
    await expect(row.getByTestId(`payroll-cost-${state.ids.hourly}`)).toHaveText(money(costOf(130000, RATE.uz)))
    await row.getByLabel(`Zaznacz do zatwierdzenia — ${payrollName(HOURLY)}`).check()
    await page.getByRole('button', { name: /^Zatwierdź zaznaczone \(1\)$/ }).click()
    await expect(row.getByText('Zatwierdzone · v1')).toBeVisible()
    await shot(page, '06-hourly-approved.png')
  })

  test('step 7 — sick leave approved in July labels the row; the ADMIN corrects the amount and v2 appears', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await loginAdmin(page)

    // The sick-leave type comes from the leave-type screen when the database has none yet.
    const typesLoaded = page.waitForResponse((response) => response.url().includes('/api/hr/leave-types') && response.ok())
    await page.goto('/hr/leave/types')
    await typesLoaded
    await expect(page.getByRole('heading', { name: 'Typy urlopów' })).toBeVisible()
    if ((await page.getByText('Zwolnienie chorobowe').count()) === 0) {
      await page.getByRole('button', { name: 'Dodaj typ urlopu' }).first().click()
      await page.locator('#leave-type-name').fill('Zwolnienie chorobowe')
      await page.locator('#leave-type-code').fill('SL')
      await page.locator('#leave-type-paid').check()
      await page.locator('#leave-type-approval').check()
      await page.locator('#leave-type-balance').uncheck()
      await page.getByRole('button', { name: 'Dodaj typ' }).click()
      await expect(page.getByText('Zwolnienie chorobowe').first()).toBeVisible()
    }

    await page.goto('/hr/leave/requests')
    await page.getByRole('button', { name: 'Złóż wniosek' }).first().click()
    const form = page.locator('form')
    await form.getByRole('button', { name: 'Wybierz pracownika…' }).click()
    await page.getByPlaceholder('Szukaj…').fill(UOP.lastName)
    await form.getByRole('button', { name: new RegExp(fullName(UOP)) }).click()
    const sickValue = await form.locator('select option', { hasText: 'SL' }).first().getAttribute('value')
    await form.locator('select').first().selectOption(sickValue ?? '')
    await form.locator('input[type="date"]').nth(0).fill('2026-07-13')
    await form.locator('input[type="date"]').nth(1).fill('2026-07-14')
    await form.getByRole('button', { name: 'Złóż wniosek' }).click()
    await expect(form).toHaveCount(0)

    await page.goto('/hr/leave/approval')
    const request = page.getByRole('row').filter({ hasText: UOP.lastName }).filter({ hasText: /Oczekujący|Zatwierdzony/ }).first()
    await expect(request).toBeVisible()
    if (await request.getByRole('button', { name: 'Zatwierdź' }).count()) {
      await request.getByRole('button', { name: 'Zatwierdź' }).click()
    }
    await expect.poll(() => withDb((db) => db.leaveRequestNew.count({ where: { employeeId: state.ids.uop, status: 'approved', leaveType: { code: 'SL' } } }))).toBe(1)

    await page.goto(`/hr/payroll?month=${MONTH}`)
    const row = rowOf(page, UOP)
    const notice = row.getByRole('group', { name: `Zmiana po zatwierdzeniu — ${payrollName(UOP)}` })
    await expect(notice).toContainText('zmiana po zatwierdzeniu — sprawdź kwotę')
    await expect(notice).toContainText('nieobecność')
    await expect(row.getByText('Zatwierdzone automatycznie · v1')).toBeVisible()
    await shot(page, '07-change-label.png')

    await row.getByLabel(`Brutto — ${payrollName(UOP)}`).fill(CORRECTED_UOP_GROSS)
    await row.getByLabel(`Netto — ${payrollName(UOP)}`).fill(CORRECTED_UOP_NET)
    await expect(row.getByLabel(`Zaznacz do zatwierdzenia — ${payrollName(UOP)}`)).toBeChecked()
    await page.getByRole('button', { name: /^Zatwierdź zaznaczone \(1\)$/ }).click()
    await expect(row.getByText('Zatwierdzone · v2')).toBeVisible()
    await expect(row.getByTestId(`payroll-cost-${state.ids.uop}`)).toHaveText(money(costOf(650000, RATE.uop)))
    const versions = await withDb((db) => db.payrollSettlementVersion.findMany({ where: { employeeId: state.ids.uop, year: 2026, month: 7 }, orderBy: { versionNumber: 'asc' } }))
    expect(versions.map((v) => [v.versionNumber, v.origin, v.finalGrossGrosze, v.supersededAt !== null])).toEqual([
      [1, 'AUTO_CARRYOVER', 600000, true],
      [2, 'MANUAL', 650000, false],
    ])
    await shot(page, '07b-corrected-v2.png')
  })

  test('step 8 — the company result for July counts the three people once and no contractor', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await loginAdmin(page)
    // Computed here, not read from the app: 6500,00 × 1,2048 + 8000,00 × 1 + 1300,00 × 1,1793.
    const expected = costOf(650000, RATE.uop) + costOf(800000, RATE.board) + costOf(130000, RATE.uz)
    expect(expected).toBe(783120 + 800000 + 153309)

    const after = await employerCostOnBreakEven(page)
    expect(state.baseline).not.toBeNull()
    expect(after.pul - (state.baseline?.pul ?? 0)).toBe(expected)
    expect(after.jag).toBe(state.baseline?.jag) // the contractor's salon: nothing added
    expect(after.body).not.toContain(CONTRACTOR.lastName)
    await page.getByTestId('salon-PUL').scrollIntoViewIfNeeded()
    await shot(page, '08-break-even-july.png')
  })

  test('step 9 — after an application restart every state above is unchanged', async ({ page }) => {
    await restartServer(databaseUrl)
    await page.setViewportSize({ width: 1440, height: 1100 })
    await loginAdmin(page)

    await page.goto(`/hr/payroll?month=${PREVIOUS}`)
    for (const person of [UOP, BOARD, HOURLY]) await expect(rowOf(page, person).getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(page.getByLabel('Numer listy płac')).toHaveValue(LIST_REFERENCE)

    await page.goto(`/hr/payroll?month=${MONTH}`)
    await expect(rowOf(page, UOP).getByText('Zatwierdzone · v2')).toBeVisible()
    await expect(rowOf(page, UOP).getByLabel(`Brutto — ${payrollName(UOP)}`)).toHaveValue(CORRECTED_UOP_GROSS)
    await expect(rowOf(page, BOARD).getByText('Zatwierdzone automatycznie · v1')).toBeVisible()
    await expect(rowOf(page, HOURLY).getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(rowOf(page, HOURLY).getByTestId('payroll-hours')).toHaveText('26 h zatwierdzone')
    await expect(rowOf(page, HOURLY).getByLabel(`Brutto — ${payrollName(HOURLY)}`)).toHaveValue('1300,00')

    await page.goto('/hr/payroll/rates')
    await expect(page.locator('#automat').getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Powiadomienia' }).click()
    await expect(page.getByText(/^Wynagrodzenia za lipiec: 2 zatwierdzone automatycznie/)).toBeVisible()

    const after = await employerCostOnBreakEven(page)
    expect(after.pul - (state.baseline?.pul ?? 0)).toBe(costOf(650000, RATE.uop) + costOf(800000, RATE.board) + costOf(130000, RATE.uz))
    expect(after.jag).toBe(state.baseline?.jag)

    // The accounts survived too: the employee's payslip shows the corrected, effective amount.
    await logout(page)
    await loginAs(page, 'employee')
    await page.goto('/hr/my-pay')
    await expect(page.getByText(money(650000)).first()).toBeVisible()
    await shot(page, '09-after-restart-employee.png', false)
  })

  test('step 10 — MANAGER, EMPLOYEE and INSTALLER see no amount and get 403 from every payroll route', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const settlementId = await withDb((db) => db.payrollSettlement.findFirstOrThrow({ where: { employeeId: state.ids.uop, year: 2026, month: 7 } }).then((row) => row.id))

    // Every route file under src/app/api/hr/payroll, with its real HTTP methods.
    const root = path.join(process.cwd(), 'src/app/api/hr/payroll')
    const files = (await readdir(root, { recursive: true })).filter((file) => file.endsWith('route.ts')).sort()
    const routes: Array<{ method: string; url: string }> = []
    for (const file of files) {
      const source = await readFile(path.join(root, file), 'utf8')
      const url = `/api/hr/payroll/${path.dirname(file).split(path.sep).filter((part) => part !== '.').map((part) => (part.startsWith('[') ? 'e2e-none' : part)).join('/')}`.replace(/\/$/, '')
      for (const match of source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) routes.push({ method: match[1], url })
    }
    expect(files.length).toBeGreaterThanOrEqual(14)
    expect(routes.length).toBeGreaterThanOrEqual(files.length)

    const amountPattern = /(6000|6500|7228|7831|8000|1300|1533|4300|4650|1040),\d\d/
    const results: Record<string, number[]> = {}
    for (const key of ['manager', 'employee', 'installer'] as const) {
      await logout(page)
      await loginAs(page, key)
      const statuses: number[] = []
      for (const route of routes) {
        const response = await page.request.fetch(route.url, { method: route.method, data: route.method === 'GET' ? undefined : {}, maxRedirects: 0 })
        statuses.push(response.status())
        expect(response.status(), `${key} ${route.method} ${route.url}`).toBe(403)
      }
      results[key] = statuses
      // The screens: no sheet, no details, no rates, no company result — and no amount of this scenario on what is shown.
      for (const url of [`/hr/payroll?month=${MONTH}`, `/hr/payroll/${settlementId}`, '/hr/payroll/rates', '/finance/break-even']) {
        await page.goto(url)
        expect(page.url(), `${key} on ${url}`).not.toMatch(/\/hr\/payroll|\/finance\/break-even/)
        const visible = (await page.locator('body').innerText()).replace(/[\s ]/g, '')
        expect(visible, `${key} on ${url}`).not.toMatch(amountPattern)
      }
    }
    expect(Object.values(results).every((statuses) => statuses.length === routes.length)).toBe(true)
  })
})
