'use client'

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { InvoiceDraftDetail, InvoiceDraftKsefReconciliation } from '@/lib/invoice-import/client-contracts'

export interface InvoiceKsefReconciliationPanelProps {
  draft: Pick<InvoiceDraftDetail, 'id' | 'version' | 'state'>
  reconciliation: InvoiceDraftKsefReconciliation | null
  localCurrency?: string | null
  loading: boolean
  error: string | null
  dirty: boolean
  busy: boolean
  onRetry(): void
  onResolve(reconciliationId: string, action: 'KEEP_LOCAL' | 'APPLY_TO_DRAFT'): Promise<void>
}

type ReconciliationLink = InvoiceDraftKsefReconciliation['links'][number]
type Difference = ReconciliationLink['differences'][number]

const FIELD_LABELS: Record<Difference['field'], string> = {
  documentStatus: 'Status dokumentu KSeF',
  documentType: 'Rodzaj dokumentu',
  supplierName: 'Nazwa dostawcy',
  taxId: 'NIP / identyfikator podatkowy',
  invoiceNumber: 'Numer faktury',
  issueDate: 'Data wystawienia',
  currency: 'Waluta',
  gross: 'Kwota brutto',
  net: 'Kwota netto',
  vat: 'Kwota VAT',
  dueDate: 'Termin płatności',
  bankAccount: 'Rachunek bankowy',
  paymentStatus: 'Status płatności',
  paidAt: 'Data zapłaty',
}

const ENUM_LABELS: Partial<Record<Difference['field'], Record<string, string>>> = {
  documentStatus: {
    ACTIVE: 'Aktywny', CORRECTED: 'Skorygowany', CORRECTION: 'Korekta', CANCELLED: 'Anulowany',
  },
  documentType: {
    INVOICE: 'Faktura', CORRECTION: 'Faktura korygująca', CREDIT_NOTE: 'Nota uznaniowa',
    PROFORMA: 'Pro forma', OTHER: 'Inny dokument',
  },
  paymentStatus: {
    PAID: 'Zapłacona', UNPAID: 'Niezapłacona', PARTIAL: 'Częściowo zapłacona', UNKNOWN: 'Nieustalony',
  },
}

const AMOUNT = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })
const AMOUNT_FIELDS = new Set<Difference['field']>(['gross', 'net', 'vat'])
const DATE_FIELDS = new Set<Difference['field']>(['issueDate', 'dueDate', 'paidAt'])
const IDENTIFIER_FIELDS = new Set<Difference['field']>(['taxId', 'bankAccount', 'invoiceNumber'])
const actionClassName = 'h-auto min-h-10 max-w-full whitespace-normal px-4 py-2 text-center focus-visible:ring-[var(--wd-dark)]/20'

function displayValue(field: Difference['field'], value: Difference['localValue'], currency?: string | null): string {
  if (value == null || value === '') return 'Brak danych'
  if (AMOUNT_FIELDS.has(field) && typeof value === 'number') {
    return `${AMOUNT.format(value)} ${currency?.trim().toUpperCase() || '(brak waluty)'}`
  }
  const text = String(value)
  if (ENUM_LABELS[field]) return ENUM_LABELS[field][text] ?? 'Nieustalony'
  if (DATE_FIELDS.has(field) && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split('-')
    return `${day}.${month}.${year}`
  }
  return text
}

