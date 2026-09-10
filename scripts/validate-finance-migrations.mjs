import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const directory = mkdtempSync(path.join(tmpdir(), 'wd-finance-migrations-'))
const migrationName = '20260910070000_finance_actuals_cashier'
const migrationRoot = path.resolve('prisma/migrations')
const sql = (database, statement) => execFileSync('sqlite3', ['-bail', database], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const script = (name) => readFileSync(path.join(migrationRoot, name, 'migration.sql'), 'utf8')

try {
  const upgrade = path.join(directory, 'upgrade.sqlite')
  for (const entry of readdirSync(migrationRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name < migrationName).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    sql(upgrade, script(entry.name))
  }
  sql(upgrade, `
    PRAGMA foreign_keys=ON;
    INSERT INTO CostCenter(id,name) VALUES ('PUL','Puławska'),('JAG','Jagiellońska'),('GLOBAL','Global');
    INSERT INTO Revenue(id,year,month,amount,costCenterId,channel) VALUES ('old-actual',2026,8,1234.56,'PUL','SALON');
    INSERT INTO RevenueBudget(id,year,month,amount,costCenterId,channel) VALUES ('old-plan',2026,8,9000,'PUL','SALON');
    INSERT INTO AccountCategory(id,name,"order") VALUES ('test-category','Test',1);
    INSERT INTO SubCategory(id,name,"order",categoryId) VALUES ('test-sub','Test',1,'test-category');
    INSERT INTO ActualEntry(id,year,month,amount,costCenterId,subCategoryId) VALUES ('old-cost',2026,8,234.56,'PUL','test-sub');
  `)
  const ftsBefore = sql(upgrade, "SELECT sql FROM sqlite_master WHERE name='article_fts'")
  const installationBefore = sql(upgrade, "SELECT sql FROM sqlite_master WHERE name='InstallationOrder'")
  sql(upgrade, script(migrationName))
  assert.equal(sql(upgrade, "SELECT amount || '|' || coalesce(asOfDate,'UNKNOWN') FROM Revenue WHERE id='old-actual'"), '1234.56|UNKNOWN')
  assert.equal(sql(upgrade, "SELECT amount FROM RevenueBudget WHERE id='old-plan'"), '9000.0')
  assert.equal(sql(upgrade, "SELECT amount FROM ActualEntry WHERE id='old-cost'"), '234.56')
  assert.equal(sql(upgrade, "SELECT sql FROM sqlite_master WHERE name='article_fts'"), ftsBefore)
  assert.equal(sql(upgrade, "SELECT sql FROM sqlite_master WHERE name='InstallationOrder'"), installationBefore)
  assert.equal(sql(upgrade, 'PRAGMA integrity_check'), 'ok')
  assert.equal(sql(upgrade, 'PRAGMA foreign_key_check'), '')
  assert.equal(sql(upgrade, 'SELECT count(*) FROM SalonCashSettings'), '0')

  // Independent empty database uses the real deploy chain, not db push.
  const clean = path.join(directory, 'clean.sqlite')
  sql(clean, 'VACUUM;')
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `file:${clean}` }, stdio: 'pipe',
  })
  assert.equal(sql(clean, 'PRAGMA integrity_check'), 'ok')
  assert.equal(sql(clean, 'PRAGMA foreign_key_check'), '')
  assert.equal(sql(clean, 'SELECT count(*) FROM CashDailyReport'), '0')
  sql(clean, `INSERT INTO CostCenter(id,name) VALUES ('PUL','Puławska');
    INSERT INTO CashDailyReport(id,costCenterId,businessDate,openingCents,targetFloatCents,createdById,updatedAt)
    VALUES ('one','PUL','2026-09-08',27000,30000,'test',CURRENT_TIMESTAMP);`)
  assert.throws(() => sql(clean, `INSERT INTO CashDailyReport(id,costCenterId,businessDate,openingCents,targetFloatCents,createdById,updatedAt)
    VALUES ('two','PUL','2026-09-09',27000,30000,'test',CURRENT_TIMESTAMP);`), /UNIQUE constraint failed/)
  assert.throws(() => sql(clean, `UPDATE CashDailyReport SET openingCents=-1 WHERE id='one'`), /CHECK constraint failed/)
  console.log('PASS: clean migrate deploy; upgrade preserves actuals/plans/costs/FTS/installation CHECK; unknown dates remain null; no automatic cash activation; integrity/FK checks; one draft and nonnegative cash enforced by SQLite.')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
