import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarConfigurationError } from '@/lib/installations/calendar-adapter'
import { createInstallationCalendarAdapter } from '@/lib/installations/calendar-adapter-factory'
import * as calendarServerConfig from '@/lib/installations/calendar-server-config'
import { FakeInstallationCalendarAdapter } from '@/lib/installations/fake-calendar-adapter'

type CalendarRuntimeReader = (env: Record<string, string | undefined>) => {
  adapter: 'fake' | 'google'
  batchSize: number
}

const e2eDatabaseUrl = 'file:/tmp/walldecor-installations-e2e-runtime-config.db'

function isolatedFakeEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    INSTALLATION_CALENDAR_ENABLED: 'true',
    INSTALLATION_CALENDAR_ADAPTER: 'fake',
    DATABASE_URL: e2eDatabaseUrl,
    E2E_DATABASE_URL: e2eDatabaseUrl,
    ...overrides,
  }
}

describe('installation Calendar worker runtime configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('requires an enabled non-disabled adapter and bounds the batch before the worker opens Prisma', () => {
    expect(calendarServerConfig).toHaveProperty('readInstallationCalendarConfig')
    const read = (calendarServerConfig as typeof calendarServerConfig & {
      readInstallationCalendarConfig: CalendarRuntimeReader
    }).readInstallationCalendarConfig

    expect(read(isolatedFakeEnvironment({ INSTALLATION_CALENDAR_WORKER_BATCH_SIZE: '20' }))).toEqual({ adapter: 'fake', batchSize: 20 })

    expect(() => read(isolatedFakeEnvironment({ INSTALLATION_CALENDAR_ENABLED: 'false' }))).toThrow(CalendarConfigurationError)
    expect(() => read({
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'disabled',
    })).toThrow(CalendarConfigurationError)
    expect(() => read(isolatedFakeEnvironment({ INSTALLATION_CALENDAR_WORKER_BATCH_SIZE: '101' }))).toThrow(CalendarConfigurationError)
  })

  it('constructs adapters through one guarded factory instead of letting the worker select a class', () => {
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
