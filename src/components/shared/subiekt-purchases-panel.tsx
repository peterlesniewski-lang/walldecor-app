'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { PurchaseImportResult, ReconciliationResult, SettlementView } from '@/lib/finance/subiekt-purchases'
import styles from './revenue-ui.module.css'
import local from './subiekt-purchases-panel.module.css'

interface SubiektPurchasesPanelProps {
  lastImportAt: string | null
  lastImportMessage: string | null
}

type Reconciliation = Extract<ReconciliationResult, { ok: true }>
type Notice = { tone: 'status' | 'error'; text: string }

const money = (value: number | null) => value === null ? '—' : value.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })
const EMPTY = 'Brak — wszystko zgodne.'

function formatDateTime(iso: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function CopyNumber({ number }: { number: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(number)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button type="button" className={local.copy} onClick={copy} aria-label={`Kopiuj numer ${number}`}>
      <span>{number}</span>
      {copied && <span role="status">Skopiowano</span>}
    </button>
  )
}

function SettlementTable({ rows, mode }: { rows: SettlementView[]; mode: 'settle' | 'paidInSubiekt' }) {
  if (rows.length === 0) return <p className={styles.help}>{EMPTY}</p>
  return (
    <div className={styles.tableShell}>
      <table className={`${styles.table} ${styles.mappingTable}`}>
        <thead>
          <tr>
            <th scope="col">Numer GT</th>
            <th scope="col">Numer obcy</th>
            <th scope="col">Dostawca</th>
            <th scope="col">Pozostało w GT</th>
            <th scope="col">{mode === 'settle' ? 'Zapłacono w aplikacji' : 'Brutto w aplikacji'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.invoiceId}-${row.subiektNumber}`}>
              <td>{mode === 'settle' ? <CopyNumber number={row.subiektNumber} /> : row.subiektNumber}</td>
              <td>{row.originalNumber ?? '—'}</td>
              <td>{row.supplierName ?? '—'}</td>
              <td className={local.num}>{money(row.remaining)}</td>
              <td>
                {mode === 'settle'
                  ? <span className={local.num}>{row.paidAt ?? '—'}</span>
                  : <span className={local.num}>{money(row.appGrossPln)}</span>}
                {row.amountDiffers && <> <span className={`${local.badge} ${local.badgeWarn}`} title={`Subiekt: ${money(row.grossPln)}, aplikacja: ${money(row.appGrossPln)}`}>kwota różni się</span></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Subiekt GT purchase invoices on the KSeF page: import of EU invoices and payment reconciliation. */
export function SubiektPurchasesPanel({ lastImportAt, lastImportMessage }: SubiektPurchasesPanelProps) {
  const router = useRouter()
  const [importing, setImporting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [importNotice, setImportNotice] = useState<Notice | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [result, setResult] = useState<Reconciliation | null>(null)

  const lastImport = formatDateTime(lastImportAt)

  async function runImport() {
    if (importing) return
    setImporting(true)
    setImportNotice(null)
    try {
      const response = await fetch('/api/finance/subiekt-purchases/import', { method: 'POST' })
      const body = await response.json().catch(() => null) as PurchaseImportResult | null
      if (!response.ok || !body?.ok) {
        setImportNotice({ tone: 'error', text: body && !body.ok && typeof body.error === 'string' ? body.error : 'Nie udało się pobrać faktur z Subiekta.' })
      } else {
        setImportNotice({ tone: 'status', text: body.message })
        // The import changed app invoices: an earlier reconciliation list would be stale.
        setResult(null)
        router.refresh()
      }
    } catch {
      setImportNotice({ tone: 'error', text: 'Błąd połączenia z aplikacją. Spróbuj ponownie.' })
    } finally {
      setImporting(false)
    }
  }

  async function check() {
    if (checking) return
    setChecking(true)
    setCheckError(null)
    try {
      const response = await fetch('/api/finance/subiekt-purchases/reconciliation')
      const body = await response.json().catch(() => null) as ReconciliationResult | null
      if (!response.ok || !body?.ok) {
        setResult(null)
        setCheckError(body && !body.ok && typeof body.error === 'string' ? body.error : 'Nie udało się sprawdzić rozliczeń w Subiekcie.')
      } else {
        setResult(body)
      }
    } catch {
      setResult(null)
      setCheckError('Błąd połączenia z aplikacją. Spróbuj ponownie.')
    } finally {
      setChecking(false)
    }
  }

  const checkedAt = result ? formatDateTime(result.checkedAt) : null

  return (
    <section aria-label="Subiekt GT — faktury zakupu" className={`${styles.theme} ${styles.panel}`} data-testid="subiekt-purchases-panel">
      <div>
        <h2 className={styles.strong}>Subiekt GT — faktury zakupu</h2>
        <p className={styles.help} data-testid="subiekt-purchases-status">
          {lastImportAt || lastImportMessage
            ? <>Ostatni import{lastImport ? `: ${lastImport}` : ''}{lastImportMessage ? ` — ${lastImportMessage}` : ''}</>
            : 'Brak importu faktur UE z Subiekta.'}
        </p>
      </div>
      <div className={styles.toolbar}>
        <Button type="button" onClick={runImport} disabled={importing} className={styles.button}>Pobierz faktury UE z Subiekta</Button>
        <Button type="button" onClick={check} disabled={checking} className={styles.button}>Sprawdź rozliczenia</Button>
        {(importing || checking) && <span className={styles.help} role="status">{importing ? 'Pobieranie…' : 'Sprawdzanie…'}</span>}
      </div>
      {importNotice && <p role={importNotice.tone === 'error' ? 'alert' : 'status'} className={styles[importNotice.tone]}>{importNotice.text}</p>}
      {checkError && <p role="alert" className={styles.error}>{checkError}</p>}
      {result && (
        <div className={styles.stack} data-testid="subiekt-reconciliation">
          <p className={styles.help}>Okres: {result.from} – {result.to}{checkedAt ? ` · sprawdzono ${checkedAt}` : ''}</p>
          <div className={styles.compactStack}>
            <h3 className={local.sectionHead}>Do odhaczenia w Subiekcie <span className={local.badge}>{result.settleInSubiekt.length}</span></h3>
            <SettlementTable rows={result.settleInSubiekt} mode="settle" />
          </div>
          <div className={styles.compactStack}>
            <h3 className={local.sectionHead}>Opłacone w Subiekcie, otwarte w aplikacji <span className={local.badge}>{result.paidOnlyInSubiekt.length}</span></h3>
            <SettlementTable rows={result.paidOnlyInSubiekt} mode="paidInSubiekt" />
          </div>
          <div className={styles.compactStack}>
            <h3 className={local.sectionHead}>Opłacone w aplikacji, brak w Subiekcie <span className={local.badge}>{result.paidInAppMissingInSubiekt.length}</span></h3>
            {result.paidInAppMissingInSubiekt.length === 0 ? <p className={styles.help}>{EMPTY}</p> : (
              <div className={styles.tableShell}>
                <table className={`${styles.table} ${styles.mappingTable}`}>
                  <thead>
                    <tr><th scope="col">Numer</th><th scope="col">Dostawca</th><th scope="col">Wystawiono</th><th scope="col">Zapłacono</th></tr>
                  </thead>
                  <tbody>
                    {result.paidInAppMissingInSubiekt.map((row) => (
                      <tr key={row.invoiceId}>
                        <td>{row.invoiceNumber}</td>
                        <td>{row.supplierName}</td>
                        <td className={local.num}>{row.issueDate}</td>
                        <td className={local.num}>{row.paidAt ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.ambiguous.length > 0 && (
              <p className={styles.warning}>
                Niejednoznaczne dopasowania ({result.ambiguous.length}): {result.ambiguous.map((item) => `${item.subiektNumber} (${item.candidates})`).join(', ')} — sprawdź ręcznie.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
