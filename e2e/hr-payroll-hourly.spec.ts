import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma'

// Payroll stage 3 — hourly basis (D15–D19) and the pay reminder (D18) — on the isolated, freshly
// migrated Playwright database. Hours are typed in Czas pracy (monthly employee grid), approved with
// "Zatwierdź godziny" on the sheet and settled there. The person is employed February–March 2026 only,
// months no other payroll spec uses (stage 1: Aug–Nov, stage 2: Apr–May, time tracking: Jul–Aug).
// The reminder is sent by e2e/payroll-automation-run.ts calling the send function — never over HTTP.
// Every person and amount is synthetic test data.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const EVIDENCE_DIR = path.join(process.cwd(), 'docs/evidence/2026-11-24-payroll-hourly')
const PASSWORD = 'Test-Employee-123!'
const EMPLOYEE_LOGIN = 'hourlyemployee'
const PERSON = { id: 'e2e-hourly-a', firstName: 'Testowa', lastName: 'Godzinowa' }
const NAME = `${PERSON.lastName} ${PERSON.firstName}`
const MARCH = { year: 2026, month: 3 }
// Warsaw is CET (UTC+1) until 29.03.2026; all these days are before the switch.
const DAYS = [
  { date: '2026-03-02', from: '09:00', to: '17:00' }, // Monday, 8 h
  { date: '2026-03-03', from: '09:00', to: '17:00' }, // 8 h
  { date: '2026-03-07', from: '10:00', to: '14:00' }, // Saturday, 4 h — counted by the calendar as overtime
  { date: '2026-03-27', from: '09:00', to: '15:00' }, // 6 h, entered ahead for the end of the month
] as const

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Payroll hourly E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
  }
  return databaseUrl
}

function runner(...args: string[]) {
  const result = spawnSync(process.execPath, ['--preserve-symlinks', '--import', 'tsx', 'e2e/payroll-automation-run.ts', ...args], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 120_000,
  })
  if (result.status !== 0) throw new Error(`payroll runner failed: ${result.stderr || result.stdout}`)
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
}

