import { describe, expect, it } from 'vitest'
import { buildCalendarEvent } from '@/lib/installations/calendar-event'

function calendarVisitFixture() {
  return {
    id: 'visit-1',
    startsAt: new Date('2026-08-24T08:00:00.000Z'),
    endsAt: new Date('2026-08-24T12:00:00.000Z'),
    orderUrl: 'https://app.walldecor.pl/installations/order-1',
    order: {
      number: 'MON-20260824-0001',
      clientName: 'Jan Kowalski',
      addressStreet: 'Puławska',
      addressBuildingNumber: '17',
      addressApartmentNumber: null,
      addressPostalCode: '02-515',
      addressCity: 'Warszawa',
    },
    scopes: [
      { roomName: 'Salon', name: 'Tapety' },
      { roomName: 'Korytarz', name: 'Sztukateria' },
    ],
    participants: [
      { email: '  ANNA@example.pl ', inviteStatus: 'READY' as const },
      { email: 'anna@example.pl', inviteStatus: 'READY' as const },
      { email: 'bartek@example.pl', inviteStatus: 'READY' as const },
      { email: 'nie-zapraszaj@example.pl', inviteStatus: 'MISSING_EMAIL' as const },
      { email: '   ', inviteStatus: 'READY' as const },
      { email: null, inviteStatus: 'MISSING_EMAIL' as const },
    ],
  }
}

describe('buildCalendarEvent', () => {
  it('projects one safe event with normalized, deduplicated attendees', () => {
    const event = buildCalendarEvent(calendarVisitFixture())

    expect(event).toEqual({
      visitId: 'visit-1',
      summary: 'Montaż MON-20260824-0001 — Jan Kowalski',
      location: 'Puławska 17, 02-515 Warszawa',
      description: [
        'Adres montażu: Puławska 17, 02-515 Warszawa',
        'Zakresy prac: Salon — Tapety; Korytarz — Sztukateria',
        'Karta montażu: https://app.walldecor.pl/installations/order-1',
      ].join('\n'),
      start: { dateTime: '2026-08-24T08:00:00.000Z', timeZone: 'Europe/Warsaw' },
      end: { dateTime: '2026-08-24T12:00:00.000Z', timeZone: 'Europe/Warsaw' },
      attendeeEmails: ['anna@example.pl', 'bartek@example.pl'],
      privateProperties: { wallDecorVisitId: 'visit-1' },
    })
  })

  it('formats an apartment address without leaking empty address fragments', () => {
    const event = buildCalendarEvent({
      ...calendarVisitFixture(),
      order: {
        ...calendarVisitFixture().order,
        addressBuildingNumber: '17',
        addressApartmentNumber: '4',
      },
    })

    expect(event.location).toBe('Puławska 17/4, 02-515 Warszawa')
  })

  it('does not project client answers, amounts, or private visit notes', () => {
    const unsafeVisit = {
      ...calendarVisitFixture(),
      note: 'Prywatna notatka organizacyjna',
      order: {
        ...calendarVisitFixture().order,
        grossAmount: '12 500 PLN',
        clientFormAnswers: { drzwi_ukryte: 'tak', odpowiedzi: ['wrażliwe dane'] },
      },
    }

    const serialized = JSON.stringify(buildCalendarEvent(unsafeVisit))

    expect(serialized).not.toContain('drzwi_ukryte')
    expect(serialized).not.toContain('odpowiedzi')
    expect(serialized).not.toContain('12 500')
    expect(serialized).not.toContain('Prywatna notatka')
  })
})
