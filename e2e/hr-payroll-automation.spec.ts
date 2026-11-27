import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma'
import { shiftMonthKey, warsawClock } from '../src/lib/payroll/auto-carryover-scheduler'
import { formatGrosze } from '../src/lib/payroll/money'
import { dayMonthGenitive, monthNominative } from '../src/lib/payroll/month-names'

// Payroll automat (stage 2) on the isolated, freshly migrated Playwright database. The run itself is
// triggered by e2e/payroll-automation-run.ts calling the run function directly — never over HTTP.
// The people are employed April–May 2026 only, so they never appear on the months other payroll
// specs use (August–November). Every person and amount is synthetic test data.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const EVIDENCE_DIR = path.join(process.cwd(), 'docs/evidence/2026-11-24-payroll-automation')
const PASSWORD = 'Test-Employee-123!'
const EMPLOYEE_LOGIN = 'autoemployee'
const PEOPLE = [
  { id: 'e2e-auto-a', firstName: 'Testowa', lastName: 'Automatyczna', gross: '5100,00', net: '3700,00' },
  { id: 'e2e-auto-b', firstName: 'Testowy', lastName: 'Majowy', gross: '5200,00', net: '3750,00' },
  { id: 'e2e-auto-c', firstName: 'Testowa', lastName: 'Stała', gross: '5300,00', net: '3800,00' },
] as const
const RAISED = { id: 'e2e-auto-d', firstName: 'Testowa', lastName: 'Podwyżkowa', gross: '5000,00', net: '3600,00' }
const MAY = { year: 2026, month: 5 }
// The switch is flipped "now": the first run is always the 1st of the next month (D10).
const TODAY = warsawClock(new Date())
const NEXT_MONTH = shiftMonthKey(TODAY.month, 1)
const NEXT_RUN = dayMonthGenitive(`${NEXT_MONTH}-01`, true)

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Payroll automation E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
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

