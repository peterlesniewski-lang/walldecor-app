import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@/generated/prisma'
import { E2E_SUBIEKT_BRIDGE_PORT, startSubiektBridgeMock, type SubiektBridgeMock } from './subiekt-bridge-mock'

const databaseUrl = process.env.E2E_DATABASE_URL
if (!databaseUrl?.startsWith('file:/tmp/walldecor-installations-e2e-')) {
  throw new Error('E2E przychodów z Subiekta wymaga izolowanego E2E_DATABASE_URL.')
}

// Closed month relative to the frozen fixture: the spec reads the previous Warsaw month at run time.
const now = new Date()
const warsaw = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit' }).formatToParts(now)
const currentYear = Number(warsaw.find((p) => p.type === 'year')?.value)
const currentMonth = Number(warsaw.find((p) => p.type === 'month')?.value)
const previous = currentMonth === 1 ? { year: currentYear - 1, month: 12 } : { year: currentYear, month: currentMonth - 1 }
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']
const SALON_GROSS = 12345.67
const MONTAZ_GROSS = 2300
const JAG_GROSS = 4100.5
const UNMAPPED_GROSS = 77.77

const rows = [
  { year: previous.year, month: previous.month, warehouse_symbol: 'PUŁ', warehouse_name: 'Puławska', kind: 'TOWAR' as const, documents: 14, net_total: 10037.13, gross_total: SALON_GROSS },
  { year: previous.year, month: previous.month, warehouse_symbol: 'PUŁ', warehouse_name: 'Puławska', kind: 'USLUGA' as const, documents: 3, net_total: 1869.92, gross_total: MONTAZ_GROSS },
  { year: previous.year, month: previous.month, warehouse_symbol: 'MAG', warehouse_name: 'Główny', kind: 'TOWAR' as const, documents: 5, net_total: 3333.74, gross_total: JAG_GROSS },
  { year: previous.year, month: previous.month, warehouse_symbol: 'ZEW', warehouse_name: 'Zewnętrzny', kind: 'USLUGA' as const, documents: 1, net_total: 63.23, gross_total: UNMAPPED_GROSS },
]

const evidenceDir = process.env.WALLDECOR_E2E_EVIDENCE_DIR
const screenshot = async (page: Page, name: string) => {
  if (!evidenceDir) return
  mkdirSync(evidenceDir, { recursive: true })
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true })
}
const money = (value: number) => value.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })

let db: PrismaClient
let bridge: SubiektBridgeMock
const createdCenters: string[] = []

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name="username"]', process.env.ADMIN_USERNAME ?? 'admin')
  await page.fill('input[type="password"]', process.env.ADMIN_PASSWORD ?? 'ChangeMe123!')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/(dashboard|finance|change-password)/)
}

test.beforeAll(async () => {
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  for (const center of [{ id: 'JAG', name: 'Jagiellońska' }, { id: 'PUL', name: 'Puławska' }]) {
    if (!await db.costCenter.findUnique({ where: { id: center.id } })) {
      await db.costCenter.create({ data: center })
      createdCenters.push(center.id)
    }
  }
  await db.revenue.deleteMany({ where: { year: previous.year, month: previous.month } })
  await db.subiektRevenueSnapshot.deleteMany()
  await db.appSetting.deleteMany({ where: { key: { startsWith: 'subiekt_bridge.' } } })
  bridge = await startSubiektBridgeMock({ port: E2E_SUBIEKT_BRIDGE_PORT, token: 'e2e-subiekt-bridge-token', rows })
})

test.afterAll(async () => {
  await bridge?.close()
  await db.revenue.deleteMany({ where: { year: previous.year, month: previous.month } })
  await db.subiektRevenueSnapshot.deleteMany()
  if (createdCenters.length) await db.costCenter.deleteMany({ where: { id: { in: createdCenters } } })
  await db.$disconnect()
})

