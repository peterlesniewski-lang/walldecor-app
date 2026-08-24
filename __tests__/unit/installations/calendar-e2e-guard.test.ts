import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CalendarConfigurationError } from '@/lib/installations/calendar-adapter'
import { readInstallationCalendarConfig } from '@/lib/installations/calendar-server-config'

const isolatedE2eDatabase = 'file:/tmp/walldecor-installations-e2e-calendar-guard.db'

function fakeEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    INSTALLATION_CALENDAR_ENABLED: 'true',
    INSTALLATION_CALENDAR_ADAPTER: 'fake',
    DATABASE_URL: isolatedE2eDatabase,
    E2E_DATABASE_URL: isolatedE2eDatabase,
    ...overrides,
  }
}

describe('installation Calendar fake E2E guard', () => {
  it('allows fake only when the process uses one explicit isolated E2E database', () => {
    expect(readInstallationCalendarConfig(fakeEnvironment())).toEqual({ adapter: 'fake', batchSize: 20 })
  })

  it.each([
    ['normal development database', { DATABASE_URL: 'file:./dev.db', E2E_DATABASE_URL: 'file:./dev.db' }],
    ['different E2E database than the process database', { DATABASE_URL: 'file:/tmp/walldecor-installations-e2e-other.db' }],
    ['relative database URL', { DATABASE_URL: 'file:tmp/walldecor-installations-e2e-relative.db', E2E_DATABASE_URL: 'file:tmp/walldecor-installations-e2e-relative.db' }],
    ['outside /tmp', { DATABASE_URL: 'file:/var/tmp/walldecor-installations-e2e-outside.db', E2E_DATABASE_URL: 'file:/var/tmp/walldecor-installations-e2e-outside.db' }],
    ['a URL query that can redirect SQLite resolution', { DATABASE_URL: `${isolatedE2eDatabase}?cache=shared`, E2E_DATABASE_URL: `${isolatedE2eDatabase}?cache=shared` }],
  ])('rejects fake for %s', (_label, overrides) => {
    expect(() => readInstallationCalendarConfig(fakeEnvironment(overrides))).toThrow(CalendarConfigurationError)
  })

  it('rejects a symlink even when its spelling matches the approved /tmp E2E prefix', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'walldecor-calendar-guard-'))
    const target = path.join(directory, 'target.db')
    const link = `/tmp/walldecor-installations-e2e-calendar-symlink-${Date.now()}.db`
    writeFileSync(target, '')
    symlinkSync(target, link)

    try {
      const databaseUrl = `file:${link}`
      expect(() => readInstallationCalendarConfig(fakeEnvironment({ DATABASE_URL: databaseUrl, E2E_DATABASE_URL: databaseUrl })))
        .toThrow(CalendarConfigurationError)
    } finally {
      rmSync(link, { force: true })
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
