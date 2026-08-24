import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarConfigurationError } from '@/lib/installations/calendar-adapter'
import { createInstallationCalendarAdapter } from '@/lib/installations/calendar-adapter-factory'
import * as calendarServerConfig from '@/lib/installations/calendar-server-config'
import { FakeInstallationCalendarAdapter } from '@/lib/installations/fake-calendar-adapter'

type CalendarRuntimeReader = (env: Record<string, string | undefined>) => {
  adapter: 'fake' | 'google'
  batchSize: number
}

const temporaryDirectories: string[] = []

function isolatedDatabaseUrl(): string {
  const directory = mkdtempSync('/tmp/walldecor-installations-e2e-')
  temporaryDirectories.push(directory)
  return `file:${path.join(directory, 'calendar.db')}`
}

function isolatedFakeEnvironment(databaseUrl: string, overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    INSTALLATION_CALENDAR_ENABLED: 'true',
    INSTALLATION_CALENDAR_ADAPTER: 'fake',
    DATABASE_URL: databaseUrl,
    E2E_DATABASE_URL: databaseUrl,
    ...overrides,
  }
}

describe('installation Calendar worker runtime configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('requires an enabled non-disabled adapter and bounds the batch before the worker opens Prisma', () => {
    const e2eDatabaseUrl = isolatedDatabaseUrl()
    expect(calendarServerConfig).toHaveProperty('readInstallationCalendarConfig')
    const read = (calendarServerConfig as typeof calendarServerConfig & {
      readInstallationCalendarConfig: CalendarRuntimeReader
    }).readInstallationCalendarConfig

    expect(read(isolatedFakeEnvironment(e2eDatabaseUrl, { INSTALLATION_CALENDAR_WORKER_BATCH_SIZE: '20' }))).toEqual({ adapter: 'fake', batchSize: 20 })

    expect(() => read(isolatedFakeEnvironment(e2eDatabaseUrl, { INSTALLATION_CALENDAR_ENABLED: 'false' }))).toThrow(CalendarConfigurationError)
    expect(() => read({
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'disabled',
    })).toThrow(CalendarConfigurationError)
    expect(() => read(isolatedFakeEnvironment(e2eDatabaseUrl, { INSTALLATION_CALENDAR_WORKER_BATCH_SIZE: '101' }))).toThrow(CalendarConfigurationError)
  })

  it('refuses the in-memory fake adapter for the scheduled CLI in every environment', () => {
    const e2eDatabaseUrl = isolatedDatabaseUrl()
    expect(calendarServerConfig).toHaveProperty('readInstallationCalendarCliConfig')
    const readCli = (calendarServerConfig as typeof calendarServerConfig & {
      readInstallationCalendarCliConfig: CalendarRuntimeReader
    }).readInstallationCalendarCliConfig

    expect(() => readCli(isolatedFakeEnvironment(e2eDatabaseUrl))).toThrow(CalendarConfigurationError)
  })

  it('exits the CLI with a safe configuration error before claiming any work for fake', () => {
    const e2eDatabaseUrl = isolatedDatabaseUrl()
    const result = spawnSync(process.execPath, [
      '--no-warnings',
      '--preserve-symlinks',
      '--import',
      'tsx',
      'scripts/run-installation-calendar-worker.ts',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...isolatedFakeEnvironment(e2eDatabaseUrl) },
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe('Installation Calendar worker configuration error.')
    expect(`${result.stdout}${result.stderr}`).not.toContain(e2eDatabaseUrl)
  })

  it('constructs adapters through one guarded factory instead of letting the worker select a class', () => {
    const e2eDatabaseUrl = isolatedDatabaseUrl()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('INSTALLATION_CALENDAR_ENABLED', 'true')
    vi.stubEnv('INSTALLATION_CALENDAR_ADAPTER', 'fake')
    vi.stubEnv('DATABASE_URL', e2eDatabaseUrl)
    vi.stubEnv('E2E_DATABASE_URL', e2eDatabaseUrl)
    expect(createInstallationCalendarAdapter()).toBeInstanceOf(FakeInstallationCalendarAdapter)

    vi.stubEnv('NODE_ENV', 'production')
    expect(() => createInstallationCalendarAdapter()).toThrow(CalendarConfigurationError)

    vi.stubEnv('INSTALLATION_CALENDAR_ENABLED', 'false')
    vi.stubEnv('INSTALLATION_CALENDAR_ADAPTER', 'google')
    expect(() => createInstallationCalendarAdapter()).toThrow(CalendarConfigurationError)
  })

  it('uses only the worker process environment for the central adapter factory', () => {
    const e2eDatabaseUrl = isolatedDatabaseUrl()
    vi.stubEnv('INSTALLATION_CALENDAR_ENABLED', 'true')
    vi.stubEnv('INSTALLATION_CALENDAR_ADAPTER', 'fake')
    vi.stubEnv('DATABASE_URL', e2eDatabaseUrl)
    vi.stubEnv('E2E_DATABASE_URL', e2eDatabaseUrl)

    const factory = createInstallationCalendarAdapter as unknown as (ignoredEnvironment?: Record<string, string>) => unknown
    expect(factory({
      INSTALLATION_CALENDAR_ENABLED: 'false',
      INSTALLATION_CALENDAR_ADAPTER: 'disabled',
    })).toBeInstanceOf(FakeInstallationCalendarAdapter)
  })
})
