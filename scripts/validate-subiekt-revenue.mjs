// Loop 4 validator (PLAN-WALLDECOR-BRIDGE §4 Loop 4): starts a mock bridge, runs the real refresh and
// "Zastosuj" code paths against a fresh SQLite database built from the migrations, then reads Revenue
// back with the sqlite3 CLI and compares. Exit code 0 only when every check matches.
// Run: node --preserve-symlinks --import tsx scripts/validate-subiekt-revenue.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const { PrismaClient } = await import('../src/generated/prisma/index.js')
const { startSubiektBridgeMock } = await import('../e2e/subiekt-bridge-mock.ts')
const { refreshSubiektRevenue, applySubiektRevenue, applySubiektRevenueMonth, getSubiektRevenueView } = await import('../src/lib/finance/subiekt-revenue.ts')

const failures = []
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (!ok) failures.push(name)
}

const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-validate-subiekt-'))
const databasePath = path.join(directory, 'validate.db')
const databaseUrl = `file:${databasePath}`
const now = new Date('2026-11-02T10:00:00Z')
const token = 'validate-token'

const bridge = await startSubiektBridgeMock({
  token,
  rows: [
    { year: 2026, month: 10, warehouse_symbol: 'PUŁ', warehouse_name: 'Puławska', kind: 'TOWAR', documents: 12, net_total: 8130.08, gross_total: 10000 },
    { year: 2026, month: 10, warehouse_symbol: 'PUŁ', warehouse_name: 'Puławska', kind: 'USLUGA', documents: 2, net_total: 406.5, gross_total: 500 },
    { year: 2026, month: 10, warehouse_symbol: 'MAG', warehouse_name: 'Główny', kind: 'TOWAR', documents: 1, net_total: -81.3, gross_total: -100 },
    { year: 2026, month: 9, warehouse_symbol: 'ZEW', warehouse_name: 'Zewnętrzny', kind: 'TOWAR', documents: 1, net_total: 1, gross_total: 1.23 },
  ],
})
let db
try {
  execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.resolve('prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe', timeout: 120_000,
  })
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  await db.costCenter.createMany({ data: [{ id: 'JAG', name: 'Jagiellońska' }, { id: 'PUL', name: 'Puławska' }] })
  await db.revenue.create({ data: { year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON', amount: 9000, asOfDate: '2026-10-20' } })

  const env = { SUBIEKT_BRIDGE_URL: bridge.url, SUBIEKT_BRIDGE_TOKEN: token, SUBIEKT_BRIDGE_WAREHOUSE_MAP: 'PUŁ:PUL,MAG:JAG,INT:PUL:ECOMMERCE' }
  const refreshed = await refreshSubiektRevenue(db, { env, now })
  check('refresh ok with 4 rows and ZEW unmapped', refreshed.ok && [refreshed.rows, refreshed.unmappedWarehouses], [4, ['ZEW']])
  check('bridge called with bearer token', bridge.calls.at(-1)?.authorization, `Bearer ${token}`)
  const sqlCount = execFileSync('sqlite3', [databasePath, 'SELECT COUNT(*) FROM SubiektRevenueSnapshot;'], { encoding: 'utf8' }).trim()
  check('sqlite3: 4 snapshot rows stored', sqlCount, '4')

  const view = await getSubiektRevenueView(db, 2026, 'PUL', env)
  check('view: PUL cells', view.cells.map((c) => [c.month, c.channel, c.grossAmount]), [[10, 'MONTAZ', 500], [10, 'SALON', 10000]])
  check('view: unmapped ZEW listed', view.unmapped.map((u) => [u.warehouseSymbol, u.grossAmount]), [['ZEW', 1.23]])

  const before = execFileSync('sqlite3', [databasePath, "SELECT amount, asOfDate FROM Revenue WHERE year=2026 AND month=10 AND costCenterId='PUL' AND channel='SALON';"], { encoding: 'utf8' }).trim()
  check('sqlite3: manual value before apply', before, '9000.0|2026-10-20')
  const applied = await applySubiektRevenue(db, { year: 2026, month: 10, costCenterId: 'PUL', channel: 'SALON' }, now)
  check('apply ok', applied.ok, true)
  const after = execFileSync('sqlite3', [databasePath, "SELECT amount, asOfDate FROM Revenue WHERE year=2026 AND month=10 AND costCenterId='PUL' AND channel='SALON';"], { encoding: 'utf8' }).trim()
  check('sqlite3: Revenue replaced by Subiekt amount with last day of month', after, '10000.0|2026-10-31')

  const month = await applySubiektRevenueMonth(db, { year: 2026, month: 10, costCenterId: 'PUL' }, now)
  check('apply month ok (2 channels)', month.ok && month.entries.map((e) => [e.channel, e.amount]), [['MONTAZ', 500], ['SALON', 10000]])
  const rows = execFileSync('sqlite3', [databasePath, "SELECT channel, amount FROM Revenue WHERE year=2026 AND month=10 AND costCenterId='PUL' ORDER BY channel;"], { encoding: 'utf8' }).trim()
  check('sqlite3: both PUL channels written', rows, 'MONTAZ|500.0\nSALON|10000.0')

  const jag = await applySubiektRevenue(db, { year: 2026, month: 10, costCenterId: 'JAG', channel: 'SALON' }, now)
  check('apply negative correction month for JAG', jag.ok && jag.entries[0].amount, -100)
  const ecommerce = await applySubiektRevenue(db, { year: 2026, month: 10, costCenterId: 'PUL', channel: 'ECOMMERCE' }, now)
  check('ECOMMERCE without a forced-map warehouse is refused', ecommerce.ok, false)

  await bridge.close()
  const down = await refreshSubiektRevenue(db, { env, now: new Date('2026-11-03T06:30:00Z') })
  check('bridge down → refresh reports unavailable', down.ok === false && down.kind, 'unavailable')
  const kept = execFileSync('sqlite3', [databasePath, 'SELECT COUNT(*) FROM SubiektRevenueSnapshot;'], { encoding: 'utf8' }).trim()
  check('bridge down → last snapshot kept', kept, '4')
  const status = await getSubiektRevenueView(db, 2026, 'PUL', env)
  check('bridge down → view keeps fetchedAt and exposes the error', [status.fetchedAt, typeof status.lastError], [now.toISOString(), 'string'])
} finally {
  await db?.$disconnect()
  await bridge.close().catch(() => undefined)
  rmSync(directory, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll Subiekt revenue checks passed.')
