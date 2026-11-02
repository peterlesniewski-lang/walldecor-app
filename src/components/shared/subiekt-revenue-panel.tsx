'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { SubiektRevenueView } from '@/lib/finance/subiekt-revenue'
import styles from './revenue-ui.module.css'

interface SubiektRevenuePanelProps {
  view: SubiektRevenueView
  year: number
  canRefresh: boolean
}

const money = (value: number) => value.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']

export function formatReadAt(iso: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' }).format(date)
}

/** Status of the Subiekt bridge read for the revenue page: last read, errors, unmapped warehouses, manual refresh. */
export function SubiektRevenuePanel({ view, year, canRefresh }: SubiektRevenuePanelProps) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState<{ tone: 'status' | 'error'; text: string } | null>(null)

  if (!view.configured) {
    return <p className={styles.notice} data-testid="subiekt-not-configured">Mostek Subiekt nie jest skonfigurowany.</p>
  }

  const readAt = formatReadAt(view.fetchedAt)
  const errorAt = formatReadAt(view.lastErrorAt)
  const unmappedForYear = view.unmapped.filter((row) => row.year === year)

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    setMessage(null)
    try {
      const response = await fetch('/api/finance/subiekt-revenue/refresh', { method: 'POST' })
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string; rows?: number; unmappedWarehouses?: string[] } | null
      if (!response.ok || !result?.ok) {
        setMessage({ tone: 'error', text: typeof result?.error === 'string' ? result.error : 'Nie udało się odczytać danych z Subiekta.' })
      } else {
        const unmapped = result.unmappedWarehouses?.length ? ` Nieprzypisane magazyny: ${result.unmappedWarehouses.join(', ')}.` : ''
        setMessage({ tone: 'status', text: `Odczytano ${result.rows ?? 0} wierszy z Subiekta.${unmapped}` })
      }
      router.refresh()
    } catch {
      setMessage({ tone: 'error', text: 'Błąd połączenia z aplikacją. Spróbuj ponownie.' })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section aria-label="Dane z Subiekta" className={styles.compactStack} data-testid="subiekt-panel">
      <div className={styles.toolbar}>
        <p className={styles.help} data-testid="subiekt-status">
          <span className={styles.strong}>Subiekt GT</span>
          {' · '}
          {view.lastError
            ? (readAt ? `Mostek niedostępny — dane z ${readAt}` : 'Mostek niedostępny — brak danych z Subiekta')
            : readAt ? `Ostatni odczyt: ${readAt}` : 'Brak odczytu z Subiekta'}
          {view.lastError && errorAt ? ` (błąd ${errorAt}: ${view.lastError})` : view.lastError ? ` (${view.lastError})` : ''}
        </p>
        {canRefresh && (
          <Button type="button" onClick={refresh} disabled={refreshing} className={styles.button} data-testid="subiekt-refresh">
            {refreshing ? 'Odczytywanie…' : 'Odczytaj teraz'}
          </Button>
        )}
      </div>
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={styles[message.tone]} data-testid="subiekt-refresh-result">{message.text}</p>}
      {view.mapProblems.length > 0 && (
        <p role="alert" className={styles.error}>Mapa magazynów (SUBIEKT_BRIDGE_WAREHOUSE_MAP): {view.mapProblems.join('; ')}.</p>
      )}
      {unmappedForYear.length > 0 && (
        <div className={styles.warning} data-testid="subiekt-unmapped">
          <p className={styles.strong}>Kwoty z Subiekta bez przypisania do salonu — poniższe pozycje nie trafiają do żadnej komórki:</p>
          <ul className={styles.resultList}>
            {unmappedForYear.map((row) => (
              <li key={`${row.year}-${row.month}-${row.warehouseSymbol}-${row.kind}`}>
                {row.kind === 'INNE'
                  ? <>nieobsługiwany rodzaj pozycji INNE (magazyn {row.warehouseSymbol}, {MONTHS_SHORT[row.month - 1]} {row.year}): {money(row.grossAmount)} · dokumentów: {row.documentCount}</>
                  : <>nieprzypisany magazyn {row.warehouseSymbol} ({row.kind === 'TOWAR' ? 'towar' : 'usługa'}, {MONTHS_SHORT[row.month - 1]} {row.year}): {money(row.grossAmount)} · dokumentów: {row.documentCount}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
