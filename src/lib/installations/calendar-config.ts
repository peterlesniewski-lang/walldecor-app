export const INSTALLATION_CALENDAR_ADAPTERS = ['disabled', 'fake', 'google'] as const

export type InstallationCalendarAdapterName = typeof INSTALLATION_CALENDAR_ADAPTERS[number]

export type CalendarReadiness = {
  enabled: boolean
  adapter: InstallationCalendarAdapterName
  credentialsConfigured: boolean
  calendarConfigured: boolean
  impersonationConfigured: boolean
  ready: boolean
}

export type GoogleServiceAccountCredentials = {
  type: 'service_account'
  client_email: string
  private_key: string
}

export type GoogleCalendarConfiguration = {
  calendarId: string
  impersonatedUser: string
  credentials: GoogleServiceAccountCredentials
}

/** Public shape only. Credential parsing lives in calendar-server-config.ts. */
export type CalendarEnvironment = Record<string, string | undefined>