function DifferenceTable({ link, localCurrency, id }: {
  link: ReconciliationLink
  localCurrency?: string | null
  id: string
}) {
  return (
    <table className="w-full table-fixed border-collapse text-left text-sm leading-6">
      <caption className="sr-only">Różnice danych dokumentu KSeF {link.externalId}</caption>
      <thead>
        <tr className="border-b border-[var(--wd-border)]">
          <th id={`${id}-local`} scope="col" className="w-1/2 px-3 py-3 font-semibold text-[var(--wd-dark)]">Dane zapisane</th>
          <th id={`${id}-ksef`} scope="col" className="w-1/2 border-l border-[var(--wd-border)] px-3 py-3 font-semibold text-[var(--wd-dark)]">KSeF</th>
        </tr>
      </thead>
      {link.differences.map((difference) => {
        const fieldId = `${id}-${difference.field}`
        const valueClassName = IDENTIFIER_FIELDS.has(difference.field)
          ? 'break-all font-mono text-xs'
          : 'break-words [overflow-wrap:anywhere] tabular-nums'
        return (
          <tbody key={difference.field} className="border-b border-[var(--wd-border)] last:border-b-0">
            <tr>
              <th id={fieldId} colSpan={2} className="bg-[var(--wd-surface-2)] px-3 py-2 text-xs font-medium text-[var(--wd-text-muted)]">
                {FIELD_LABELS[difference.field]}
              </th>
            </tr>
            <tr className="align-top">
              <td headers={`${fieldId} ${id}-local`} className={`px-3 py-3 ${valueClassName}`}>
                {displayValue(difference.field, difference.localValue, localCurrency)}
              </td>
              <td headers={`${fieldId} ${id}-ksef`} className={`border-l border-[var(--wd-border)] px-3 py-3 ${valueClassName}`}>
                {displayValue(difference.field, difference.ksefValue, link.snapshot.data.currency)}
              </td>
            </tr>
          </tbody>
        )
      })}
    </table>
  )
}

