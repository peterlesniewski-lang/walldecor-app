import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '../src/generated/prisma'
import { pluralPl } from '../src/lib/plural-pl'

// Settlement details page (stage 5 of the payroll simplification) on the isolated, freshly migrated
// Playwright database. The people are employed January–February 2026 only, so they never show up on the
// months other payroll specs use. Every person and amount is synthetic test data.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const EVIDENCE_DIR = path.join(process.cwd(), 'docs/evidence/2026-11-24-payroll-details')
const JAN = '2026-01'
const FEB = '2026-02'
const PERSON = { id: 'e2e-pd-a', firstName: 'Testowa', lastName: 'Szczegółowa' }
const SHEET_PERSON = { id: 'e2e-pd-s', firstName: 'Testowa', lastName: 'Arkuszowa-Szczegółowa' }
const GLOBAL_PERSON = { id: 'e2e-pd-g', firstName: 'Testowa', lastName: 'Globalna' }
const HOURLY = { id: 'e2e-pd-h', firstName: 'Testowy', lastName: 'Godzinowy' }

// The floating assistant button: fixed, 48 px, 24 px from the bottom-right corner (ai-chat-widget.tsx).
const fabRect = (width: number, height: number) => ({ left: width - 72, top: height - 72, right: width - 24, bottom: height - 24 })

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Payroll details E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
  }
}

async function loginAdmin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Login').fill(process.env.ADMIN_USERNAME ?? 'admin')
  await page.getByLabel('Hasło').fill(process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).not.toHaveURL(/\/login/)
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
  await page.waitForTimeout(700) // entrance animation (rise) settles
  await page.screenshot({ path: path.join(EVIDENCE_DIR, name), fullPage, animations: 'disabled' })
}

async function postSheet(page: Page, month: string, rows: Array<{ employeeId: string; finalGross: string; finalNet: string }>) {
  const response = await page.request.post('/api/hr/payroll/sheet', { data: { month, rows } })
  expect(response.status()).toBe(200)
  return (await response.json()).results as Array<{ status: string }>
}

async function createDraft(page: Page, employeeId: string, month: string) {
  const response = await page.request.post('/api/hr/payroll/settlements', { data: { employeeId, month } })
  expect(response.status()).toBe(201)
  return (await response.json()).id as string
}

const settlementOf = (employeeId: string, month: number) =>
  withDb((db) => db.payrollSettlement.findFirstOrThrow({ where: { employeeId, year: 2026, month } }))

/** The scrolling element of the dashboard shell (the page scrolls inside it, not the window). */
async function scrollPageTo(page: Page, where: 'top' | 'bottom') {
  await page.getByTestId('settlement-page').evaluate((root, target) => {
    let node: HTMLElement | null = root.parentElement
    while (node && node.scrollHeight <= node.clientHeight + 1) node = node.parentElement
    const scroller = node ?? document.scrollingElement
    if (scroller) scroller.scrollTop = target === 'top' ? 0 : scroller.scrollHeight
  }, where)
  await page.waitForTimeout(150)
}

