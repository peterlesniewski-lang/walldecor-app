import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

it('preserves old clarification history and only relaxes supporting material for RESOLVED', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-resolution-migration-'))
  const database = path.join(directory, 'test.db')
  const execute = (sql: string) => spawnSync('sqlite3', ['-bail', '-json', database], { input: `PRAGMA foreign_keys=ON;\n${sql}`, encoding: 'utf8' })
  try {
    const old = readFileSync('prisma/migrations/20260822030000_installation_client_form/migration.sql', 'utf8')
    const clarificationSchema = old.slice(old.indexOf('CREATE TABLE "InstallationClarification"'), old.indexOf('-- A submitted revision'))
    const setup = execute(`
      CREATE TABLE InstallationOrder (id TEXT PRIMARY KEY);
      CREATE TABLE InstallationFormSubmission (id TEXT PRIMARY KEY);
      INSERT INTO InstallationOrder VALUES ('order');
      INSERT INTO InstallationFormSubmission VALUES ('submission');
      ${clarificationSchema}
      INSERT INTO InstallationClarification (id, orderId, sourceSubmissionId, questionKey, reasonCode, reason, status, resolution, resolutionNote, evidenceReference, resolvedById, resolvedAt, updatedAt)
      VALUES ('open','order','submission','q1','UNKNOWN','Do sprawdzenia','OPEN',NULL,NULL,NULL,NULL,NULL,'2026-09-01'),
             ('resolved','order','submission','q2','UNKNOWN','Do sprawdzenia','RESOLVED','12 cm','Telefon z klientem','rozmowa-1','actor','2026-09-01','2026-09-01'),
             ('waived','order','submission','q3','UNKNOWN','Do sprawdzenia','WAIVED',NULL,'Zakres odwołany',NULL,'actor','2026-09-01','2026-09-01');
    `)
    expect(setup.status, setup.stderr).toBe(0)
    const before = execute('SELECT * FROM InstallationClarification ORDER BY id;').stdout
    const upgrade = execute(readFileSync('prisma/migrations/20260907000000_installation_resolution_optional_note/migration.sql', 'utf8'))
    expect(upgrade.status, upgrade.stderr).toBe(0)
    expect(execute('SELECT * FROM InstallationClarification ORDER BY id;').stdout).toBe(before)
    const resolve = execute("UPDATE InstallationClarification SET status='RESOLVED', resolution='Potwierdzone', resolvedById='actor', resolvedAt='2026-09-07' WHERE id='open';")
    expect(resolve.status, resolve.stderr).toBe(0)
    expect(JSON.parse(execute("SELECT resolutionNote, evidenceReference FROM InstallationClarification WHERE id='open';").stdout)).toEqual([{ resolutionNote: null, evidenceReference: null }])
    for (const update of ["resolution=' '", 'resolvedById=NULL', 'resolvedAt=NULL', "status='WAIVED', resolutionNote=NULL", "status='INVALID'", "orderId='missing'"]) {
      expect(execute(`UPDATE InstallationClarification SET ${update} WHERE id='open';`).status, update).not.toBe(0)
    }
    expect(execute("UPDATE InstallationClarification SET questionKey='q2' WHERE id='open';").status).not.toBe(0)
    expect(execute('PRAGMA foreign_key_check;').stdout).toBe('')
    expect(JSON.parse(execute('PRAGMA integrity_check;').stdout)).toEqual([{ integrity_check: 'ok' }])
    const indexes = JSON.parse(execute("PRAGMA index_list('InstallationClarification');").stdout) as { name: string }[]
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining([
      'InstallationClarification_sourceSubmissionId_questionKey_reasonCode_key',
      'InstallationClarification_orderId_status_isBlocking_idx',
      'InstallationClarification_sourceSubmissionId_idx',
    ]))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
