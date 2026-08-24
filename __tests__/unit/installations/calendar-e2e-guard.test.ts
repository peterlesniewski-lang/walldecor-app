import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CalendarConfigurationError } from '@/lib/installations/calendar-adapter'
import {
  assertInstallationCalendarAdapterAllowed,
  readInstallationCalendarConfig,
} from '@/lib/installations/calendar-server-config'

function isolatedDatabase() {
  const directory = mkdtempSync('/tmp/walldecor-installations-e2e-')
  return { directory, url: `file:${path.join(directory, 'calendar.db')}` }
}

function fakeEnvironment(databaseUrl: string, overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    INSTALLATION_CALENDAR_ENABLED: 'true',
    INSTALLATION_CALENDAR_ADAPTER: 'fake',
    DATABASE_URL: databaseUrl,
    E2E_DATABASE_URL: databaseUrl,
    ...overrides,
  }
}

describe('installation Calendar fake E2E guard', () => {
  it('allows fake only when the process uses one explicit isolated E2E database', () => {
    const database = isolatedDatabase()
    try {
      expect(readInstallationCalendarConfig(fakeEnvironment(database.url))).toEqual({ adapter: 'fake', batchSize: 20 })
    } finally {
      rmSync(database.directory, { recursive: true, force: true })
    }
  })

  it('rejects fake immediately in production even for a valid private E2E database', () => {
    const database = isolatedDatabase()
    try {
      expect(() => assertInstallationCalendarAdapterAllowed(fakeEnvironment(database.url, { NODE_ENV: 'production' })))
        .toThrow(CalendarConfigurationError)
    } finally {
      rmSync(database.directory, { recursive: true, force: true })
    }
  })

  it('rejects a different E2E database than the process database', () => {
    const database = isolatedDatabase()
    try {
      expect(() => readInstallationCalendarConfig(fakeEnvironment(database.url, {
        E2E_DATABASE_URL: `file:${path.join(database.directory, 'other.db')}`,
      }))).toThrow(CalendarConfigurationError)
    } finally {
      rmSync(database.directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['normal development database', 'file:./dev.db'],
    ['relative database URL', 'file:tmp/walldecor-installations-e2e-relative/calendar.db'],
    ['outside /tmp', 'file:/var/tmp/walldecor-installations-e2e-outside/calendar.db'],
  ])('rejects fake for %s', (_label, databaseUrl) => {
    expect(() => readInstallationCalendarConfig(fakeEnvironment(databaseUrl))).toThrow(CalendarConfigurationError)
  })

  it('rejects SQLite query parameters even for a valid private E2E database', () => {
    const database = isolatedDatabase()
    try {
      const queriedUrl = `${database.url}?cache=shared`
      expect(() => readInstallationCalendarConfig(fakeEnvironment(queriedUrl))).toThrow(CalendarConfigurationError)
    } finally {
      rmSync(database.directory, { recursive: true, force: true })
    }
  })

  it('rejects a database symlink inside an otherwise valid private directory', () => {
    const database = isolatedDatabase()
    const target = path.join(database.directory, 'target.db')
    const link = path.join(database.directory, 'calendar.db')
    writeFileSync(target, '')
    symlinkSync(target, link)

    try {
      const databaseUrl = `file:${link}`
      expect(() => readInstallationCalendarConfig(fakeEnvironment(databaseUrl)))
        .toThrow(CalendarConfigurationError)
    } finally {
      rmSync(database.directory, { recursive: true, force: true })
    }
  })

  it('rejects a symlinked or non-private E2E parent directory', () => {
    const target = isolatedDatabase()
    const symlinkParent = `/tmp/walldecor-installations-e2e-link-${Date.now()}`
    symlinkSync(target.directory, symlinkParent)
    const symlinkUrl = `file:${path.join(symlinkParent, 'calendar.db')}`

    try {
      expect(() => readInstallationCalendarConfig(fakeEnvironment(symlinkUrl))).toThrow(CalendarConfigurationError)
      chmodSync(target.directory, 0o755)
      expect(() => readInstallationCalendarConfig(fakeEnvironment(target.url))).toThrow(CalendarConfigurationError)
    } finally {
      rmSync(symlinkParent, { force: true })
      rmSync(target.directory, { recursive: true, force: true })
    }
  })
})
