import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptanceAlertEmailContent, type AcceptanceAlertEmailInput } from '@/lib/installations/acceptance-alert-email'
import { installationPublicUrl } from '@/lib/installations/public-url'

const orderId = 'order_123'

function baseInput(overrides: Partial<AcceptanceAlertEmailInput> = {}): AcceptanceAlertEmailInput {
  return {
    kind: 'REFUSED',
    url: installationPublicUrl(`/installations/${orderId}#acceptance`),
    snapshot: {
      orderNumber: 'MON-20260915-9217', clientName: 'Anna Nowak', address: 'ul. Długa 5, Kraków', visitId: 'visit_1',
      visitStartsAt: '2026-09-15T08:00:00.000Z', visitEndsAt: '2026-09-15T12:00:00.000Z', workType: 'Tapetowanie', installerName: 'Marek Wykonawca',
      items: [
        { scopeId: 's1', scopeName: 'Tapeta ściana A', roomName: 'Salon', products: [] },
        { scopeId: 's2', scopeName: 'Tapeta ściana B', roomName: 'Sypialnia', products: [] },
      ],
    },
    results: [{ scopeId: 's1', result: 'DONE', note: '' }, { scopeId: 's2', result: 'PARTIAL', note: 'Brak rolki' }],
    installerSignedAt: '2026-09-15T11:50:00.000Z',
    clientDecision: 'REFUSED', clientFirstName: 'Anna', clientLastName: 'Nowak', clientRelationship: 'klient',
    clientNote: 'Widoczne łączenia pasów.', clientRespondedAt: '2026-09-15T12:05:00.000Z', unilateral: null,
    ...overrides,
  }
}

describe('acceptanceAlertEmailContent', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('should describe a refusal with the client reason, item results, next steps and the full card URL', () => {
    const email = acceptanceAlertEmailContent(baseInput())
    expect(email.subject).toBe('WallDecor: Odmowa odbioru prac · MON-20260915-9217')
    expect(email.text).toContain('MON-20260915-9217 · Tapetowanie — Odmowa odbioru prac')
    expect(email.text).toContain('Powód odmowy: Widoczne łączenia pasów.')
    expect(email.text).toContain('Odpowiedział: Anna Nowak (klient)')
    expect(email.text).toContain('Salon · Tapeta ściana A: Wykonano')
    expect(email.text).toContain('Sypialnia · Tapeta ściana B: Wykonano częściowo (uwaga wykonawcy: Brak rolki)')
    expect(email.text).toContain('„Nowa wersja”')
    expect(email.text).toContain('Otwórz kartę zlecenia: https://app.walldecor.pl/installations/order_123#acceptance')
  })

  it('should include an HTML version with a link button and the raw URL', () => {
    const email = acceptanceAlertEmailContent(baseInput({ clientNote: '<b>Źle</b> & krzywo' }))
    expect(email.html).toContain('href="https://app.walldecor.pl/installations/order_123#acceptance"')
    expect(email.html).toContain('>Otwórz kartę zlecenia</a>')
    expect(email.html).toContain('&lt;b&gt;Źle&lt;/b&gt; &amp; krzywo')
  })

  it('should describe acceptance with remarks and use the remarks label', () => {
    const email = acceptanceAlertEmailContent(baseInput({ kind: 'ACCEPTED_WITH_REMARKS', clientDecision: 'ACCEPTED_WITH_REMARKS', clientNote: 'Poprawić narożnik.' }))
    expect(email.subject).toBe('WallDecor: Odbiór prac z uwagami · MON-20260915-9217')
    expect(email.text).toContain('Decyzja: Odbiór z uwagami')
    expect(email.text).toContain('Uwagi: Poprawić narożnik.')
    expect(email.text).toContain('Sprawdź uwagi klienta')
    expect(email.text).toContain('/installations/order_123#acceptance')
  })

  it('should describe a unilateral protocol with the reason mapped to Polish and the circumstances', () => {
    const email = acceptanceAlertEmailContent(baseInput({
      kind: 'UNILATERAL', clientDecision: 'REFUSED',
      unilateral: { reason: 'NO_RESPONSE', circumstances: 'Nikt nie otworzył drzwi mimo telefonu.', signedAt: '2026-09-15T12:30:00.000Z' },
    }))
    expect(email.subject).toContain('MON-20260915-9217')
    expect(email.text).toContain('Przyczyna: Brak odpowiedzi klienta na miejscu')
    expect(email.text).toContain('Okoliczności: Nikt nie otworzył drzwi mimo telefonu.')
    expect(email.text).toContain('To zapis wykonawcy. Nie potwierdza odbioru przez klienta; etap pozostaje otwarty.')
    expect(email.text).not.toContain('Powód odmowy')
  })

  it.each([['REFUSAL', 'Klient odmówił odbioru'], ['ABSENT', 'Klient był nieobecny']])('should map unilateral reason %s', (reason, label) => {
    const email = acceptanceAlertEmailContent(baseInput({ kind: 'UNILATERAL', unilateral: { reason, circumstances: null, signedAt: null } }))
    expect(email.text).toContain(`Przyczyna: ${label}`)
  })
})
