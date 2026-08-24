import { INSTALLATION_TIMEZONE } from './visit-time'

export type CalendarEventDateTime = {
  dateTime: string
  timeZone: typeof INSTALLATION_TIMEZONE
}

export type CalendarEvent = {
  visitId: string
  summary: string
  location: string
  description: string
  start: CalendarEventDateTime
  end: CalendarEventDateTime
  attendeeEmails: string[]
  privateProperties: {
    wallDecorVisitId: string
  }
}

export type CalendarEventScope = {
  roomName: string
  name: string
}

export type CalendarEventParticipant = {
  email: string | null
  inviteStatus: 'READY' | 'MISSING_EMAIL'
}

/**
 * Deliberately narrow input boundary for Calendar. Client form answers, amounts,
 * and internal visit notes have no place in this type and cannot be projected.
 */
export type CalendarEventProjectionInput = {
  id: string
  startsAt: Date
  endsAt: Date
  orderUrl: string
  order: {
    number: string
    clientName: string
    addressStreet: string
    addressBuildingNumber: string | null
    addressApartmentNumber: string | null
    addressPostalCode: string
    addressCity: string
  }
  scopes: readonly CalendarEventScope[]
  participants: readonly CalendarEventParticipant[]
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function formatLocation(order: CalendarEventProjectionInput['order']): string {
  const street = nonEmpty(order.addressStreet)
  const buildingNumber = nonEmpty(order.addressBuildingNumber)
  const apartmentNumber = nonEmpty(order.addressApartmentNumber)
  const postalCode = nonEmpty(order.addressPostalCode)
  const city = nonEmpty(order.addressCity)

  const streetAddress = street
    ? [street, buildingNumber ? `${buildingNumber}${apartmentNumber ? `/${apartmentNumber}` : ''}` : apartmentNumber ? `lok. ${apartmentNumber}` : null]
      .filter((value): value is string => value !== null)
      .join(' ')
    : [buildingNumber, apartmentNumber ? `lok. ${apartmentNumber}` : null]
      .filter((value): value is string => value !== null)
      .join(' ')
  const postalCity = [postalCode, city].filter((value): value is string => value !== null).join(' ')

  return [streetAddress, postalCity].filter((value) => value.length > 0).join(', ')
}

function formatScope(scope: CalendarEventScope): string {
  const roomName = nonEmpty(scope.roomName)
  const scopeName = nonEmpty(scope.name)

  return roomName && scopeName ? `${roomName} — ${scopeName}` : roomName ?? scopeName ?? 'Zakres bez nazwy'
}

function attendeeEmails(participants: readonly CalendarEventParticipant[]): string[] {
  return [...new Set(participants
    .filter((participant) => participant.inviteStatus !== 'MISSING_EMAIL')
    .map((participant) => nonEmpty(participant.email)?.toLowerCase())
    .filter((email): email is string => email !== undefined && email !== null))]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function toUtcIso(value: Date, field: 'startsAt' | 'endsAt'): string {
  if (Number.isNaN(value.getTime())) throw new TypeError(`Invalid ${field} for Calendar event`)
  return value.toISOString()
}

export function buildCalendarEvent(input: CalendarEventProjectionInput): CalendarEvent {
  const location = formatLocation(input.order)
  const scopeSummary = input.scopes.map(formatScope).join('; ')

  return {
    visitId: input.id,
    summary: `Montaż ${input.order.number} — ${input.order.clientName}`,
    location,
    description: [
      `Adres montażu: ${location}`,
      `Zakresy prac: ${scopeSummary}`,
      `Karta montażu: ${input.orderUrl}`,
    ].join('\n'),
    start: { dateTime: toUtcIso(input.startsAt, 'startsAt'), timeZone: INSTALLATION_TIMEZONE },
    end: { dateTime: toUtcIso(input.endsAt, 'endsAt'), timeZone: INSTALLATION_TIMEZONE },
    attendeeEmails: attendeeEmails(input.participants),
    privateProperties: { wallDecorVisitId: input.id },
  }
}