function ReconciliationPanelContent({
  draft, reconciliation, localCurrency, loading, error, dirty, busy, onRetry, onResolve,
}: InvoiceKsefReconciliationPanelProps) {
  const panelId = useId()
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const stale = reconciliation !== null && (
    reconciliation.draftId !== draft.id
    || reconciliation.draftVersion !== draft.version
    || reconciliation.draftState !== draft.state
  )
  const working = busy || pending || loading
  const blocked = working || dirty || stale || Boolean(error) || reconciliation === null

  async function resolve(link: ReconciliationLink, action: 'KEEP_LOCAL' | 'APPLY_TO_DRAFT') {
    if (inFlight.current || blocked || link.snapshot.documentStatus !== 'ACTIVE') return
    if (draft.state === 'ARCHIVED' || (action === 'APPLY_TO_DRAFT' && draft.state !== 'OPEN')) return
    inFlight.current = true
    setPending(true)
    setLocalError(null)
    try {
      await onResolve(link.id, action)
    } catch {
      setLocalError('Nie udało się zapisać wyboru. Ponów sprawdzenie KSeF i spróbuj ponownie.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  function retry() {
    if (inFlight.current || working) return
    setLocalError(null)
    onRetry()
  }

  return (
    <section aria-labelledby={`${panelId}-heading`} className="min-w-0 space-y-4 rounded-lg border border-[var(--wd-border)] bg-[var(--wd-off-white)] p-4 text-[var(--wd-dark)] sm:p-6">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--wd-text-muted)]">Zapis administratora · dokument KSeF</p>
          <h2 id={`${panelId}-heading`} className="mt-1 text-lg font-semibold tracking-tight">Porównanie z KSeF</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--wd-dark)]/70">Wybierz, które dane zachować. Poniżej znajdują się tylko pola, w których wykryto różnice.</p>
        </div>
        <Button type="button" variant="outline" onClick={retry} disabled={working}
          className={`${actionClassName} border-[var(--wd-border)] bg-[var(--wd-off-white)] hover:bg-[var(--wd-surface-2)]`}>
          Ponów sprawdzenie KSeF
        </Button>
      </header>

      {loading && <p role="status" className="text-sm leading-6">Sprawdzanie powiązania i różnic z KSeF…</p>}
      {error && <p role="alert" className="rounded-md border border-[var(--wd-border)] bg-[var(--wd-sand-light)] p-3 text-sm leading-6">{error}</p>}
      {localError && <p role="alert" className="rounded-md border border-[var(--wd-border)] bg-[var(--wd-sand-light)] p-3 text-sm leading-6">{localError}</p>}
      {pending && <p role="status" className="text-sm leading-6">Zapisywanie wyboru…</p>}
      {stale && (
        <p role="status" className="rounded-md bg-[var(--wd-sand-light)] p-3 text-sm leading-6">
          Porównanie dotyczy wcześniejszej wersji lub innego stanu dokumentu. Ponów sprawdzenie KSeF, aby zobaczyć aktualne dane i dostępne działania.
        </p>
      )}
      {dirty && <p className="text-sm leading-6">Zapisz lub odrzuć niezapisane zmiany w edytorze, zanim wybierzesz dane do zachowania.</p>}
      {draft.state === 'APPROVED' && <p className="text-sm leading-6">Aby przyjąć dane KSeF, najpierw wybierz „Cofnij z kosztów”.</p>}
      {draft.state === 'ARCHIVED' && <p className="text-sm leading-6">Przywróć dokument z archiwum, aby wybrać dane do zachowania.</p>}
      {!loading && !error && !stale && reconciliation?.links.length === 0 && <p role="status" className="text-sm leading-6">Brak powiązania z KSeF</p>}
      {!loading && !error && reconciliation === null && <p role="status" className="text-sm leading-6">Porównanie z KSeF nie zostało jeszcze wczytane.</p>}

      {reconciliation?.links.map((link, index) => {
        const linkId = `${panelId}-link-${index}`
        const active = link.snapshot.documentStatus === 'ACTIVE'
        const needsDecision = link.status === 'CONFLICT' || link.differences.length > 0 || !active
        const decisionBlocked = blocked || !active || draft.state === 'ARCHIVED'
        const current = !stale && !loading && !error
        return (
          <section key={link.id} aria-labelledby={`${linkId}-heading`} className="min-w-0 overflow-hidden rounded-md border border-[var(--wd-border)] bg-[var(--wd-off-white)]">
            <header className="min-w-0 space-y-2 border-b border-[var(--wd-border)] p-4">
              <h3 id={`${linkId}-heading`} className="min-w-0 text-sm font-semibold leading-6">
                Dokument KSeF <span className="block break-all font-mono text-xs font-normal">{link.externalId}</span>
              </h3>
              {current && active && (
                <p role="status" className="text-sm font-medium leading-6">
                  {link.status === 'KEPT_LOCAL' ? 'Zachowano dane administratora'
                    : link.status === 'APPLIED_TO_DRAFT' ? 'Dane KSeF przyjęte do szkicu'
                    : link.status === 'MATCHED' ? 'Dane zgodne z KSeF'
                    : 'Dane wymagają Twojego wyboru'}
                </p>
              )}
              {!active && <p className="text-sm leading-6">Ten dokument KSeF wymaga osobnej obsługi. Nie można zatwierdzić go jako zwykłego kosztu.</p>}
            </header>
            {current && link.differences.length > 0 && <DifferenceTable link={link} localCurrency={localCurrency} id={linkId} />}
            {needsDecision && (
              <div className="flex flex-col gap-2 border-t border-[var(--wd-border)] p-4 sm:flex-row sm:flex-wrap">
                <Button type="button" variant="outline" disabled={decisionBlocked}
                  onClick={() => { void resolve(link, 'KEEP_LOCAL') }}
                  className={`${actionClassName} border-[var(--wd-border)] bg-[var(--wd-off-white)] hover:bg-[var(--wd-surface-2)]`}>
                  Zachowaj moje dane
                </Button>
                <Button type="button" disabled={decisionBlocked || draft.state !== 'OPEN'}
                  onClick={() => { void resolve(link, 'APPLY_TO_DRAFT') }}
                  className={`${actionClassName} bg-[var(--wd-sand)] text-[var(--wd-dark)] hover:bg-[var(--wd-sand-light)]`}>
                  Przyjmij dane KSeF do szkicu
                </Button>
              </div>
            )}
          </section>
        )
      })}

      <p className="border-t border-[var(--wd-border)] pt-4 text-xs leading-5 text-[var(--wd-dark)]/70">
        Oryginał i klasyfikacja kosztu pozostają zachowane. Sam wybór nie tworzy kosztu ani przelewu.
      </p>
    </section>
  )
}

export function InvoiceKsefReconciliationPanel(props: InvoiceKsefReconciliationPanelProps) {
  // Reset transient UI state on each document revision; late responses stay with the old instance.
  const { id, version, state } = props.draft
  return <ReconciliationPanelContent key={`${id}:${version}:${state}`} {...props} />
}