/** Interactive elements on screen whose box overlaps `rect` (the assistant button itself is skipped). */
async function actionableUnder(page: Page, rect: { left: number; top: number; right: number; bottom: number }) {
  return page.evaluate((box) => {
    const selector = 'a[href], button, input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])'
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((element) => {
        for (let node: HTMLElement | null = element; node; node = node.parentElement) {
          if (getComputedStyle(node).position === 'fixed') return false
        }
        // The body of a closed <details> is not shown (only its summary is).
        const details = element.closest('details')
        if (details && !details.open && !(element.tagName === 'SUMMARY' && element.parentElement === details)) return false
        const r = element.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return false
        return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top
      })
      .map((element) => {
        const r = element.getBoundingClientRect()
        const name = element.getAttribute('aria-label') ?? element.getAttribute('name') ?? element.textContent ?? ''
        return `${element.tagName.toLowerCase()} "${name.trim().slice(0, 40)}" at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
      })
  }, rect)
}

test.describe('HR payroll — settlement details page', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  test.beforeAll(async () => {
    assertQaDatabase()
    await mkdir(EVIDENCE_DIR, { recursive: true })
    await withDb(async (db) => {
      await db.costCenter.upsert({ where: { id: 'JAG' }, create: { id: 'JAG', name: 'Salon JAG' }, update: {} })
      await db.costCenter.upsert({ where: { id: 'GLOBAL' }, create: { id: 'GLOBAL', name: 'Globalne' }, update: {} })
      const card = (person: { id: string; firstName: string; lastName: string }, extra: Record<string, unknown> = {}) => ({
        ...person,
        email: `${person.id}@example.test`,
        position: 'Doradca (test)',
        costCenterId: 'JAG',
        employmentType: 'UoP',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-02-28T00:00:00Z'),
        ...extra,
      })
      await db.employee.createMany({
        data: [
          card(PERSON),
          card(SHEET_PERSON),
          card(GLOBAL_PERSON, { costCenterId: 'GLOBAL' }),
          card(HOURLY, { employmentType: 'UZ' }),
        ],
      })
      for (const person of [PERSON, SHEET_PERSON, GLOBAL_PERSON]) {
        await db.payrollBaseSalary.create({
          data: { employeeId: person.id, effectiveFrom: '2026-01-01', amountGrosze: 500000, basis: 'MONTHLY_GROSS', createdById: 'e2e-seed' },
        })
      }
      await db.payrollBaseSalary.create({
        data: { employeeId: HOURLY.id, effectiveFrom: '2026-01-01', amountGrosze: 5000, basis: 'HOURLY_GROSS', createdById: 'e2e-seed' },
      })
      // February hours of the hourly person (Czas pracy data): 2 × 8 h approved = 16 h.
      for (const day of ['2026-02-03', '2026-02-04']) {
        await db.timeEntry.create({
          data: {
            employeeId: HOURLY.id, date: new Date(`${day}T00:00:00Z`), clockIn: new Date(`${day}T08:00:00Z`),
            clockOut: new Date(`${day}T16:00:00Z`), totalMinutes: 480, breakMinutes: 0, overtimeMinutes: 0, status: 'approved', source: 'manual',
          },
        })
      }
    })
  })

  test('shows amounts and "Zapisz i zatwierdź" on the first screen at 1280×800, pre-filled with last month, and approves like a sheet row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginAdmin(page)
    expect((await postSheet(page, JAN, [
      { employeeId: PERSON.id, finalGross: '5000,00', finalNet: '3600,00' },
      { employeeId: SHEET_PERSON.id, finalGross: '5000,00', finalNet: '3600,00' },
    ])).map((r) => r.status)).toEqual(['APPROVED', 'APPROVED'])

    const id = await createDraft(page, PERSON.id, FEB)
    await page.goto(`/hr/payroll/${id}`)
    const amounts = page.getByRole('region', { name: 'Kwoty i zatwierdzenie' })
    const gross = amounts.getByLabel('Brutto (ostateczne)')
    const net = amounts.getByLabel('Netto do wypłaty')
    const save = amounts.getByRole('button', { name: 'Zapisz i zatwierdź' })
    // Pre-filled with the same suggestion the month sheet gives: January's approved figures.
    await expect(gross).toHaveValue('5000,00')
    await expect(net).toHaveValue('3600,00')
    await expect(amounts.getByText('podpowiedź z stycznia')).toBeVisible()
    await expect(page.getByTestId('settlement-page')).toHaveCSS('opacity', '1')
    await expect(page.getByRole('region', { name: 'Podsumowanie rozliczenia' })).toHaveCSS('opacity', '1')
    await page.waitForTimeout(700) // staggered entrance finished: boxes below are the final ones

    // Bounding boxes against the 1280×800 viewport — fields and button are on screen without scrolling.
    for (const [name, locator] of [['gross', gross], ['net', net], ['save', save]] as const) {
      const box = await locator.boundingBox()
      expect(box, name).not.toBeNull()
      expect(box!.y, `${name} top`).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height, `${name} bottom`).toBeLessThanOrEqual(800)
      expect(box!.x + box!.width, `${name} right`).toBeLessThanOrEqual(1280)
    }
    await expect(save).toBeEnabled()
    // Nothing actionable sits under the assistant button on the first screen or at the end of the page.
    expect(await actionableUnder(page, fabRect(1280, 800))).toEqual([])
    await shot(page, '01-draft-1280x800.png', false)
    await scrollPageTo(page, 'bottom')
    expect(await actionableUnder(page, fabRect(1280, 800))).toEqual([])
    await scrollPageTo(page, 'top')

    // The five-pill stage bar and "rewizja N" are gone.
    await expect(page.getByRole('list', { name: 'Etapy rozliczenia' })).toHaveCount(0)
    await expect(page.getByText(/rewizja \d/)).toHaveCount(0)

    // "Zapisz i zatwierdź": a version, the sheet shows the same amount, history holds both events.
    await save.click()
    await expect(page.getByRole('region', { name: 'Podsumowanie rozliczenia' }).getByText('Zatwierdzone · v1')).toBeVisible()
    await expect(page.getByTestId('settle-notice')).toHaveText('Zatwierdzono wersję 1.')
    const stored = await withDb(async (db) => {
      const settlement = await db.payrollSettlement.findFirstOrThrow({ where: { employeeId: PERSON.id, year: 2026, month: 2 } })
      return {
        versions: await db.payrollSettlementVersion.findMany({ where: { settlementId: settlement.id } }),
        actions: (await db.payrollAuditEvent.findMany({ where: { settlementId: settlement.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((e) => e.action),
      }
    })
    expect(stored.versions.map((v) => [v.versionNumber, v.finalGrossGrosze, v.finalNetGrosze, v.origin])).toEqual([[1, 500000, 360000, 'MANUAL']])
    expect(stored.actions).toEqual(['settlement.create', 'payrollOffice.confirm', 'settlement.approve'])

    await page.goto(`/hr/payroll?month=${FEB}`)
    await expect(page.getByTestId(`payroll-row-${PERSON.id}`).getByRole('textbox', { name: /^Brutto — / })).toHaveValue('5000,00')
    await expect(page.getByTestId(`payroll-row-${PERSON.id}`).getByText('Zatwierdzone · v1')).toBeVisible()
  })

  test('leaves the same audit actions as a sheet row for the same figures', async ({ page }) => {
    await loginAdmin(page)
    // The comparator person goes through the month sheet's route; PERSON went through the details page.
    expect((await postSheet(page, FEB, [{ employeeId: SHEET_PERSON.id, finalGross: '5000,00', finalNet: '3600,00' }])).map((r) => r.status)).toEqual(['APPROVED'])
    const actionsOf = (employeeId: string) => withDb(async (db) => {
      const settlement = await db.payrollSettlement.findFirstOrThrow({ where: { employeeId, year: 2026, month: 2 } })
      return (await db.payrollAuditEvent.findMany({ where: { settlementId: settlement.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((e) => e.action)
    })
    expect(await actionsOf(PERSON.id)).toEqual(await actionsOf(SHEET_PERSON.id))
  })

  test('shows the effective amounts of an approved settlement, demands a reason, and a correction makes v2', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginAdmin(page)
    const settlement = await settlementOf(PERSON.id, 2)
    await page.goto(`/hr/payroll/${settlement.id}`)
    const amounts = page.getByRole('region', { name: 'Kwoty i zatwierdzenie' })
    await expect(amounts.getByLabel('Brutto (ostateczne)')).toHaveValue('5000,00')
    await expect(amounts.getByLabel('Netto do wypłaty')).toHaveValue('3600,00')
    await expect(amounts.getByRole('button', { name: 'Zapisz i zatwierdź' })).toHaveCount(0)

    // Without a reason the server refuses and the form says so; nothing is written.
    await amounts.getByLabel('Brutto (ostateczne)').fill('5200,00')
    await amounts.getByLabel('Netto do wypłaty').fill('3700,00')
    await amounts.getByRole('button', { name: 'Zapisz korektę' }).click()
    await expect(amounts.getByRole('alert')).toHaveText('Podaj powód korekty (min. 3 znaki).')
    await expect(amounts.getByLabel('Powód korekty (wymagany)')).toHaveAttribute('aria-invalid', 'true')
    expect(await withDb((db) => db.payrollSettlementVersion.count({ where: { settlementId: settlement.id } }))).toBe(1)
    const direct = await page.request.post(`/api/hr/payroll/settlements/${settlement.id}/settle`, {
      data: { expectedRevision: settlement.revision, finalGross: '5200,00', finalNet: '3700,00' },
    })
    expect(direct.status()).toBe(400)
    await shot(page, '02-approved-correction-1280.png')

    await amounts.getByLabel('Powód korekty (wymagany)').fill('Premia uznaniowa (test)')
    await amounts.getByRole('button', { name: 'Zapisz korektę' }).click()
    await expect(page.getByTestId('settle-notice')).toHaveText('Zapisano korektę: wersja 2 obowiązuje.')
    await expect(page.getByRole('region', { name: 'Podsumowanie rozliczenia' }).getByText('Zatwierdzone · v2')).toBeVisible()
    await expect(page.getByTestId('figure-Brutto (ostateczne)')).toHaveText('5200,00 zł')
    const versions = await withDb((db) => db.payrollSettlementVersion.findMany({ where: { settlementId: settlement.id }, orderBy: { versionNumber: 'asc' } }))
    expect(versions.map((v) => [v.versionNumber, v.supersededAt !== null, v.finalGrossGrosze])).toEqual([[1, true, 500000], [2, false, 520000]])
    const reopen = await withDb((db) => db.payrollAuditEvent.findFirstOrThrow({ where: { settlementId: settlement.id, action: 'settlement.reopen' } }))
    expect(reopen.reason).toBe('Premia uznaniowa (test)')

    // The same figures again: nothing new is created.
    await amounts.getByLabel('Powód korekty (wymagany)').fill('Bez zmian (test)')
    await amounts.getByRole('button', { name: 'Zapisz korektę' }).click()
    await expect(page.getByTestId('settle-notice')).toHaveText('Kwoty bez zmian — nie utworzono nowej wersji.')
    expect(await withDb((db) => db.payrollSettlementVersion.count({ where: { settlementId: settlement.id } }))).toBe(2)
  })

  test('folds Wersje and Historia zmian with real numbers; they open by click and by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginAdmin(page)
    const settlement = await settlementOf(PERSON.id, 2)
    await page.goto(`/hr/payroll/${settlement.id}`)

    const events = await withDb((db) => db.payrollAuditEvent.count({ where: { settlementId: settlement.id } }))
    const versions = page.getByTestId('fold-versions')
    const history = page.getByTestId('fold-history')
    await expect(versions.locator('summary')).toContainText('Wersje · 2 · obowiązuje v2')
    await expect(history.locator('summary')).toContainText(`Historia zmian · ${events} ${pluralPl(events, 'zdarzenie', 'zdarzenia', 'zdarzeń')}`)
    for (const fold of [versions, history]) await expect(fold).not.toHaveAttribute('open', '')
    await expect(versions.getByText('zastąpiona')).toBeHidden()
    // The shell scrolls inside a container, so a tall viewport is what shows the whole page.
    await page.setViewportSize({ width: 1280, height: 1900 })
    await shot(page, '03-folded-panels.png', false)
    await page.setViewportSize({ width: 1280, height: 800 })

    // Click opens and closes.
    await versions.locator('summary').click()
    await expect(versions).toHaveAttribute('open', '')
    await expect(versions.getByText('zastąpiona')).toBeVisible()
    await expect(versions.getByText('obowiązuje', { exact: true })).toBeVisible()
    await versions.locator('summary').click()
    await expect(versions).not.toHaveAttribute('open', '')

    // Keyboard: Enter and Space on the focused summary.
    const summary = history.locator('summary')
    await summary.focus()
    await page.keyboard.press('Enter')
    await expect(history).toHaveAttribute('open', '')
    await expect(history.getByText('Zatwierdzono wersję · E2E Administrator').first()).toBeVisible()
    await page.keyboard.press('Space')
    await expect(history).not.toHaveAttribute('open', '')
    await page.keyboard.press('Space')
    await expect(history).toHaveAttribute('open', '')
    await versions.locator('summary').click()
    await page.setViewportSize({ width: 1280, height: 2300 })
    await shot(page, '04-unfolded-panels.png', false)
    await page.setViewportSize({ width: 1280, height: 800 })

    // A JAG card has a split by its cost centre, so "Koszt pracodawcy i podział" stays folded.
    await expect(page.getByTestId('fold-employer-cost')).not.toHaveAttribute('open', '')
  })

  test('opens "Koszt pracodawcy i podział" itself when the JAG/PUL split is missing and lets the owner set it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginAdmin(page)
    const id = await createDraft(page, GLOBAL_PERSON.id, FEB)
    await page.goto(`/hr/payroll/${id}`)
    const fold = page.getByTestId('fold-employer-cost')
    await expect(fold).toHaveAttribute('open', '')
    await expect(fold.locator('summary')).toContainText('brak podziału')
    await expect(page.getByTestId('approval-blockers')).toContainText('podział kosztu na salony')
    await expect(page.getByRole('region', { name: 'Kwoty i zatwierdzenie' }).getByRole('button', { name: 'Zapisz i zatwierdź' })).toBeDisabled()
    await shot(page, '05-split-missing-open.png')

    // Exemption and split work as before the re-layout.
    // The checkbox follows the server (controlled): click, then wait for the saved state to come back.
    await fold.getByLabel('bez składek pracodawcy (np. student na UZ)').click()
    await expect(fold.getByLabel('bez składek pracodawcy (np. student na UZ)')).toBeChecked()
    await expect.poll(() => withDb((db) => db.payrollCostProfile.count({ where: { employeeId: GLOBAL_PERSON.id, withoutContributions: true } }))).toBeGreaterThan(0)
    // The form proposes April 2026 (the finance cut-over); this settlement is February's.
    await fold.getByLabel('Od miesiąca').fill('2026-01')
    await fold.getByLabel('JAG %').fill('40')
    await fold.getByRole('button', { name: 'Ustaw podział' }).click()
    await expect(fold.locator('summary')).toContainText('JAG 40% · PUL 60%')
    await expect(page.getByTestId('approval-blockers')).toHaveCount(0)
    const amounts = page.getByRole('region', { name: 'Kwoty i zatwierdzenie' })
    await amounts.getByLabel('Brutto (ostateczne)').fill('5000,00')
    await amounts.getByLabel('Netto do wypłaty').fill('3600,00')
    await expect(amounts.getByRole('button', { name: 'Zapisz i zatwierdź' })).toBeEnabled()
  })

  test('shows the hours-based suggestion and its hint for an hourly person, without payout buttons', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginAdmin(page)
    // January typed by hand: the net proportion 0,8 (4000 → 3200).
    expect((await postSheet(page, JAN, [{ employeeId: HOURLY.id, finalGross: '4000,00', finalNet: '3200,00' }])).map((r) => r.status)).toEqual(['APPROVED'])
    const id = await createDraft(page, HOURLY.id, FEB)
    await page.goto(`/hr/payroll/${id}`)
    const amounts = page.getByRole('region', { name: 'Kwoty i zatwierdzenie' })
    // 16 approved hours × 50,00 zł; net from January's proportion.
    await expect(amounts.getByLabel('Brutto (ostateczne)')).toHaveValue('800,00')
    await expect(amounts.getByLabel('Netto do wypłaty')).toHaveValue('640,00')
    await expect(page.getByTestId('payroll-detail-calc')).toHaveText('= 16 h × 50,00 zł')
    await expect(amounts.getByText('proporcja z stycznia')).toBeVisible()
    await expect(page.getByTestId('detail-flags')).toContainText('stawka godzinowa — sprawdź kwotę')
    await expect(page.getByTestId('hourly-overtime-info')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Wypłata' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Czas wolny' })).toHaveCount(0)
    // A typed gross wins; the hint says what was calculated.
    await amounts.getByLabel('Brutto (ostateczne)').fill('850,00')
    await expect(page.getByTestId('payroll-detail-calc')).toHaveText('wyliczono 16 h × 50,00 zł = 800,00 zł')
  })

  test('shows the month list number read-only and follows the number typed on the sheet', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginAdmin(page)
    const settlement = await settlementOf(PERSON.id, 2)
    const reference = page.getByRole('textbox', { name: 'Numer listy płac' })
    for (const number of ['LP 02/2026 (test)', 'LP 02/2026 po zmianie (test)']) {
      await page.goto(`/hr/payroll?month=${FEB}`)
      await reference.fill(number)
      await reference.press('Enter')
      await expect(page.getByRole('status').filter({ hasText: /^zapisano/ })).toBeVisible()
      await page.goto(`/hr/payroll/${settlement.id}`)
      await expect(page.getByTestId('payroll-list-reference')).toContainText(number)
      // Read-only here: no field, and the old per-settlement note field is gone.
      await expect(page.getByRole('textbox', { name: /Numer listy płac/ })).toHaveCount(0)
      await expect(page.getByLabel('Numer listy płac / notatka')).toHaveCount(0)
    }
    await page.getByTestId('payroll-list-reference').getByRole('link', { name: 'zmień na arkuszu miesiąca' }).click()
    await expect(page).toHaveURL(new RegExp(`/hr/payroll\\?month=${FEB}$`))
    await expect(reference).toHaveValue('LP 02/2026 po zmianie (test)')
    // Changing the month number created no version.
    expect(await withDb((db) => db.payrollSettlementVersion.count({ where: { settlementId: settlement.id } }))).toBe(2)
  })

  test('fits a 390 px phone without horizontal scroll, folded and unfolded, draft and approved', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await loginAdmin(page)
    const approved = await settlementOf(PERSON.id, 2)
    const draft = await settlementOf(GLOBAL_PERSON.id, 2)
    const overflow = () => page.evaluate(() => {
      const main = document.querySelector('[data-testid="settlement-page"]') as HTMLElement
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth)
    })
    for (const [settlement, label] of [[approved, 'approved'], [draft, 'draft']] as const) {
      await page.goto(`/hr/payroll/${settlement.id}`)
      await expect(page.getByRole('region', { name: 'Kwoty i zatwierdzenie' })).toBeVisible()
      await page.waitForTimeout(700)
      expect(await overflow(), `${label} folded`).toBeLessThanOrEqual(0)
      const save = page.getByRole('region', { name: 'Kwoty i zatwierdzenie' }).getByRole('button', { name: /^Zapisz (i zatwierdź|korektę)$/ })
      await save.scrollIntoViewIfNeeded()
      expect(await actionableUnder(page, fabRect(390, 844)), `${label} save button above the assistant`).not.toContain('button "Zapisz i zatwierdź"')
      for (const fold of ['versions', 'history', 'employer-cost']) {
        const element = page.getByTestId(`fold-${fold}`)
        if ((await element.getAttribute('open')) === null) await element.locator('summary').click()
      }
      expect(await overflow(), `${label} unfolded`).toBeLessThanOrEqual(0)
      await scrollPageTo(page, 'bottom')
      expect(await actionableUnder(page, fabRect(390, 844)), `${label} page end above the assistant`).toEqual([])
      await scrollPageTo(page, 'top')
      await shot(page, `06-${label}-390.png`)
    }
  })
})
