import type { OutboundEmail } from '@/lib/email/outbound-email'
import { formatWarsawDateTime } from './visit-time'
import type { AcceptanceResult, AcceptanceSnapshot, AcceptanceWorkResult } from './acceptance-protocol'

export type AcceptanceAlertKind = 'ACCEPTED_WITH_REMARKS' | 'REFUSED' | 'UNILATERAL'

export const acceptanceAlertTitles: Record<AcceptanceAlertKind, string> = {
  ACCEPTED_WITH_REMARKS: 'Odbiór prac z uwagami', REFUSED: 'Odmowa odbioru prac', UNILATERAL: 'Protokół jednostronny',
}

const workResultLabels: Record<AcceptanceWorkResult, string> = { DONE: 'Wykonano', PARTIAL: 'Wykonano częściowo', NOT_DONE: 'Nie wykonano' }
const decisionLabels: Record<string, string> = { REFUSED: 'Odmowa odbioru', ACCEPTED_WITH_REMARKS: 'Odbiór z uwagami' }
const unilateralReasonLabels: Record<string, string> = {
  REFUSAL: 'Klient odmówił odbioru', ABSENT: 'Klient był nieobecny', NO_RESPONSE: 'Brak odpowiedzi klienta na miejscu',
}

const nextSteps: Record<AcceptanceAlertKind, string[]> = {
  REFUSED: [
    'Skontaktuj się z klientem i ustal zakres poprawek.',
    'Po poprawkach utwórz nową wersję protokołu na karcie (przycisk „Nowa wersja”) — wymagany nowy podpis wykonawcy i klienta.',
    'Zadanie fakturowania nie powstało.',
  ],
  ACCEPTED_WITH_REMARKS: [
    'Sprawdź uwagi klienta i zdecyduj, czy wymagają poprawek.',
    'Jeśli tak — utwórz nową wersję protokołu po poprawkach (przycisk „Nowa wersja”).',
    'Zadanie „Wystawić fakturę” nie powstaje, dopóki etap nie zostanie odebrany bez uwag.',
  ],
  UNILATERAL: [
    'Skontaktuj się z klientem i ustal termin odbioru lub dalsze kroki.',
    'Pobierz PDF protokołu jednostronnego z karty na wypadek sporu.',
    'Etap pozostaje otwarty do czasu nowego protokołu i odbioru klienta.',
  ],
}

export type AcceptanceAlertEmailInput = {
  kind: AcceptanceAlertKind
  url: string
  snapshot: AcceptanceSnapshot
  results: AcceptanceResult[]
  installerSignedAt: Date | string | null
  clientDecision: string | null
  clientFirstName: string | null
  clientLastName: string | null
  clientRelationship: string | null
  clientNote: string | null
  clientRespondedAt: Date | string | null
  unilateral: { reason: string | null; circumstances: string | null; signedAt: Date | string | null } | null
}

type Section = { heading: string; lines: string[]; bullets?: boolean; note?: string }

function dateTime(value: Date | string | null | undefined) {
  if (!value) return null
  try { return formatWarsawDateTime(value) } catch { return null }
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function sections(input: AcceptanceAlertEmailInput): Section[] {
  const { snapshot } = input
  const result: Section[] = []
  const order: string[] = [`Klient: ${snapshot.clientName}`, `Adres: ${snapshot.address}`]
  const visit = dateTime(snapshot.visitStartsAt)
  if (visit) order.push(`Wizyta: ${visit}`)
  order.push(`Wykonawca: ${snapshot.installerName}`)
  result.push({ heading: 'Zlecenie', lines: order })

  const byScope = new Map(input.results.map((item) => [item.scopeId, item]))
  const signedAt = dateTime(input.installerSignedAt)
  result.push({
    heading: 'Wynik prac',
    lines: snapshot.items.map((item) => {
      const entry = byScope.get(item.scopeId)
      const label = entry ? workResultLabels[entry.result] ?? entry.result : 'Brak oceny'
      const note = entry?.note?.trim()
      return `${item.roomName} · ${item.scopeName}: ${label}${note ? ` (uwaga wykonawcy: ${note})` : ''}`
    }),
    note: signedAt ? `Podpis wykonawcy: ${signedAt}` : undefined,
  })

  if (input.kind !== 'UNILATERAL') {
    const who = [input.clientFirstName, input.clientLastName].filter(Boolean).join(' ').trim() || 'brak danych'
    const relation = input.clientRelationship?.trim()
    const lines = [
      `Decyzja: ${decisionLabels[input.clientDecision ?? input.kind] ?? acceptanceAlertTitles[input.kind]}`,
      `Odpowiedział: ${who}${relation ? ` (${relation})` : ''}`,
    ]
    const when = dateTime(input.clientRespondedAt)
    if (when) lines.push(`Data odpowiedzi: ${when}`)
    lines.push(`${input.kind === 'REFUSED' ? 'Powód odmowy' : 'Uwagi'}: ${input.clientNote?.trim() || 'brak'}`)
    result.push({ heading: 'Odpowiedź klienta', lines })
  } else {
    const unilateral = input.unilateral
    const lines = [`Przyczyna: ${unilateral?.reason ? unilateralReasonLabels[unilateral.reason] ?? unilateral.reason : 'brak danych'}`]
    if (unilateral?.circumstances?.trim()) lines.push(`Okoliczności: ${unilateral.circumstances.trim()}`)
    const when = dateTime(unilateral?.signedAt)
    if (when) lines.push(`Podpisano: ${when}`)
    result.push({
      heading: 'Protokół jednostronny', lines,
      note: 'To zapis wykonawcy. Nie potwierdza odbioru przez klienta; etap pozostaje otwarty.',
    })
  }

  result.push({ heading: 'Co dalej', lines: nextSteps[input.kind], bullets: true })
  return result
}

export function acceptanceAlertEmailContent(input: AcceptanceAlertEmailInput): Pick<OutboundEmail, 'subject' | 'text' | 'html'> {
  const title = acceptanceAlertTitles[input.kind]
  const { orderNumber, workType } = input.snapshot
  const headline = `${orderNumber} · ${workType} — ${title}`
  const blocks = sections(input)

  const text = [
    headline,
    ...blocks.map((block) => [
      block.heading.toUpperCase(),
      ...block.lines.map((line) => (block.bullets ? `- ${line}` : line)),
      ...(block.note ? [block.note] : []),
    ].join('\n')),
    `Otwórz kartę zlecenia: ${input.url}`,
  ].join('\n\n')

  const url = escapeHtml(input.url)
  const html = [
    '<div style="font-family:Georgia,\'Times New Roman\',serif;color:#1c1917;max-width:620px;line-height:1.5">',
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(headline)}</h1>`,
    ...blocks.map((block) => [
      `<h2 style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:20px 0 6px;color:#78350f">${escapeHtml(block.heading)}</h2>`,
      block.bullets
        ? `<ul style="margin:0;padding-left:20px">${block.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
        : `<p style="margin:0">${block.lines.map(escapeHtml).join('<br>')}</p>`,
      ...(block.note ? [`<p style="margin:6px 0 0;font-style:italic">${escapeHtml(block.note)}</p>`] : []),
    ].join('')),
    `<p style="margin:28px 0 8px"><a href="${url}" style="display:inline-block;background:#78350f;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Otwórz kartę zlecenia</a></p>`,
    `<p style="margin:0;font-size:12px;color:#57534e;word-break:break-all"><a href="${url}" style="color:#57534e">${url}</a></p>`,
    '</div>',
  ].join('')

  return { subject: `WallDecor: ${title} · ${orderNumber}`, text, html }
}