async function login(page: Page, username: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Login').fill(username)
  await page.getByLabel('Hasło').fill(password)
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const loginAdmin = (page: Page) => login(page, process.env.ADMIN_USERNAME ?? 'admin', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
const nameOf = (person: { firstName: string; lastName: string }) => `${person.lastName} ${person.firstName}`
const rowOf = (page: Page, id: string) => page.getByTestId(`payroll-row-${id}`)

async function restartServer(databaseUrl: string) {
  const directory = path.dirname(databaseUrl.slice('file:'.length))
  const restartId = `payroll-automation-${Date.now()}`
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

test.describe('HR payroll — automat 1. dnia miesiąca', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let databaseUrl = ''

  test.beforeAll(async () => {
    databaseUrl = assertQaDatabase()
    await mkdir(EVIDENCE_DIR, { recursive: true })
    await withDb(async (db) => {
      await db.costCenter.upsert({ where: { id: 'JAG' }, create: { id: 'JAG', name: 'Salon JAG' }, update: {} })
      for (const person of [...PEOPLE, RAISED]) {
        await db.employee.create({
          data: {
            id: person.id, firstName: person.firstName, lastName: person.lastName, email: `${person.id}@example.test`,
            position: 'Doradca (test)', costCenterId: 'JAG', employmentType: 'UoP',
            startDate: new Date('2026-04-01T00:00:00Z'), endDate: new Date('2026-05-31T00:00:00Z'),
          },
        })
        await db.payrollBaseSalary.create({
          data: { employeeId: person.id, effectiveFrom: '2026-04-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS', createdById: 'e2e-seed' },
        })
      }
      // A raise from May: the automat must leave this person for the ADMIN.
      await db.payrollBaseSalary.create({
        data: { employeeId: RAISED.id, effectiveFrom: '2026-05-01', amountGrosze: 540000, basis: 'MONTHLY_GROSS', createdById: 'e2e-seed' },
      })
      await db.user.create({
        data: {
          username: EMPLOYEE_LOGIN, email: `${EMPLOYEE_LOGIN}@example.test`, name: nameOf(PEOPLE[0]), role: 'EMPLOYEE',
          employeeId: PEOPLE[0].id, passwordHash: await bcrypt.hash(PASSWORD, 10), passwordChangedAt: new Date(),
        },
      })
    })
  })

  test('switches the automat on without approving anything for the current month, and it survives a restart', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const settlementsBefore = await withDb((db) => db.payrollSettlement.count())
    await loginAdmin(page)
    await page.goto('/hr/payroll/rates')
    await expect(page.getByRole('link', { name: 'Ustawienia płac' })).toBeVisible()
    const toggle = page.getByRole('switch', { name: /Automat/ })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('payroll-automation-next')).toContainText(`pierwszy przebieg byłby ${NEXT_RUN}`)
    await shot(page, '00-settings-off.png')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('payroll-automation-next')).toContainText(`Następny przebieg: ${NEXT_RUN}, 6:00 — za ${monthNominative(NEXT_MONTH)}`)
    await shot(page, '01-settings-on.png')

    // A scheduler check right now (the switch was flipped this month) must not run anything (D10).
    const due = automat('due')
    const settings = await withDb((db) => db.appSetting.findMany({ where: { key: { startsWith: 'payroll_auto_carryover' } } }))
    expect({
      due: due.carryover,
      settlements: await withDb((db) => db.payrollSettlement.count()),
      lastMonth: settings.find((s) => s.key === 'payroll_auto_carryover_last_month')?.value,
    }).toEqual({ due: { ran: false, reason: 'NOT_DUE' }, settlements: settlementsBefore, lastMonth: TODAY.month })

    // A real restart of the server process; the open dev page loses its connection, so log in again.
    await restartServer(databaseUrl)
    await loginAdmin(page)
    await page.goto('/hr/payroll/rates')
    await expect(page.getByRole('switch', { name: /Automat/ })).toHaveAttribute('aria-checked', 'true')

    await page.goto('/hr/payroll')
    await expect(page.getByTestId('payroll-automation-line')).toContainText(`Automat: włączony · następny przebieg ${dayMonthGenitive(`${NEXT_MONTH}-01`)}`)
    await page.getByTestId('payroll-automation-line').getByRole('link', { name: 'Ustawienia płac' }).click()
    await expect(page).toHaveURL(/\/hr\/payroll\/rates#automat$/)
  })

  test('approves the ready people of May automatically, stamps them, and notifies the ADMIN in the bell', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    // April entered by hand through the sheet API (the same call the "Zatwierdź zaznaczone" button makes).
    const april = await page.request.post('/api/hr/payroll/sheet', {
      data: { month: '2026-04', rows: [...PEOPLE, RAISED].map((p) => ({ employeeId: p.id, finalGross: p.gross, finalNet: p.net })) },
    })
    expect((await april.json()).results.map((r: { status: string }) => r.status)).toEqual(['APPROVED', 'APPROVED', 'APPROVED', 'APPROVED'])

    const run = automat('run', '2026-05')
    expect({ approved: run.approved, attention: run.attention.map((a: { employeeId: string }) => a.employeeId), errors: run.errors })
      .toEqual({ approved: PEOPLE.map((p) => p.id).sort(), attention: [RAISED.id], errors: [] })

    const versions = await withDb((db) => db.payrollSettlementVersion.findMany({ where: { ...MAY, employeeId: { in: PEOPLE.map((p) => p.id) } }, orderBy: { employeeId: 'asc' } }))
    expect(versions.map((v) => [v.employeeId, v.versionNumber, v.origin, v.finalGrossGrosze, v.approvedById, v.approvalNote])).toEqual([
      ['e2e-auto-a', 1, 'AUTO_CARRYOVER', 510000, 'system:payroll-auto', 'Automatyczne przeniesienie z 2026-04'],
      ['e2e-auto-b', 1, 'AUTO_CARRYOVER', 520000, 'system:payroll-auto', 'Automatyczne przeniesienie z 2026-04'],
      ['e2e-auto-c', 1, 'AUTO_CARRYOVER', 530000, 'system:payroll-auto', 'Automatyczne przeniesienie z 2026-04'],
    ])

    await page.goto('/hr/payroll?month=2026-05')
    for (const person of PEOPLE) await expect(rowOf(page, person.id).getByText('Zatwierdzone automatycznie · v1')).toBeVisible()
    await expect(rowOf(page, RAISED.id).getByText(/angaż zmienił się od kwietnia/)).toBeVisible()
    await expect(rowOf(page, RAISED.id).getByText('Zatwierdzone')).toHaveCount(0)
    await shot(page, '02-may-auto-stamps.png')

    await page.getByRole('button', { name: 'Powiadomienia' }).click()
    const note = page.getByText('Wynagrodzenia za maj: 3 zatwierdzone automatycznie, 1 wymaga uwagi')
    await expect(note).toBeVisible()
    await shot(page, '03-bell.png', false)
    await note.click()
    await expect(page).toHaveURL(/\/hr\/payroll\?month=2026-05$/)

    const notifications = await withDb((db) => db.notification.findMany({ where: { type: 'payroll_auto' } }))
    const recipients = await withDb((db) => db.user.findMany({ where: { id: { in: notifications.map((n) => n.userId) } }, select: { role: true } }))
    expect(recipients.every((user) => user.role === 'ADMIN') && recipients.length > 0).toBe(true)
  })

  test('shows "Automat" as the author in the history and versions of the detail page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-05')
    await rowOf(page, PEOPLE[0].id).getByRole('button', { name: `Akcje — ${nameOf(PEOPLE[0])}` }).click()
    await page.getByRole('menuitem', { name: 'Szczegóły rozliczenia' }).click()
    // "Wersje" and "Historia zmian" are folded panels since stage 5 (§12): open both by click.
    await page.getByTestId('fold-versions-summary').click()
    await page.getByTestId('fold-history-summary').click()
    await expect(page.getByText('Zatwierdzono wersję · Automat')).toBeVisible()
    await expect(page.getByText('Utworzono rozliczenie · Automat')).toBeVisible()
    await expect(page.getByText('Automatyczne przeniesienie z 2026-04', { exact: true })).toBeVisible()
    await expect(page.getByText(/· Automat$/).first()).toBeVisible()
    await expect(page.getByText('automat', { exact: true })).toBeVisible()
    await shot(page, '04-detail-automat.png')
  })

  test('labels a change after approval, hides it with "Kwota aktualna" and shows the next change again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    const [b, c] = [PEOPLE[1], PEOPLE[2]]

    // An ordinary working day of a salaried person (no overtime) changes nothing.
    // Sick leave for b, approved in Urlopy through the real approval route.
    await withDb(async (db) => {
      await db.timeEntry.create({
        data: { id: 'e2e-auto-te-plain', employeeId: c.id, date: new Date('2026-05-12T00:00:00Z'), clockIn: new Date('2026-05-12T09:00:00Z'),
          clockOut: new Date('2026-05-12T17:00:00Z'), totalMinutes: 480, breakMinutes: 0, overtimeMinutes: 0, status: 'approved', source: 'clock' },
      })
      const sick = await db.leaveType.upsert({
        where: { code: 'SL' }, update: {},
        create: { code: 'SL', name: 'Zwolnienie chorobowe', isPaid: true, requiresApproval: true, tracksBalance: false },
      })
      await db.leaveRequestNew.create({
        data: { id: 'e2e-auto-leave', employeeId: b.id, leaveTypeId: sick.id, status: 'pending', days: 2,
          startDate: new Date('2026-05-13T00:00:00Z'), endDate: new Date('2026-05-14T00:00:00Z') },
      })
    })
    const approve = await page.request.patch('/api/hr/leave-requests/e2e-auto-leave/approve')
    expect(approve.status()).toBe(200)

    await page.goto('/hr/payroll?month=2026-05')
    const rowB = rowOf(page, b.id)
    const notice = rowB.getByRole('group', { name: `Zmiana po zatwierdzeniu — ${nameOf(b)}` })
    await expect(notice).toContainText('zmiana po zatwierdzeniu — sprawdź kwotę')
    await expect(notice).toContainText('nieobecność')
    await expect(rowB.getByText('Zatwierdzone automatycznie · v1')).toBeVisible()
    await expect(rowOf(page, c.id).getByRole('group', { name: /Zmiana po zatwierdzeniu/ })).toHaveCount(0)
    await shot(page, '05-change-label.png')

    await notice.getByRole('button', { name: `Kwota aktualna — ${nameOf(b)}` }).click()
    await expect(notice).toHaveCount(0)
    const acknowledged = await withDb((db) => db.payrollAuditEvent.findMany({ where: { employeeId: b.id, action: 'settlement.changesAcknowledged' } }))
    expect(acknowledged.map((e) => JSON.parse(e.afterJson ?? '{}').changesText)).toEqual(['nieobecność'])
    await page.reload()
    await expect(rowB.getByRole('group', { name: /Zmiana po zatwierdzeniu/ })).toHaveCount(0)

    // A new change: overtime after approval, without a payout/time-off decision → correction via the detail page.
    await withDb((db) => db.timeEntry.create({
      data: { id: 'e2e-auto-te-ot', employeeId: b.id, date: new Date('2026-05-20T00:00:00Z'), clockIn: new Date('2026-05-20T09:00:00Z'),
        clockOut: new Date('2026-05-20T19:00:00Z'), totalMinutes: 600, breakMinutes: 0, overtimeMinutes: 120, status: 'approved', source: 'clock' },
    }))
    await page.reload()
    await expect(notice).toContainText('nadgodziny')
    await expect(notice).not.toContainText('nieobecność')
    await expect(notice).toContainText('Korekta tylko na stronie szczegółów')
    await expect(rowB.getByText('zablokowane')).toHaveCount(0)
    await shot(page, '06-change-again-detail.png')
    // Phone width: the notice stacks under the row, actions stay reachable, no horizontal scroll.
    await page.setViewportSize({ width: 390, height: 900 })
    await rowB.scrollIntoViewIfNeeded()
    await expect(notice.getByRole('button', { name: `Kwota aktualna — ${nameOf(b)}` })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await rowB.screenshot({ path: path.join(EVIDENCE_DIR, '06b-change-mobile-390.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await notice.getByRole('link', { name: 'Otwórz szczegóły' }).click()
    await expect(page).toHaveURL(/\/hr\/payroll\/[^/?]+$/)
    await page.getByTestId('fold-history-summary').click() // "Historia zmian" is folded since stage 5 (§12)
    await expect(page.getByText('Kwota aktualna mimo zmiany po zatwierdzeniu · E2E Administrator')).toBeVisible()
  })

  test('lets the employee see the automatically approved month and keeps the automat from other roles', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 })
    await login(page, EMPLOYEE_LOGIN, PASSWORD)
    await page.goto('/hr/my-pay')
    await expect(page.getByText(/maj 2026/i).first()).toBeVisible()
    await expect(page.getByText(formatGrosze(510000)).first()).toBeVisible()
    await shot(page, '07-my-pay.png')
    const responses = await Promise.all([
      page.request.get('/api/hr/payroll/automation', { maxRedirects: 0 }),
      page.request.put('/api/hr/payroll/automation', { data: { enabled: false }, maxRedirects: 0 }),
      page.request.post('/api/hr/payroll/settlements/any/acknowledge-changes', { data: { signature: 'f'.repeat(64) }, maxRedirects: 0 }),
    ])
    expect(responses.map((r) => r.status())).toEqual([403, 403, 403])
    await page.goto('/hr/payroll/rates')
    await expect(page).not.toHaveURL(/\/hr\/payroll/)
  })

  test('switches the automat off again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll/rates')
    const toggle = page.getByRole('switch', { name: /Automat/ })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('payroll-automation-last')).toContainText('maj 2026')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await page.reload()
    await expect(page.getByRole('switch', { name: /Automat/ })).toHaveAttribute('aria-checked', 'false')
    await shot(page, '08-settings-off-after-run.png')
    await page.goto('/hr/payroll')
    await expect(page.getByTestId('payroll-automation-line')).toContainText('Automat: wyłączony')
  })
})
