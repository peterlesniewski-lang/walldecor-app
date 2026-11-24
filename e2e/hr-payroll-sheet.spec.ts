import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma'
import { calculateEmployerCostGrosze, DEFAULT_EMPLOYER_RATES } from '../src/lib/payroll/employer-cost'
import { formatGrosze, groszeToPlnString } from '../src/lib/payroll/money'

// Month sheet ("arkusz miesiąca") acceptance on the isolated, freshly migrated Playwright database.
// Every person and amount below is synthetic test data.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const EVIDENCE_DIR = path.join(process.cwd(), 'docs/evidence/2026-11-24-payroll-sheet')
const PASSWORD = 'Test-Employee-123!'
const PEOPLE = [
  { id: 'e2e-sheet-a', firstName: 'Testowa', lastName: 'Arkuszowa', gross: '5000,00', net: '3600,00' },
  { id: 'e2e-sheet-b', firstName: 'Testowy', lastName: 'Bilansowy', gross: '5200,00', net: '3700,00' },
  { id: 'e2e-sheet-c', firstName: 'Testowa', lastName: 'Cyfrowa', gross: '4800,00', net: '3500,00' },
] as const
const CONTRACTOR = { id: 'e2e-sheet-x', firstName: 'Testowy', lastName: 'Wykonawca' }
const NO_BASE = { id: 'e2e-sheet-d', firstName: 'Testowa', lastName: 'Dopisana' }
const EMPLOYEE_LOGIN = 'sheetemployee'
const OCT = { year: 2026, month: 10 }

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Payroll sheet E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
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