async function login(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Login').fill(username)
  await page.getByLabel('Hasło').fill(password)
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const loginAdmin = (page: Page) => login(page, process.env.ADMIN_USERNAME ?? 'admin', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
const rowOf = (page: Page) => page.getByTestId(`payroll-row-${PERSON.id}`)

async function restartServer(databaseUrl: string) {
  const directory = path.dirname(databaseUrl.slice('file:'.length))
  const restartId = `payroll-hourly-${Date.now()}`
  await writeFile(path.join(directory, 'restart-request'), restartId, { mode: 0o600 })
  await expect.poll(async () => readFile(path.join(directory, 'restart-complete'), 'utf8').catch(() => ''), { timeout: 100_000 }).toBe(restartId)
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForTimeout(700) // entrance animation (rise) settles
  await page.screenshot({ path: path.join(EVIDENCE_DIR, name), fullPage, animations: 'disabled' })
}

async function withDb<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient()
  try {
    return await fn(db)
  } finally {
    await db.$disconnect()
  }
}

const marchEntries = () => withDb((db) => db.timeEntry.findMany({ where: { employeeId: PERSON.id }, orderBy: { date: 'asc' } }))

test.describe('HR payroll — stawka godzinowa', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let databaseUrl = ''

  test.beforeAll(async () => {
    databaseUrl = assertQaDatabase()
    await mkdir(EVIDENCE_DIR, { recursive: true })
    await withDb(async (db) => {
      await db.costCenter.upsert({ where: { id: 'JAG' }, create: { id: 'JAG', name: 'Salon JAG' }, update: {} })
      await db.employee.create({
        data: {
          id: PERSON.id, firstName: PERSON.firstName, lastName: PERSON.lastName, email: `${PERSON.id}@example.test`,
          position: 'Doradca (test)', costCenterId: 'JAG', employmentType: 'UZ',
          startDate: new Date('2026-02-01T00:00:00Z'), endDate: new Date('2026-03-31T00:00:00Z'),
        },
      })
      await db.payrollBaseSalary.create({
        data: { employeeId: PERSON.id, effectiveFrom: '2026-02-01', amountGrosze: 5000, basis: 'HOURLY_GROSS', createdById: 'e2e-seed' },
      })
      await db.user.create({
        data: {
          username: EMPLOYEE_LOGIN, email: `${EMPLOYEE_LOGIN}@example.test`, name: NAME, role: 'EMPLOYEE',
          employeeId: PERSON.id, passwordHash: await bcrypt.hash(PASSWORD, 10), passwordChangedAt: new Date(),
        },
      })
    })
  })

  test('enters hours in Czas pracy; the sheet shows them waiting and counts only approved hours', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    // February typed by hand on the sheet (the same call the sheet button makes): the net proportion 0,8.
    const february = await page.request.post('/api/hr/payroll/sheet', {
      data: { month: '2026-02', rows: [{ employeeId: PERSON.id, finalGross: '4000,00', finalNet: '3200,00' }] },
    })
    expect((await february.json()).results.map((r: { status: string }) => r.status)).toEqual(['APPROVED'])

    await page.goto(`/hr/time-tracking?view=month&mode=employee&month=2026-03&employeeId=${PERSON.id}`)
    await expect(page.getByTestId('monthly-employee-mode')).toBeVisible()
    for (const day of DAYS) {
      await page.getByLabel(`Wejście ${day.date}`).fill(day.from)
      await page.getByLabel(`Wyjście ${day.date}`).fill(day.to)
    }
    await page.getByRole('button', { name: `Zapisz zmiany (${DAYS.length})` }).click()
    await expect(page.getByRole('button', { name: 'Zapisz zmiany (0)' })).toBeDisabled()
    const entered = await marchEntries()
    expect(entered.map((e) => [e.date.toISOString().slice(0, 10), e.status, e.totalMinutes, e.overtimeMinutes])).toEqual([
      ['2026-03-02', 'pending', 480, 0],
      ['2026-03-03', 'pending', 480, 0],
      ['2026-03-07', 'pending', 240, 240],
      ['2026-03-27', 'pending', 360, 0],
    ])

    // One day approved in Czas pracy (its own approval route), the rest still waiting.
    expect((await page.request.patch(`/api/hr/time-tracking/${entered[0].id}/approve`)).status()).toBe(200)

    await page.goto('/hr/payroll?month=2026-03')
    const row = rowOf(page)
    await expect(row.getByTestId('payroll-hours')).toHaveText('8 h zatwierdzone · 18 h czeka')
    await expect(row.getByLabel(`Brutto — ${NAME}`)).toHaveValue('400,00')
    await expect(row.getByTestId(`payroll-calc-${PERSON.id}`)).toHaveText('= 8 h × 50,00 zł')
    await expect(row.getByText('Stawka godzinowa: w kalendarzu są niezatwierdzone wpisy czasu pracy.')).toBeVisible()
    await expect(row.getByLabel(`Zaznacz do zatwierdzenia — ${NAME}`)).toBeDisabled()
    await shot(page, '00-hours-waiting.png')
  })

  test('reminds the ADMIN in the bell about people without an approved settlement before pay day', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    const sheet = await (await page.request.get('/api/hr/payroll/sheet?month=2026-03')).json() as { rows: Array<{ employee: { id: string }; effectiveVersion: unknown }> }
    const unapproved = sheet.rows.filter((r) => r.effectiveVersion === null).map((r) => r.employee.id)
    expect(unapproved).toContain(PERSON.id)

    const sent = runner('remind', '2026-03')
    expect([sent.unapproved, sent.notified > 0]).toEqual([unapproved.length, true])
    const count = unapproved.length
    const people = count === 1 ? 'osoba' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'osoby' : 'osób'
    const title = `Wynagrodzenia za marzec: ${count} ${people} bez zatwierdzonego rozliczenia, wypłata do 31.03`

    await page.goto('/hr/payroll?month=2026-03')
    await page.getByRole('button', { name: 'Powiadomienia' }).click()
    const note = page.getByText(title)
    await expect(note).toBeVisible()
    await shot(page, '01-bell-reminder.png', false)
    await note.click()
    await expect(page).toHaveURL(/\/hr\/payroll\?month=2026-03$/)
    const recipients = await withDb(async (db) => {
      const notes = await db.notification.findMany({ where: { type: 'payroll_reminder', title } })
      return db.user.findMany({ where: { id: { in: notes.map((n) => n.userId) } }, select: { role: true } })
    })
    expect(recipients.length > 0 && recipients.every((user) => user.role === 'ADMIN')).toBe(true)
  })

  test('approves the waiting hours with one click and recalculates the row without a page reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-03')
    const row = rowOf(page)
    await expect(row.getByTestId('payroll-hours')).toContainText('18 h czeka')
    await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true })

    await row.getByRole('button', { name: `Zatwierdź godziny — ${NAME}` }).click()
    await expect(row.getByTestId('payroll-hours')).toHaveText('26 h zatwierdzone')
    await expect(row.getByText('Zatwierdzono 3 wpisy czasu pracy')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
    // 8 + 8 + 4 (Saturday) + 6 = 26 h × 50,00 zł; net from February's proportion 3200 / 4000.
    await expect(row.getByLabel(`Brutto — ${NAME}`)).toHaveValue('1300,00')
    await expect(row.getByTestId(`payroll-calc-${PERSON.id}`)).toHaveText('= 26 h × 50,00 zł')
    await expect(row.getByLabel(`Netto — ${NAME}`)).toHaveValue('1040,00')
    await expect(row.getByText('proporcja z lutego')).toBeVisible()
    await expect(row.getByRole('button', { name: `Zatwierdź godziny — ${NAME}` })).toHaveCount(0)
    await expect(row.getByText('stawka godzinowa — sprawdź kwotę')).toBeVisible()
    // Never preselected for one-click approval (D18), but it can be selected now that nothing blocks.
    const check = row.getByLabel(`Zaznacz do zatwierdzenia — ${NAME}`)
    await expect(check).toBeEnabled()
    await expect(check).not.toBeChecked()

    const admin = await withDb((db) => db.user.findFirstOrThrow({ where: { username: process.env.ADMIN_USERNAME ?? 'admin' } }))
    expect((await marchEntries()).map((e) => [e.status, e.approvedById])).toEqual(DAYS.map(() => ['approved', admin.id]))
    await shot(page, '02-hours-approved.png')

    // Phone width: the hours line and the calculation stay readable, no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 900 })
    await row.scrollIntoViewIfNeeded()
    await expect(row.getByTestId(`payroll-calc-${PERSON.id}`)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await row.screenshot({ path: path.join(EVIDENCE_DIR, '03-hourly-row-390.png'), animations: 'disabled' })
  })

  test('approves a manually changed gross, keeps the hours in the history and survives a restart', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-03')
    const row = rowOf(page)
    await row.getByLabel(`Brutto — ${NAME}`).fill('1350,00')
    await expect(row.getByTestId(`payroll-calc-${PERSON.id}`)).toHaveText('wyliczono 26 h × 50,00 zł = 1300,00 zł')
    await expect(row.getByLabel(`Zaznacz do zatwierdzenia — ${NAME}`)).toBeChecked()
    await page.getByRole('button', { name: /^Zatwierdź zaznaczone \(1\)$/ }).click()
    await expect(row.getByText('Zatwierdzone · v1')).toBeVisible()

    const { version, approval } = await withDb(async (db) => {
      const effective = await db.payrollSettlementVersion.findFirstOrThrow({ where: { employeeId: PERSON.id, ...MARCH, supersededAt: null } })
      return {
        version: effective,
        approval: await db.payrollAuditEvent.findFirstOrThrow({ where: { settlementId: effective.settlementId, action: 'settlement.approve' } }),
      }
    })
    expect([version.finalGrossGrosze, version.finalNetGrosze, version.approvedWorkedMinutes, version.payoutOvertimeMinutes, version.timeOffOvertimeMinutes])
      .toEqual([135000, 104000, 1560, 0, 0])
    const after = JSON.parse(approval.afterJson ?? '{}')
    expect([after.approvedWorkedMinutes, after.hourlyRateGrosze]).toEqual([1560, 5000])
    await shot(page, '04-approved.png')

    // Detail page: the Saturday line is paid at the rate — no "Wypłata / Czas wolny".
    await row.getByRole('button', { name: `Akcje — ${NAME}` }).click()
    await page.getByRole('menuitem', { name: 'Szczegóły rozliczenia' }).click()
    await expect(page.getByTestId('hourly-overtime-info')).toBeVisible()
    await expect(page.getByTestId('ot-2026-03-07')).toContainText('płatne stawką')
    await expect(page.getByRole('button', { name: 'Wypłata' })).toHaveCount(0)
    // The change history is the folded "Historia zmian" panel since stage 5 (§12): open it by click.
    await page.getByTestId('fold-history-summary').click()
    await expect(page.getByTestId('fold-history').getByText(/przepracowane: 26 h/).first()).toBeVisible()
    await expect(page.getByTestId('fold-history').getByText(/stawka godzinowa: 50,00/).first()).toBeVisible()
    await shot(page, '05-detail-hourly.png')

    await restartServer(databaseUrl)
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-03')
    await expect(rowOf(page).getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(rowOf(page).getByTestId('payroll-hours')).toHaveText('26 h zatwierdzone')
    await expect(rowOf(page).getByLabel(`Brutto — ${NAME}`)).toHaveValue('1350,00')
  })

  test('labels the approved row when its hours change after approval', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await withDb((db) => db.timeEntry.create({
      data: {
        id: 'e2e-hourly-extra', employeeId: PERSON.id, date: new Date('2026-03-04T00:00:00Z'),
        clockIn: new Date('2026-03-04T08:00:00Z'), clockOut: new Date('2026-03-04T10:00:00Z'), totalMinutes: 120, breakMinutes: 0,
        overtimeMinutes: 0, status: 'pending', source: 'manual',
      },
    }))
    expect((await page.request.patch('/api/hr/time-tracking/e2e-hourly-extra/approve')).status()).toBe(200)
    await page.goto('/hr/payroll?month=2026-03')
    const notice = rowOf(page).getByRole('group', { name: `Zmiana po zatwierdzeniu — ${NAME}` })
    await expect(notice).toContainText('zmiana po zatwierdzeniu — sprawdź kwotę')
    await expect(notice).toContainText('godziny')
    await expect(rowOf(page).getByTestId('payroll-hours')).toHaveText('28 h zatwierdzone')
    await shot(page, '06-change-hours.png')
  })

  test('refuses "Zatwierdź godziny" and the sheet to an employee', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 })
    await withDb((db) => db.timeEntry.create({
      data: {
        id: 'e2e-hourly-pending', employeeId: PERSON.id, date: new Date('2026-03-05T00:00:00Z'),
        clockIn: new Date('2026-03-05T08:00:00Z'), clockOut: new Date('2026-03-05T09:00:00Z'), totalMinutes: 60, breakMinutes: 0,
        overtimeMinutes: 0, status: 'pending', source: 'manual',
      },
    }))
    await login(page, EMPLOYEE_LOGIN, PASSWORD)
    const responses = await Promise.all([
      page.request.post('/api/hr/payroll/sheet/approve-hours', { data: { employeeId: PERSON.id, month: '2026-03' }, maxRedirects: 0 }),
      page.request.get('/api/hr/payroll/sheet?month=2026-03', { maxRedirects: 0 }),
    ])
    expect(responses.map((r) => r.status())).toEqual([403, 403])
    const pending = await withDb((db) => db.timeEntry.findUniqueOrThrow({ where: { id: 'e2e-hourly-pending' } }))
    expect(pending.status).toBe('pending')
    await page.goto('/hr/payroll?month=2026-03')
    await expect(page).not.toHaveURL(/\/hr\/payroll/)
  })
})
