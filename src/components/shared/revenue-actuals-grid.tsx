'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CHANNEL_LABELS, COST_CENTER_CHANNELS, REVENUE_CHANNELS, RevenueEntrySchema, parseRevenueAmount, revenueWarsawToday, type RevenueChannel } from '@/lib/validations/revenue'
import type { SubiektRevenueCell } from '@/lib/finance/subiekt-revenue'
import styles from './revenue-ui.module.css'

export interface RevenueActualEntry {
  year: number
  month: number
  costCenterId: string
  channel: string
  amount: number
  asOfDate: string | null
}

interface RevenueActualsGridProps {
  initialEntries: RevenueActualEntry[]
  year: number
  costCenterId: string
  editable: boolean
  /** Subiekt snapshot cells for this year (all centers in GLOBAL view); null = integration not configured. */
  subiektCells: SubiektRevenueCell[] | null
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']
const money = (value: number) => value.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })
const displayDate = (value: string) => value.split('-').reverse().join('.')
type EditingCell = { channel: RevenueChannel; month: number }
const CENTS_EPSILON = 0.005
type ApplyTarget = { month: number; channel?: RevenueChannel }
type ApplyResponse = { ok: boolean; error?: string; entries?: Array<{ year: number; month: number; costCenterId: string; channel: string; amount: number; asOfDate: string | null }> }