async function loginAdmin(page: Page) {
  await login(page, process.env.ADMIN_USERNAME ?? 'admin', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
}

async function restartServer(databaseUrl: string) {
  const directory = path.dirname(databaseUrl.slice('file:'.length))
  const restartId = `payroll-sheet-${Date.now()}`
  await writeFile(path.join(directory, 'restart-request'), restartId, { mode: 0o600 })
  await expect.poll(
    async () => readFile(path.join(directory, 'restart-complete'), 'utf8').catch(() => ''),
    { timeout: 100_000 }
  ).toBe(restartId)
}

const nameOf = (person: { firstName: string; lastName: string }) => `${person.lastName} ${person.firstName}`
const rowOf = (page: Page, id: string) => page.getByTestId(`payroll-row-${id}`)
const field = (page: Page, person: { id: string; firstName: string; lastName: string }, label: 'Brutto' | 'Netto') =>
  rowOf(page, person.id).getByRole('textbox', { name: `${label} — ${nameOf(person)}` })

async function shot(page: Page, name: string, fullPage = true) {
  await expect(page.getByRole('region', { name: 'Pracownicy w miesiącu' })).toHaveCSS('opacity', '1')
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

test.describe('HR payroll — month sheet', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  let databaseUrl = ''

  test.beforeAll(async () => {
    databaseUrl = assertQaDatabase()
    await mkdir(EVIDENCE_DIR, { recursive: true })
    await withDb(async (db) => {
      await db.costCenter.upsert({ where: { id: 'JAG' }, create: { id: 'JAG', name: 'Salon JAG' }, update: {} })
      for (const person of [...PEOPLE, CONTRACTOR]) {
        await db.employee.create({
          data: {
            id: person.id,
            firstName: person.firstName,
            lastName: person.lastName,
            email: `${person.id}@example.test`,
            position: 'Doradca (test)',
            costCenterId: 'JAG',
            startDate: new Date('2026-01-01T00:00:00Z'),
            employmentType: person.id === CONTRACTOR.id ? 'B2B' : 'UoP',
          },
        })
        await db.payrollBaseSalary.create({
          data: { employeeId: person.id, effectiveFrom: '2026-01-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS', createdById: 'e2e-seed' },
        })
      }
      await db.user.create({
        data: {
          username: EMPLOYEE_LOGIN,
          email: `${EMPLOYEE_LOGIN}@example.test`,
          name: nameOf(PEOPLE[0]),
          role: 'EMPLOYEE',
          employeeId: PEOPLE[0].id,
          passwordHash: await bcrypt.hash(PASSWORD, 10),
          passwordChangedAt: new Date(),
        },
      })
    })
  })

  test('enters September by hand with the keyboard and approves it in one click', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-09')
    await expect(page.getByRole('heading', { name: /wrzesień/ })).toBeVisible()
    await expect(rowOf(page, CONTRACTOR.id)).toHaveCount(0)

    // Tab goes gross → net → next row's gross; typing selects the row.
    await field(page, PEOPLE[0], 'Brutto').click()
    for (const [index, person] of PEOPLE.entries()) {
      await expect(field(page, person, 'Brutto')).toBeFocused()
      await page.keyboard.type(person.gross)
      await page.keyboard.press('Tab')
      await expect(field(page, person, 'Netto')).toBeFocused()
      await page.keyboard.type(person.net)
      if (index < PEOPLE.length - 1) await page.keyboard.press('Tab')
    }
    await expect(page.getByRole('button', { name: 'Zatwierdź zaznaczone (3)' })).toBeEnabled()
    await shot(page, '00-september-typed.png')
    await page.getByRole('button', { name: 'Zatwierdź zaznaczone (3)' }).click()
    for (const person of PEOPLE) await expect(rowOf(page, person.id).getByText('Zatwierdzone · v1')).toBeVisible()
  })

  test('suggests September amounts in October without writing anything, then approves all three', async ({ page, browser }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-10')
    await expect(page.getByRole('heading', { name: /październik/ })).toBeVisible()

    // DoD 1: suggestions with their source, and no October settlement in the database.
    for (const person of PEOPLE) {
      await expect(field(page, person, 'Brutto')).toHaveValue(person.gross)
      await expect(field(page, person, 'Netto')).toHaveValue(person.net)
      await expect(rowOf(page, person.id).getByText('z września').first()).toBeVisible()
    }
    await expect(rowOf(page, CONTRACTOR.id)).toHaveCount(0)
    expect(await withDb((db) => db.payrollSettlement.count({ where: { ...OCT, employeeId: { in: PEOPLE.map((p) => p.id) } } }))).toBe(0)
    await shot(page, '01-october-suggested.png')

    // A second tab opens the same month before the first one approves.
    const second = await browser.newContext()
    const secondPage = await second.newPage()
    await loginAdmin(secondPage)
    await secondPage.goto('/hr/payroll?month=2026-10')
    await expect(field(secondPage, PEOPLE[2], 'Brutto')).toHaveValue(PEOPLE[2].gross)

    // DoD 3: changing gross recalculates the employer cost in the row immediately.
    const cost = rowOf(page, PEOPLE[1].id).getByTestId(`payroll-cost-${PEOPLE[1].id}`)
    await expect(cost).toHaveText(formatGrosze(calculateEmployerCostGrosze(520000, DEFAULT_EMPLOYER_RATES.UOP)))
    await field(page, PEOPLE[1], 'Brutto').fill('5450,50')
    await expect(cost).toHaveText(formatGrosze(calculateEmployerCostGrosze(545050, DEFAULT_EMPLOYER_RATES.UOP)))

    // DoD 9: month payroll list number, saved on Enter.
    const reference = page.getByRole('textbox', { name: 'Numer listy płac' })
    await reference.fill('LP 10/2026 (test)')
    await reference.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: /^zapisano/ })).toBeVisible()
    await shot(page, '02-october-edited.png')

    // DoD 2: one click approves all three.
    await page.getByRole('button', { name: 'Zatwierdź zaznaczone (3)' }).click()
    for (const person of PEOPLE) await expect(rowOf(page, person.id).getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(page.getByTestId('sheet-approved-count')).toHaveText(`3 / ${await page.getByTestId(/^payroll-row-/).count()}`)
    await shot(page, '03-october-approved.png')

    const stored = await withDb(async (db) => ({
      settlements: await db.payrollSettlement.findMany({ where: { ...OCT, employeeId: { in: PEOPLE.map((p) => p.id) } }, orderBy: { employeeId: 'asc' } }),
      versions: await db.payrollSettlementVersion.findMany({ where: { ...OCT, employeeId: { in: PEOPLE.map((p) => p.id) } }, orderBy: { employeeId: 'asc' } }),
      events: await db.payrollAuditEvent.findMany({ where: { employeeId: { in: PEOPLE.map((p) => p.id) }, settlement: OCT }, orderBy: { createdAt: 'asc' } }),
    }))
    expect({
      settlements: stored.settlements.map((s) => [s.employeeId, s.status, s.currentVersionNumber]),
      versionB: [stored.versions[1].finalGrossGrosze, stored.versions[1].employerCostGrosze, stored.versions[1].employerCostSource],
      references: [...new Set(stored.versions.map((v) => v.payrollOfficeReference))],
      events: PEOPLE.map((p) => stored.events.filter((e) => e.employeeId === p.id).map((e) => e.action)),
    }).toEqual({
      settlements: PEOPLE.map((p) => [p.id, 'APPROVED', 1]),
      versionB: [545050, calculateEmployerCostGrosze(545050, DEFAULT_EMPLOYER_RATES.UOP), 'CALCULATED'],
      references: ['LP 10/2026 (test)'],
      events: PEOPLE.map(() => ['settlement.create', 'payrollOffice.confirm', 'settlement.approve']),
    })

    // DoD 10: the second tab approves a row that the first tab already approved → CONFLICT.
    await field(secondPage, PEOPLE[2], 'Brutto').press('Enter')
    await expect(rowOf(secondPage, PEOPLE[2].id).getByRole('alert')).toContainText('zostało w międzyczasie utworzone lub zmienione')
    await secondPage.screenshot({ path: path.join(EVIDENCE_DIR, '04-second-tab-conflict.png'), animations: 'disabled' })
    await second.close()
    expect(await withDb((db) => db.payrollSettlementVersion.count({ where: { ...OCT, employeeId: PEOPLE[2].id, supersededAt: null } }))).toBe(1)
  })

  test('corrects an approved amount in the row and answers UNCHANGED for the same amounts', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-10')
    const row = rowOf(page, PEOPLE[0].id)
    await expect(row.getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Zapisz korektę' })).toHaveCount(0)

    await field(page, PEOPLE[0], 'Netto').fill('3611,11')
    await expect(row.getByRole('button', { name: 'Zapisz korektę' })).toBeVisible()
    await shot(page, '05-correction-pending.png')
    await row.getByRole('button', { name: 'Zapisz korektę' }).click()
    await expect(row.getByText('Zatwierdzone · v2')).toBeVisible()
    await expect(row.getByRole('button', { name: 'Zapisz korektę' })).toHaveCount(0)

    const corrected = await withDb(async (db) => ({
      versions: await db.payrollSettlementVersion.findMany({ where: { ...OCT, employeeId: PEOPLE[0].id }, orderBy: { versionNumber: 'asc' } }),
      reopen: await db.payrollAuditEvent.findFirst({ where: { employeeId: PEOPLE[0].id, action: 'settlement.reopen' } }),
      settlement: await db.payrollSettlement.findFirstOrThrow({ where: { ...OCT, employeeId: PEOPLE[0].id } }),
    }))
    expect({
      versions: corrected.versions.map((v) => [v.versionNumber, v.finalNetGrosze, v.supersededAt === null]),
      reason: corrected.reopen?.reason,
    }).toEqual({
      versions: [[1, 360000, false], [2, 361111, true]],
      reason: 'Korekta kwot na liście miesiąca',
    })

    // The same amounts through the API: no new version.
    const res = await page.request.post('/api/hr/payroll/sheet', {
      data: { month: '2026-10', rows: [{ employeeId: PEOPLE[0].id, finalGross: '5000,00', finalNet: '3611,11', expectedRevision: corrected.settlement.revision }] },
    })
    expect([res.status(), (await res.json()).results[0].status]).toEqual([200, 'UNCHANGED'])
    expect(await withDb((db) => db.payrollSettlementVersion.count({ where: { ...OCT, employeeId: PEOPLE[0].id } }))).toBe(2)
  })

  test('keeps the approved month after a real server restart', async ({ page }) => {
    await restartServer(databaseUrl)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-10')
    await expect(rowOf(page, PEOPLE[0].id).getByText('Zatwierdzone · v2')).toBeVisible()
    await expect(field(page, PEOPLE[0], 'Netto')).toHaveValue('3611,11')
    await expect(rowOf(page, PEOPLE[1].id).getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(field(page, PEOPLE[1], 'Brutto')).toHaveValue('5450,50')
    await expect(page.getByRole('textbox', { name: 'Numer listy płac' })).toHaveValue('LP 10/2026 (test)')
    await expect(rowOf(page, CONTRACTOR.id)).toHaveCount(0)
    await shot(page, '06-after-restart.png')
  })

  test('holds month navigation while there are unsaved changes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-10')
    await field(page, PEOPLE[2], 'Brutto').fill('4900,00')
    await page.getByRole('button', { name: 'Poprzedni miesiąc' }).click()
    const banner = page.getByRole('alert').filter({ hasText: 'niezapisane zmiany' })
    await expect(banner).toBeVisible()
    await expect(page.getByRole('heading', { name: /październik/ })).toBeVisible()
    await shot(page, '07-unsaved-changes.png', false)
    await banner.getByRole('button', { name: 'Zostań' }).click()
    await expect(banner).toBeHidden()
    await expect(field(page, PEOPLE[2], 'Brutto')).toHaveValue('4900,00')
    await page.getByRole('button', { name: 'Poprzedni miesiąc' }).click()
    await page.getByRole('button', { name: 'Porzuć zmiany' }).click()
    await expect(page.getByRole('heading', { name: /wrzesień/ })).toBeVisible()
    expect(await withDb((db) => db.payrollSettlementVersion.count({ where: { ...OCT, employeeId: PEOPLE[2].id } }))).toBe(1)
  })

  test('shows a person without a salary as blocked with the action that fixes it', async ({ page }) => {
    await withDb((db) => db.employee.create({
      data: {
        id: NO_BASE.id, firstName: NO_BASE.firstName, lastName: NO_BASE.lastName, email: `${NO_BASE.id}@example.test`,
        position: 'Doradca (test)', costCenterId: 'JAG', startDate: new Date('2026-01-01T00:00:00Z'), employmentType: 'UoP',
      },
    }))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-10')
    const row = rowOf(page, NO_BASE.id)
    await expect(row.getByRole('checkbox')).toBeDisabled()
    await expect(row.getByText('Brak podstawy wynagrodzenia obowiązującej w tym miesiącu.')).toBeVisible()
    await field(page, NO_BASE, 'Brutto').fill('4000,00')
    await field(page, NO_BASE, 'Netto').fill('3000,00')
    await field(page, NO_BASE, 'Netto').press('Enter')
    await expect(row.getByRole('alert')).toContainText('Tego wiersza nie można zatwierdzić')
    expect(await withDb((db) => db.payrollSettlement.count({ where: { employeeId: NO_BASE.id } }))).toBe(0)
    await shot(page, '08-blocked-row.png')

    await row.getByRole('button', { name: 'Angaż…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Obowiązuje od')).toHaveValue('2026-10-01')
    await dialog.getByRole('button', { name: 'Zamknij' }).first().click()

    // The same row through the API: BLOCKED and still no settlement row.
    const res = await page.request.post('/api/hr/payroll/sheet', {
      data: { month: '2026-10', rows: [{ employeeId: NO_BASE.id, finalGross: '4000,00', finalNet: '3000,00' }] },
    })
    const body = await res.json()
    expect([res.status(), body.results[0].status, body.results[0].blockers.map((b: { code: string }) => b.code)])
      .toEqual([200, 'BLOCKED', ['BASE_MISSING']])
    expect(await withDb((db) => db.payrollSettlement.count({ where: { employeeId: NO_BASE.id } }))).toBe(0)
  })

  test('every remaining control on the sheet does what it says (dummy audit)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-10')
    const c = PEOPLE[2]
    const rowC = rowOf(page, c.id)

    // "wpisz ręcznie" turns the calculated cost into a prefilled field; "licz ze stawek" restores it.
    await rowC.getByRole('button', { name: `Wpisz koszt pracodawcy ręcznie — ${nameOf(c)}` }).click()
    await expect(rowC.getByRole('textbox', { name: `Koszt pracodawcy — ${nameOf(c)}` }))
      .toHaveValue(groszeToPlnString(calculateEmployerCostGrosze(480000, DEFAULT_EMPLOYER_RATES.UOP)).replace('.', ','))
    await expect(rowC.getByRole('button', { name: 'Zapisz korektę' })).toBeVisible()
    await rowC.getByRole('button', { name: `Licz koszt pracodawcy ze stawek — ${nameOf(c)}` }).click()
    await expect(rowC.getByRole('textbox', { name: `Koszt pracodawcy — ${nameOf(c)}` })).toHaveCount(0)
    await expect(rowC.getByRole('button', { name: 'Zapisz korektę' })).toHaveCount(0)

    // "Angaż…" adds a real base salary: the blocker disappears from the row.
    const rowD = rowOf(page, NO_BASE.id)
    await rowD.getByRole('button', { name: 'Angaż…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Kwota (PLN)').fill('4000,00')
    await dialog.getByRole('button', { name: 'Dodaj podstawę' }).click()
    await expect(dialog.getByText('od 2026-10-01')).toBeVisible()
    await dialog.getByRole('button', { name: 'Zamknij' }).first().click()
    await expect(rowD.getByText('Brak podstawy wynagrodzenia obowiązującej w tym miesiącu.')).toHaveCount(0)
    await expect(rowD.getByRole('checkbox')).toBeEnabled()

    // "Następny miesiąc" → November, suggested from October; the checkboxes drive the action bar.
    await page.getByRole('button', { name: 'Następny miesiąc' }).click()
    await expect(page.getByRole('heading', { name: /listopad/ })).toBeVisible()
    await expect(field(page, PEOPLE[0], 'Netto')).toHaveValue('3611,11')
    await expect(page.getByRole('button', { name: 'Zatwierdź zaznaczone (3)' })).toBeVisible()
    const checkA = rowOf(page, PEOPLE[0].id).getByRole('checkbox')
    await checkA.uncheck()
    await expect(page.getByRole('button', { name: 'Zatwierdź zaznaczone (2)' })).toBeVisible()
    await checkA.check()
    await expect(page.getByRole('button', { name: 'Zatwierdź zaznaczone (3)' })).toBeVisible()

    // Pending overtime in November blocks Dopisana; "Otwórz (utworzy szkic)" is tested at the end.
    await withDb((db) => db.timeEntry.create({
      data: {
        id: 'e2e-sheet-te-pending', employeeId: NO_BASE.id, date: new Date('2026-11-03T00:00:00Z'),
        clockIn: new Date('2026-11-03T09:00:00Z'), clockOut: new Date('2026-11-03T19:00:00Z'),
        totalMinutes: 600, breakMinutes: 0, overtimeMinutes: 120, status: 'pending', source: 'manual',
      },
    }))
    await page.reload()
    await expect(rowOf(page, NO_BASE.id).getByText('nie zostały zatwierdzone przez przełożonego')).toBeVisible()

    // The banner's own "Zatwierdź zaznaczone" approves and then completes the navigation.
    await field(page, PEOPLE[0], 'Netto').fill('3611,12')
    await page.getByRole('button', { name: 'Poprzedni miesiąc' }).click()
    const banner = page.getByRole('alert').filter({ hasText: 'niezapisane zmiany' })
    await banner.getByRole('button', { name: 'Zatwierdź zaznaczone (3)' }).click()
    await expect(page.getByRole('heading', { name: /październik/ })).toBeVisible()
    const november = await withDb((db) => db.payrollSettlementVersion.findMany({
      where: { year: 2026, month: 11, employeeId: { in: PEOPLE.map((p) => p.id) }, supersededAt: null },
      orderBy: { employeeId: 'asc' },
    }))
    expect(november.map((v) => [v.employeeId, v.versionNumber, v.finalNetGrosze]))
      .toEqual([[PEOPLE[0].id, 1, 361112], [PEOPLE[1].id, 1, 370000], [PEOPLE[2].id, 1, 350000]])

    // Row menu "Szczegóły rozliczenia" opens the existing detail page.
    await page.goto('/hr/payroll?month=2026-11')
    await rowOf(page, PEOPLE[0].id).getByRole('button', { name: `Akcje — ${nameOf(PEOPLE[0])}` }).click()
    await page.getByRole('menuitem', { name: 'Szczegóły rozliczenia' }).click()
    await expect(page).toHaveURL(/\/hr\/payroll\/[^/?]+$/)
    await expect(page.getByRole('region', { name: 'Podsumowanie rozliczenia' }).getByText('Zatwierdzone · v1')).toBeVisible()

    // The blocker's "Otwórz (utworzy szkic)" creates a draft and opens it.
    await page.goto('/hr/payroll?month=2026-11')
    await rowOf(page, NO_BASE.id).getByRole('button', { name: 'Otwórz (utworzy szkic)' }).click()
    await expect(page).toHaveURL(/\/hr\/payroll\/[^/?]+$/)
    expect(await withDb((db) => db.payrollSettlement.findMany({ where: { employeeId: NO_BASE.id }, select: { year: true, month: true, status: true } })))
      .toEqual([{ year: 2026, month: 11, status: 'DRAFT' }])
  })

  test('lays the sheet out as cards on a phone without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAdmin(page)
    await page.goto('/hr/payroll?month=2026-10')
    await expect(field(page, PEOPLE[0], 'Brutto')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Zatwierdzanie zaznaczonych' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, '09-mobile-390.png')
  })

  test('denies the sheet to an employee and to a visitor without a session', async ({ page, browser }) => {
    await login(page, EMPLOYEE_LOGIN, PASSWORD)
    const responses = await Promise.all([
      page.request.get('/api/hr/payroll/sheet?month=2026-10'),
      page.request.post('/api/hr/payroll/sheet', { data: { month: '2026-10', rows: [{ employeeId: PEOPLE[0].id, finalGross: '1', finalNet: '1' }] } }),
      page.request.put('/api/hr/payroll/months/2026-10', { data: { listReference: 'próba' } }),
    ])
    expect(responses.map((r) => r.status())).toEqual([403, 403, 403])
    expect(await responses[0].text()).not.toContain('5000')
    await page.goto('/hr/payroll?month=2026-10')
    await expect(page).not.toHaveURL(/\/hr\/payroll/)

    const anonymous = await browser.newContext()
    try {
      const visitor = await anonymous.newPage()
      const api = await Promise.all([
        visitor.request.get('/api/hr/payroll/sheet?month=2026-10', { maxRedirects: 0 }),
        visitor.request.post('/api/hr/payroll/sheet', { data: { month: '2026-10', rows: [] }, maxRedirects: 0 }),
        visitor.request.put('/api/hr/payroll/months/2026-10', { data: { listReference: 'próba' }, maxRedirects: 0 }),
      ])
      // The route handlers answer 401 (integration test); over HTTP the proxy (withAuth) intercepts a
      // request without a session first and redirects it to the login page, so no payroll data leaves.
      expect(api.map((r) => [r.status(), new URL(r.headers().location ?? '', 'http://localhost').pathname]))
        .toEqual([[307, '/login'], [307, '/login'], [307, '/login']])
      await visitor.goto('/hr/payroll?month=2026-10')
      await expect(visitor).toHaveURL(/\/login/)
    } finally {
      await anonymous.close()
    }
  })
})
