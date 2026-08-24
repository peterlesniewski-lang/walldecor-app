import { Buffer } from 'node:buffer'
import { CalendarConfigurationError } from './calendar-adapter'
import {
  INSTALLATION_CALENDAR_ADAPTERS,
  type CalendarEnvironment,
  type CalendarReadiness,
  type GoogleCalendarConfiguration,
  type GoogleServiceAccountCredentials,
  type InstallationCalendarAdapterName,
} from './calendar-config'

const DEFAULT_IMPERSONATED_USER = 'info@walldecor.pl'

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function isEmail(value: string | null): value is string {
  return value !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
}

function isCalendarId(value: string | null): value is string {
  return value === 'primary' || isEmail(value)
}

function adapterFromEnvironment(env: CalendarEnvironment): InstallationCalendarAdapterName {
  const candidate = nonEmpty(env.INSTALLATION_CALENDAR_ADAPTER) ?? 'disabled'
  return (INSTALLATION_CALENDAR_ADAPTERS as readonly string[]).includes(candidate)
    ? candidate as InstallationCalendarAdapterName
    : 'disabled'
}

function rawAdapterIsValid(env: CalendarEnvironment): boolean {
  const candidate = nonEmpty(env.INSTALLATION_CALENDAR_ADAPTER) ?? 'disabled'
  return (INSTALLATION_CALENDAR_ADAPTERS as readonly string[]).includes(candidate)
}

function decodeCredentials(value: string | undefined): GoogleServiceAccountCredentials | null {
  const encoded = nonEmpty(value)
  if (!encoded) return null

  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const clientEmail = typeof record.client_email === 'string' ? record.client_email.trim() : ''
    const privateKey = typeof record.private_key === 'string' ? record.private_key.trim() : ''
    if (record.type !== 'service_account' || !isEmail(clientEmail) || !privateKey.includes('BEGIN PRIVATE KEY')) return null
    return { type: 'service_account', client_email: clientEmail, private_key: privateKey }
  } catch {
    return null
  }
}

function rawCalendarConfiguration(env: CalendarEnvironment): {
  enabled: boolean
  adapter: InstallationCalendarAdapterName
  adapterValid: boolean
  calendarId: string | null
  impersonatedUser: string | null
  credentials: GoogleServiceAccountCredentials | null
} {
  const calendarCandidate = nonEmpty(env.GOOGLE_CALENDAR_ID)
  const impersonatedCandidate = nonEmpty(env.GOOGLE_CALENDAR_IMPERSONATED_USER) ?? DEFAULT_IMPERSONATED_USER
  return {
    enabled: env.INSTALLATION_CALENDAR_ENABLED === 'true',
    adapter: adapterFromEnvironment(env),
    adapterValid: rawAdapterIsValid(env),
    calendarId: isCalendarId(calendarCandidate) ? calendarCandidate : null,
    impersonatedUser: isEmail(impersonatedCandidate) ? impersonatedCandidate : null,
    credentials: decodeCredentials(env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON_B64),
  }
}

/** A non-secret projection safe to serialize from the ADMIN-only settings route. */
export function getInstallationCalendarReadiness(env: CalendarEnvironment = process.env): CalendarReadiness {
  const raw = rawCalendarConfiguration(env)
  const credentialsConfigured = raw.credentials !== null
  const calendarConfigured = raw.calendarId !== null
  const impersonationConfigured = raw.impersonatedUser !== null
  return {
    enabled: raw.enabled,
    adapter: raw.adapter,
    credentialsConfigured,
    calendarConfigured,
    impersonationConfigured,
    ready: raw.enabled && raw.adapter === 'google' && credentialsConfigured && calendarConfigured && impersonationConfigured,
  }
}

/** Server/worker-only boundary which is allowed to decode the service-account JSON. */
export function getGoogleCalendarConfiguration(env: CalendarEnvironment = process.env): GoogleCalendarConfiguration {
  const raw = rawCalendarConfiguration(env)
  if (!raw.enabled) throw new CalendarConfigurationError('Google Calendar synchronization is disabled.')
  if (!raw.adapterValid || raw.adapter !== 'google') throw new CalendarConfigurationError('Google Calendar adapter is not selected.')
  if (!raw.calendarId || !raw.impersonatedUser || !raw.credentials) {
    throw new CalendarConfigurationError('Google Calendar configuration is incomplete.')
  }
  return { calendarId: raw.calendarId, impersonatedUser: raw.impersonatedUser, credentials: raw.credentials }
}

/** Rejects fake calendar execution under production before a worker can perform any work. */
export function assertInstallationCalendarAdapterAllowed(env: CalendarEnvironment = process.env): InstallationCalendarAdapterName {
  const raw = rawCalendarConfiguration(env)
  if (!raw.adapterValid) throw new CalendarConfigurationError('Calendar adapter configuration is invalid.')
  if (raw.adapter === 'fake' && env.NODE_ENV === 'production') {
    throw new CalendarConfigurationError('Fake calendar adapter is forbidden in production.')
  }
  return raw.adapter
}