test('admin reads Subiekt sales, applies a cell and a whole month, and the value survives reload and a bridge outage', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 })
  await login(page)

  // Manual entry that differs from Subiekt, so the difference is visible.
  const manual = await page.request.post('/api/revenue', { data: { year: previous.year, month: previous.month, costCenterId: 'PUL', channel: 'SALON', amount: 10000, asOfDate: null } })
  expect(manual.ok()).toBeTruthy()

  await page.goto(`/finance/revenue?year=${previous.year}&costCenterId=PUL`)
  await expect(page.getByTestId('subiekt-status')).toContainText('Brak odczytu z Subiekta')
  const salonCell = page.getByTestId(`subiekt-${previous.month}-SALON`)
  await expect(salonCell).toContainText('Subiekt: —')
  await expect(page.getByTestId(`subiekt-apply-${previous.month}-SALON`)).toHaveCount(0)

  await page.getByTestId('subiekt-refresh').click()
  await expect(page.getByTestId('subiekt-refresh-result')).toContainText('Odczytano 4 wierszy')
  await expect(page.getByTestId('subiekt-status')).toContainText('Ostatni odczyt:')
  await expect(salonCell).toContainText(money(SALON_GROSS))
  await expect(salonCell).toContainText('dok. 14')
  await expect(salonCell).toContainText(`różnica +${money(SALON_GROSS - 10000)}`)
  await expect(page.getByTestId(`subiekt-${previous.month}-MONTAZ`)).toContainText(money(MONTAZ_GROSS))
  await expect(page.getByTestId(`subiekt-${previous.month}-ECOMMERCE`)).toContainText('Subiekt: —')
  await expect(page.getByTestId(`subiekt-apply-${previous.month}-ECOMMERCE`)).toHaveCount(0)
  await expect(page.getByTestId('subiekt-unmapped')).toContainText(`nieprzypisany magazyn ZEW`)
  await expect(page.getByTestId('subiekt-unmapped')).toContainText(money(UNMAPPED_GROSS))
  expect(bridge.calls.some((call) => call.path.startsWith('/api/sales/summary?') && call.authorization === 'Bearer e2e-subiekt-bridge-token')).toBeTruthy()
  await screenshot(page, '01-po-odczycie.png')

  // Apply one cell.
  await page.getByTestId(`subiekt-apply-${previous.month}-SALON`).click()
  await expect(page.getByTestId('revenue-saved')).toContainText(`Zastosowano z Subiekta (${MONTHS[previous.month - 1]})`)
  const row = page.getByRole('row', { name: new RegExp(MONTHS[previous.month - 1], 'i') })
  await expect(row.getByRole('button', { name: new RegExp(`Edytuj Sprzedaż towaru — ${MONTHS[previous.month - 1]}`) })).toContainText(money(SALON_GROSS))
  await expect(salonCell).toContainText('zgodne')
  const stored = await db.revenue.findUnique({ where: { year_month_costCenterId_channel: { year: previous.year, month: previous.month, costCenterId: 'PUL', channel: 'SALON' } } })
  const lastDay = new Date(Date.UTC(previous.year, previous.month, 0)).getUTCDate()
  expect(stored).toMatchObject({ amount: SALON_GROSS, asOfDate: `${previous.year}-${String(previous.month).padStart(2, '0')}-${lastDay}` })
  await screenshot(page, '02-po-zastosuj.png')

  // Reload: the applied amount persists.
  await page.reload()
  await expect(row.getByRole('button', { name: new RegExp(`Edytuj Sprzedaż towaru — ${MONTHS[previous.month - 1]}`) })).toContainText(money(SALON_GROSS))

  // Apply the whole month: MONTAZ gets its Subiekt amount too.
  await page.getByTestId(`subiekt-apply-month-${previous.month}`).click()
  await expect(page.getByTestId('revenue-saved')).toContainText('Montaż')
  const montaz = await db.revenue.findUnique({ where: { year_month_costCenterId_channel: { year: previous.year, month: previous.month, costCenterId: 'PUL', channel: 'MONTAZ' } } })
  expect(montaz?.amount).toBe(MONTAZ_GROSS)

  // Company view shows Subiekt sums read-only (no apply buttons).
  await page.goto(`/finance/revenue?year=${previous.year}&costCenterId=GLOBAL`)
  await expect(page.getByTestId(`subiekt-${previous.month}-SALON`)).toContainText(money(SALON_GROSS + JAG_GROSS))
  await expect(page.locator('[data-testid^="subiekt-apply-"]')).toHaveCount(0)
  await screenshot(page, '03-cala-firma.png')

  // Bridge outage: refresh fails with a Polish message, the last snapshot stays and Zastosuj still works.
  await bridge.close()
  await page.goto(`/finance/revenue?year=${previous.year}&costCenterId=JAG`)
  await page.getByTestId('subiekt-refresh').click()
  const failure = page.getByTestId('subiekt-refresh-result')
  await expect(failure).toContainText('Mostek Subiekt jest niedostępny')
  await expect(failure).not.toContainText('at ')
  await expect(page.getByTestId('subiekt-status')).toContainText('Mostek niedostępny — dane z')
  await expect(page.getByTestId(`subiekt-${previous.month}-SALON`)).toContainText(money(JAG_GROSS))
  await page.getByTestId(`subiekt-apply-${previous.month}-SALON`).click()
  await expect(page.getByTestId('revenue-saved')).toContainText(money(JAG_GROSS))
  const jag = await db.revenue.findUnique({ where: { year_month_costCenterId_channel: { year: previous.year, month: previous.month, costCenterId: 'JAG', channel: 'SALON' } } })
  expect(jag?.amount).toBe(JAG_GROSS)
  await screenshot(page, '04-mostek-niedostepny.png')
})
