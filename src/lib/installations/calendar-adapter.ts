import type { CalendarEvent } from './calendar-event'

export type CalendarWriteResult = {
  eventId: string
  htmlLink: string
  etag: string
}

export type CalendarUpsertInput = {
  event: CalendarEvent
  externalId: string | null
  etag: string | null
  forceOverwrite: boolean
}

export type CalendarCancelInput = {
  /** Used by adapters to verify privateProperties.wallDecorVisitId before cancelling. */
  visitId: string
  externalId: string
  etag: string | null
  forceOverwrite: boolean
}

export interface InstallationCalendarAdapter {
  upsert(input: CalendarUpsertInput): Promise<CalendarWriteResult>
  cancel(input: CalendarCancelInput): Promise<void>
}

export class CalendarRetryableError extends Error {
  readonly code: string

  constructor(code: string, message = 'Calendar operation can be retried.') {
    super(message)
    this.name = 'CalendarRetryableError'
    this.code = code
  }
}

export class CalendarConflictError extends Error {
  readonly code = 'ETAG_CONFLICT' as const

  constructor(message = 'Calendar event was changed outside WallDecor.') {
    super(message)
    this.name = 'CalendarConflictError'
  }
}

export class CalendarConfigurationError extends Error {
  readonly code = 'CONFIGURATION_ERROR' as const

  constructor(message = 'Calendar integration is not configured.') {
    super(message)
    this.name = 'CalendarConfigurationError'
  }
}
