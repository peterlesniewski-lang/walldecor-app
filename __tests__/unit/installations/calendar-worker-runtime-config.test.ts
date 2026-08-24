import { describe, expect, it } from 'vitest'
import { CalendarConfigurationError } from '@/lib/installations/calendar-adapter'
import { createInstallationCalendarAdapter } from '@/lib/installations/calendar-adapter-factory'
import * as calendarServerConfig from '@/lib/installations/calendar-server-config'
import { FakeInstallationCalendarAdapter } from '@/lib/installations/fake-calendar-adapter'

type CalendarRuntimeReader = (env: Record<string, string | undefined>) => {
  adapter: 'fake' | 'google'
  batchSize: number
}

describe('installation Calendar worker runtime configuration', () => {
  it('requires an enabled non-disabled adapter and bounds the batch before the worker opens Prisma', () => {
    expect(calendarServerConfig).toHaveProperty('readInstallationCalendarConfig')
    const read = (calendarServerConfig as typeof calendarServerConfig & {
      readInstallationCalendarConfig: CalendarRuntimeReader
    }).readInstallationCalendarConfig

    expect(read({
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'fake',
      INSTALLATION_CALENDAR_WORKER_BATCH_SIZE: '20',
    })).toEqual({ adapter: 'fake', batchSize: 20 })

    expect(() => read({
      INSTALLATION_CALENDAR_ENABLED: 'false',
      INSTALLATION_CALENDAR_ADAPTER: 'fake',
    })).toThrow(CalendarConfigurationError)
    expect(() => read({
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'disabled',
    })).toThrow(CalendarConfigurationError)
    expect(() => read({
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'fake',
      INSTALLATION_CALENDAR_WORKER_BATCH_SIZE: '101',
    })).toThrow(CalendarConfigurationError)
  })

  it('constructs adapters through one guarded factory instead of letting the worker select a class', () => {
    expect(createInstallationCalendarAdapter({
      NODE_ENV: 'test',
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'fake',
    })).toBeInstanceOf(FakeInstallationCalendarAdapter)

    expect(() => createInstallationCalendarAdapter({
      NODE_ENV: 'production',
      INSTALLATION_CALENDAR_ENABLED: 'true',
      INSTALLATION_CALENDAR_ADAPTER: 'fake',
    })).toThrow(CalendarConfigurationError)
    expect(() => createInstallationCalendarAdapter({
      NODE_ENV: 'production',
      INSTALLATION_CALENDAR_ENABLED: 'false',
      INSTALLATION_CALENDAR_ADAPTER: 'google',
    })).toThrow(CalendarConfigurationError)
  })
})
