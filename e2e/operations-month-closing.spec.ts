import { expect, test, type Page } from '@playwright/test'
import { PrismaClient } from '../src/generated/prisma'
import { formatClosingPeriod, getPreviousMonthPeriod } from '../src/lib/operations/run-factory'

// Month closing on the isolated Playwright database. Every title below is synthetic test data.

const QA_DATABASE_PREFIX = 'file:/tmp/walldecor-installations-e2e-'
const TEMPLATE_ID = 'e2e-month-closing-template'
const TASKS = ['Raport z kasy testowej', 'Saldo rachunków testowych', 'Rejestr VAT testowy']
const ONE_OFF = 'Faktura od testowego dostawcy'

function assertQaDatabase() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl?.startsWith(QA_DATABASE_PREFIX) || databaseUrl !== process.env.E2E_DATABASE_URL) {
    throw new Error(`Month closing E2E may only mutate the isolated Playwright database; received ${databaseUrl ?? 'none'}`)
  }
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Login').fill(process.env.ADMIN_USERNAME ?? 'admin')
  await page.getByLabel('Hasło').fill(process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
  await page.getByRole('button', { name: 'Zaloguj się' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const rowTitles = (page: Page) => page.getByTestId('run-task-row').locator('span.font-medium')

test.describe('Month closing', () => {
  test.beforeAll(async () => {
    assertQaDatabase()
    const prisma = new PrismaClient()
    try {
      await prisma.operationArea.create({ data: { id: 'e2e-area', name: 'Finanse (test)', slug: 'e2e-finanse' } })
      await prisma.operationModule.create({
        data: { id: 'e2e-module', areaId: 'e2e-area', name: 'Koniec miesiąca (test)', slug: 'e2e-koniec-miesiaca' },
      })
      await prisma.checklistTemplate.create({
        data: {
          id: TEMPLATE_ID,
          moduleId: 'e2e-module',
          name: 'Księgowość testowa',
          items: { create: TASKS.map((title, index) => ({ title, order: index + 1 })) },
        },
      })
    } finally {
      await prisma.$disconnect()
    }
  })

  test.afterAll(async () => {
    const prisma = new PrismaClient()
    try {
      await prisma.checklistRun.deleteMany({ where: { templateId: TEMPLATE_ID } })
      await prisma.checklistTemplate.deleteMany({ where: { id: TEMPLATE_ID } })
      await prisma.operationModule.deleteMany({ where: { id: 'e2e-module' } })
      await prisma.operationArea.deleteMany({ where: { id: 'e2e-area' } })
    } finally {
      await prisma.$disconnect()
    }
  })

  test('owner closes a month and the next month inherits only the recurring tasks', async ({ page }) => {
    test.setTimeout(120_000)
    const previous = getPreviousMonthPeriod()
    const previousLabel = formatClosingPeriod(previous.periodYear, previous.periodMonth)
    const earlier =
      previous.periodMonth === 1
        ? { periodYear: previous.periodYear - 1, periodMonth: 12 }
        : { periodYear: previous.periodYear, periodMonth: previous.periodMonth - 1 }

    await login(page)

    // Navigation: one clear entry, no hub.
    await page.goto('/operations')
    await expect(page).toHaveURL(/\/operations\/runs$/)
    await expect(page.getByRole('heading', { name: 'Zamknięcie miesiąca' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Centrum', exact: true })).toHaveCount(0)

    // The previous month has no run yet: the banner starts it.
    await page.getByRole('button', { name: `Rozpocznij zamknięcie: ${previousLabel}` }).click()
    await expect(page).toHaveURL(/\/operations\/runs\/.+/)
    await expect(rowTitles(page)).toHaveText(TASKS)

    // One click marks a task as done.
    await page.getByRole('checkbox', { name: `Oznacz jako gotowe: ${TASKS[0]}` }).click()
    await expect(page.getByRole('checkbox', { name: `Oznacz jako gotowe: ${TASKS[0]}` })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('1/3')).toBeVisible()

    // Add a one-off task.
    await page.getByRole('button', { name: '+ Dodaj zadanie' }).click()
    await page.getByLabel('Tytuł zadania').fill(ONE_OFF)
    await page.getByRole('switch', { name: 'Powtarzaj co miesiąc' }).click()
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click()
    await expect(rowTitles(page)).toHaveText([...TASKS, ONE_OFF])
    await expect(page.getByText('tylko ten miesiąc').first()).toBeVisible()

    // Reorder with the keyboard sensor: move the last task one position up, then reload to prove it was saved.
    const handle = page.getByRole('button', { name: `Przeciągnij zadanie: ${ONE_OFF}` })
    // dnd-kit announces every step of a keyboard drag in a polite live region; the steps below wait for it.
    const announcement = page.locator('[id^="DndLiveRegion"]')
    await handle.focus()
    await page.keyboard.press('Space')
    await expect(handle).toHaveAttribute('aria-pressed', 'true')
    // Droppable rects are measured after the pick-up, so an early arrow key can be ignored: press until the item
    // is announced over a different row than its own.
    await expect(async () => {
      await page.keyboard.press('ArrowUp')
      await expect(announcement).toHaveText(/Draggable item (\S+) was moved over droppable area (?!\1\.)/, { timeout: 1_000 })
    }).toPass({ timeout: 10_000 })
    const orderSaved = page.waitForResponse(
      (response) => response.url().includes('/items/order') && response.request().method() === 'PUT'
    )
    await page.keyboard.press('Space')
    await expect(rowTitles(page)).toHaveText([TASKS[0], TASKS[1], ONE_OFF, TASKS[2]])
    // Reloading while the request is in flight would abort it, so wait for the server to confirm the new order.
    expect((await orderSaved).status()).toBe(200)
    await page.reload()
    await expect(rowTitles(page)).toHaveText([TASKS[0], TASKS[1], ONE_OFF, TASKS[2]])

    // Closing is never blocked, even with unfinished tasks.
    await page.getByRole('button', { name: 'Zamknij miesiąc' }).click()
    await expect(page.getByText('Zamknięte', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Dodaj zadanie' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Otwórz ponownie' })).toBeVisible()

    // The closed run is listed under "Zamknięte".
    await page.goto('/operations/runs')
    await expect(page.getByRole('heading', { name: 'Zamknięte' })).toBeVisible()

    // Start another month: only recurring tasks come along, with progress reset.
    await page.getByRole('button', { name: '+ Rozpocznij miesiąc' }).click()
    await page.getByLabel('Miesiąc').selectOption({ index: earlier.periodMonth - 1 })
    await page.getByLabel('Rok').fill(String(earlier.periodYear))
    await page
      .getByRole('button', { name: new RegExp(`^Utwórz wykonanie: .* ${earlier.periodYear}$`) })
      .click()
    await expect(page).toHaveURL(/\/operations\/runs\/.+/)
    await expect(rowTitles(page)).toHaveText(TASKS)
    await expect(page.getByRole('checkbox', { name: `Oznacz jako gotowe: ${TASKS[0]}` })).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByText('0/3')).toBeVisible()
  })
})