export function RevenueActualsGrid({ initialEntries, year, costCenterId, editable, subiektCells }: RevenueActualsGridProps) {
  const serverSnapshot = JSON.stringify(initialEntries)
  const [data, setData] = useState(() => ({ serverSnapshot, entries: initialEntries }))
  // Reconcile only a changed server snapshot. An unchanged parent render must
  // preserve confirmed saves; receiving fresh rows must preserve the editor.
  if (data.serverSnapshot !== serverSnapshot) {
    setData({ serverSnapshot, entries: initialEntries })
  }
  const entries = data.entries
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [amount, setAmount] = useState('')
  const [asOfDate, setAsOfDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState('')
  const [applying, setApplying] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const amountId = useId()
  const dateId = useId()
  const subiektIdBase = useId()
  const router = useRouter()
  const isCompany = costCenterId === 'GLOBAL'
  const canEdit = editable && !isCompany
  const channels = isCompany ? [...REVENUE_CHANNELS] : COST_CENTER_CHANNELS[costCenterId] ?? []
  const today = revenueWarsawToday()
  const rows = entries.filter((entry) => entry.year === year && (isCompany || entry.costCenterId === costCenterId))
  const expectedCenters = (channel: RevenueChannel) => (isCompany ? ['JAG', 'PUL'] : [costCenterId])
    .filter((center) => COST_CENTER_CHANNELS[center]?.includes(channel))
  const expectedCount = channels.reduce((sum, channel) => sum + expectedCenters(channel).length, 0)
  const subiektRows = (subiektCells ?? []).filter((cell) => cell.year === year && (isCompany || cell.costCenterId === costCenterId))
  const subiektFor = (month: number, channel: RevenueChannel) => {
    const cells = subiektRows.filter((cell) => cell.month === month && cell.channel === channel)
    if (cells.length === 0) return null
    return {
      gross: Math.round(cells.reduce((sum, cell) => sum + cell.grossAmount, 0) * 100) / 100,
      documents: cells.reduce((sum, cell) => sum + cell.documentCount, 0),
    }
  }
  const canApply = canEdit && subiektCells !== null

  async function applySubiekt(target: ApplyTarget) {
    if (!canApply || applying) return
    const key = `${target.month}:${target.channel ?? '*'}`
    setApplying(key)
    setApplyError(null)
    setSavedMessage('')
    try {
      const response = await fetch('/api/finance/subiekt-revenue/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month: target.month, costCenterId, ...(target.channel ? { channel: target.channel } : {}) }),
      })
      const result = await response.json().catch(() => null) as ApplyResponse | null
      if (!response.ok || !result?.ok || !result.entries) {
        throw new Error(typeof result?.error === 'string' ? result.error : 'Nie udało się zastosować kwoty z Subiekta.')
      }
      const confirmed: RevenueActualEntry[] = result.entries.map((entry) => ({ ...entry, asOfDate: entry.asOfDate ?? null }))
      setData((current) => ({
        ...current,
        entries: [
          ...current.entries.filter((entry) => !confirmed.some((saved) => entry.year === saved.year && entry.month === saved.month && entry.costCenterId === saved.costCenterId && entry.channel === saved.channel)),
          ...confirmed,
        ],
      }))
      setSavedMessage(`Zastosowano z Subiekta (${MONTHS[target.month - 1]}): ${confirmed.map((entry) => `${CHANNEL_LABELS[entry.channel as RevenueChannel] ?? entry.channel} ${money(entry.amount)}`).join(', ')}.`)
    } catch (cause) {
      setApplyError(cause instanceof Error ? cause.message : 'Błąd połączenia. Spróbuj ponownie.')
    } finally {
      setApplying(null)
      // A partial month apply or a late failure may have changed rows on the server: always re-read.
      router.refresh()
    }
  }

  function openEditor(cell: EditingCell, trigger: HTMLButtonElement) {
    if (!canEdit) return
    const existing = rows.find((row) => row.month === cell.month && row.channel === cell.channel)
    setAmount(existing ? String(existing.amount) : '')
    setAsOfDate(existing?.asOfDate ?? '')
    setError(null)
    setSavedMessage('')
    triggerRef.current = trigger
    setEditing(cell)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || saving || !canEdit) return
    if (!amount.trim()) { setError('Wpisz kwotę brutto. Zero wpisz jawnie jako 0.'); return }
    const parsed = RevenueEntrySchema.safeParse({
      year, month: editing.month, costCenterId, channel: editing.channel,
      amount: parseRevenueAmount(amount), asOfDate: asOfDate || null,
    })
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => issue.message).join('. ')); return }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/revenue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Nie udało się zapisać obrotu. Spróbuj ponownie.')
      const saved = RevenueEntrySchema.safeParse(result)
      if (!saved.success) throw new Error('Serwer nie potwierdził zapisu obrotu. Odśwież stronę i sprawdź wpis.')
      const confirmed: RevenueActualEntry = { ...saved.data, asOfDate: saved.data.asOfDate ?? null }
      setData((current) => ({
        ...current,
        entries: [
          ...current.entries.filter((entry) => !(entry.year === confirmed.year && entry.month === confirmed.month && entry.costCenterId === confirmed.costCenterId && entry.channel === confirmed.channel)),
          confirmed,
        ],
      }))
      setSavedMessage(`Zapisano ${MONTHS[confirmed.month - 1]}: ${money(confirmed.amount)}.`)
      setEditing(null)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Błąd połączenia. Spróbuj zapisać ponownie.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.theme}>
      {savedMessage && <p role="status" className={styles.status} data-testid="revenue-saved">{savedMessage}</p>}
      {applyError && <p role="alert" className={styles.error}>{applyError}</p>}
      <div className={styles.tableShell}>
        <table className={styles.table}>
          <caption className="sr-only">Rzeczywiste miesięczne przychody brutto — {year}</caption>
          <thead>
            <tr>
              <th scope="col">Miesiąc</th>
              {channels.map((channel) => <th key={channel} scope="col">{CHANNEL_LABELS[channel]}</th>)}
              <th scope="col">Suma wpisów</th>
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((monthName, index) => {
              const month = index + 1
              const monthRows = rows.filter((row) => row.month === month)
              const isCurrent = today.startsWith(`${year}-${String(month).padStart(2, '0')}-`)
              return (
                <tr key={month} className={isCurrent ? styles.currentRow : undefined}>
                  <th scope="row" className={styles.month}>
                    {monthName}
                    {isCurrent && <span className={styles.cellMeta}>w trakcie</span>}
                  </th>
                  {channels.map((channel) => {
                    const cellRows = monthRows.filter((row) => row.channel === channel)
                    const value = cellRows.reduce((sum, row) => sum + row.amount, 0)
                    const contents = <>
                      <span className={`${styles.amount} ${value < 0 ? styles.negative : ''}`}>
                        {cellRows.length ? money(value) : <span className={styles.missing}>Brak wpisu</span>}
                      </span>
                      {expectedCenters(channel).map((center) => {
                        const record = cellRows.find((row) => row.costCenterId === center)
                        if (!record && !isCompany) return null
                        return <span key={center} className={styles.cellMeta}>
                          {isCompany ? `${center}: ` : ''}{!record ? 'brak wpisu' : record.asOfDate ? `Stan na ${displayDate(record.asOfDate)}` : 'Data stanu niepodana'}
                        </span>
                      })}
                    </>
                    const subiekt = subiektCells === null ? null : subiektFor(month, channel)
                    const entered = cellRows.length ? value : null
                    const difference = subiekt && entered !== null ? Math.round((subiekt.gross - entered) * 100) / 100 : null
                    const applyKey = `${month}:${channel}`
                    const subiektLineId = subiektCells === null ? undefined : `${subiektIdBase}-${month}-${channel}`
                    const subiektLine = subiektCells === null ? null : (
                      <span id={subiektLineId} className={`${styles.cellMeta} ${styles.subiektLine}`} data-testid={`subiekt-${month}-${channel}`}>
                        {subiekt
                          ? <>Subiekt: <span className={styles.subiektAmount}>{money(subiekt.gross)}</span> · dok. {subiekt.documents}
                            {difference !== null && <span className={Math.abs(difference) < CENTS_EPSILON ? styles.diffZero : styles.diffWarn}>
                              {Math.abs(difference) < CENTS_EPSILON ? ' · zgodne' : ` · różnica ${difference > 0 ? '+' : ''}${money(difference)}`}
                            </span>}
                            {difference === null && <span className={styles.diffWarn}> · brak wpisu</span>}
                          </>
                          : <>Subiekt: —</>}
                      </span>
                    )
                    return <td key={channel} className={styles.cell}>
                      {canEdit ? <button
                        type="button" aria-label={`Edytuj ${CHANNEL_LABELS[channel]} — ${monthName} ${year}`}
                        aria-describedby={subiektLineId}
                        onClick={(event) => openEditor({ channel, month }, event.currentTarget)}
                        className={styles.cellButton}
                      >{contents}{subiektLine}</button> : <div className={styles.cellReadOnly}>{contents}{subiektLine}</div>}
                      {canApply && subiekt && (
                        <button
                          type="button" className={styles.applyButton} disabled={applying !== null}
                          aria-label={`Zastosuj kwotę z Subiekta — ${CHANNEL_LABELS[channel]} — ${monthName} ${year}`}
                          data-testid={`subiekt-apply-${month}-${channel}`}
                          onClick={() => applySubiekt({ month, channel })}
                        >{applying === applyKey ? 'Zapisywanie…' : 'Zastosuj'}</button>
                      )}
                    </td>
                  })}
                  <td className={styles.total}>
                    <span className={styles.amount}>{monthRows.length ? money(monthRows.reduce((sum, row) => sum + row.amount, 0)) : '—'}</span>
                    {monthRows.length > 0 && monthRows.length < expectedCount && <span className={styles.cellMeta}>Częściowe dane</span>}
                    {canApply && channels.some((channel) => subiektFor(month, channel)) && (
                      <button
                        type="button" className={styles.applyButton} disabled={applying !== null}
                        aria-label={`Zastosuj wszystkie kwoty z Subiekta — ${monthName} ${year}`}
                        data-testid={`subiekt-apply-month-${month}`}
                        onClick={() => applySubiekt({ month })}
                      >{applying === `${month}:*` ? 'Zapisywanie…' : 'Zastosuj wszystkie w miesiącu'}</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={`${styles.total} ${styles.annualLabel}`}>Suma roku</th>
              {channels.map((channel) => {
                const channelRows = rows.filter((row) => row.channel === channel)
                return <td key={channel} className={styles.total}><span className={styles.amount}>{channelRows.length ? money(channelRows.reduce((sum, row) => sum + row.amount, 0)) : '—'}</span></td>
              })}
              <td className={styles.total}><span className={styles.amount}>{rows.length ? money(rows.reduce((sum, row) => sum + row.amount, 0)) : '—'}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={`${styles.help} ${styles.gridNote}`}>
        Sumy obejmują zapisane wpisy. Brak wpisu nie oznacza zera. Brak daty oznacza, że aktualność kwoty nie została określona.
        {subiektCells !== null && ' Wiersz „Subiekt” to sprzedaż brutto z dokumentów Subiekta GT według daty wystawienia; „Zastosuj” zastępuje wpisaną kwotę kwotą z Subiekta.'}
      </p>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !saving) setEditing(null) }}>
        <DialogContent className={`${styles.theme} ${styles.editor}`} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus() }}>
          <DialogHeader>
            <DialogTitle>Obrót — {editing ? MONTHS[editing.month - 1] : ''} {year}</DialogTitle>
            <DialogDescription>{costCenterId} · {editing ? CHANNEL_LABELS[editing.channel] : ''}. Kwota brutto po korektach, od początku tego miesiąca.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor={amountId} className={styles.fieldLabel}>Kwota brutto narastająco (PLN)</label>
              <Input id={amountId} type="text" inputMode="decimal" autoFocus value={amount} disabled={saving} onChange={(event) => setAmount(event.target.value)}
                className={`${styles.input} ${styles.amountInput}`} />
              <p className={styles.help}>Zapis zastąpi poprzednią kwotę. Korekta może zmniejszyć obrót, również poniżej zera.</p>
            </div>
            <div className={styles.field}>
              <label htmlFor={dateId} className={styles.fieldLabel}>Stan na dzień (opcjonalnie)</label>
              <Input id={dateId} type="date" value={asOfDate} disabled={saving}
                min={editing ? `${year}-${String(editing.month).padStart(2, '0')}-01` : undefined}
                max={editing ? [today, `${year}-${String(editing.month).padStart(2, '0')}-${new Date(Date.UTC(year, editing.month, 0)).getUTCDate()}`].sort()[0] : today}
                onChange={(event) => setAsOfDate(event.target.value)} className={styles.input} />
              <p className={styles.help}>Do którego dnia miesiąca obejmuje obrót? Puste pole pozostawia aktualność nieokreśloną.</p>
            </div>
            {error && <p role="alert" className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <Button type="button" disabled={saving} onClick={() => setEditing(null)} className={styles.button}>Anuluj</Button>
              <Button type="submit" disabled={saving} className={`${styles.button} ${styles.primary}`}>
                {saving ? 'Zapisywanie…' : 'Zapisz obrót'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
