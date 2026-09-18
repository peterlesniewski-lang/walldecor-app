'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CashierOperation, CashierOperationKind, CashierPaymentMethod, CashierReport } from '@/lib/cashier/contracts'
import { CashCheck, CashChoice, CashError, CashField, CashNote, type CommandHandler } from './cashier-ui'
import { cashFormat, cashInput, parseCashierMoney } from './money'
import styles from './cashier.module.css'

const kinds = [
  { value: 'SALES_REFUND', label: 'Zwrot sprzedaży' },
  { value: 'DEPOSIT_IN', label: 'Przyjęcie kaucji' },
  { value: 'DEPOSIT_REFUND', label: 'Zwrot kaucji' },
]
const methods = [{ value: 'CASH', label: 'Gotówka' }, { value: 'CARD', label: 'Karta' }]

function OperationForm({ report, existing, busy, onCommand, onDone }: { report: CashierReport; existing?: CashierOperation; busy: boolean; onCommand: CommandHandler; onDone: () => void }) {
  const [kind, setKind] = useState<CashierOperationKind>(existing?.kind ?? 'SALES_REFUND')
  const [method, setMethod] = useState<CashierPaymentMethod>(existing?.method ?? 'CASH')
  const [amount, setAmount] = useState(cashInput(existing?.amountCents ?? null))
  const [reference, setReference] = useState(existing?.reference ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState('')
  return <form className={styles.inset} onSubmit={async (event) => {
    event.preventDefault(); setError('')
    try {
      const amountCents = parseCashierMoney(amount)
      if (amountCents === null || amountCents <= 0) throw new Error('Kwota operacji musi być większa od zera.')
      const common = { costCenterId: report.costCenterId, reportId: report.id, version: report.version, kind, method, amountCents, reference, note }
      if (await onCommand(existing ? { ...common, action: 'updateOperation', operationId: existing.id } : { ...common, action: 'addOperation' })) onDone()
    } catch (error) { setError(error instanceof Error ? error.message : 'Nieprawidłowa operacja.') }
  }}>
    <h3>{existing ? 'Edytuj operację' : 'Dodaj operację'}</h3>
    <div className={styles.fields}><CashChoice label="Rodzaj operacji" value={kind} onChange={(value) => setKind(value as CashierOperationKind)} options={kinds} /><CashChoice label="Metoda płatności" value={method} onChange={(value) => setMethod(value as CashierPaymentMethod)} options={methods} /><CashField label="Kwota operacji" value={amount} onChange={setAmount} required /><label className={styles.field}>Dokument / referencja<Input aria-label="Dokument / referencja" value={reference} onChange={(e) => setReference(e.target.value)} required maxLength={200} /></label></div>
    <CashNote label="Notatka do operacji" value={note} onChange={setNote} /><CashError error={error} />
    <div className={styles.actions}><Button disabled={busy} type="submit">{existing ? 'Zapisz operację' : 'Dodaj do raportu'}</Button><Button variant="ghost" type="button" onClick={onDone} disabled={busy}>Anuluj edycję</Button></div>
  </form>
}

export function CashierReportEditor({ report, isAdmin, busy: saving, blocked = false, onCommand, onDirtyChange }: { report: CashierReport; isAdmin: boolean; busy: boolean; blocked?: boolean; onCommand: CommandHandler; onDirtyChange?: (dirty: boolean) => void }) {
  const busy = saving || blocked
  const [cash, setCash] = useState(cashInput(report.cashReceiptsCents))
  const [card, setCard] = useState(cashInput(report.cardReceiptsCents))
  const [counted, setCounted] = useState(cashInput(report.countedCents))
  const [note, setNote] = useState(report.note ?? '')
  const [reason, setReason] = useState('')
  const [retainedConfirmed, setRetainedConfirmed] = useState(false)
  const [depositConfirmed, setDepositConfirmed] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [operation, setOperation] = useState<CashierOperation | 'new' | null>(null)
  const [cancelling, setCancelling] = useState<CashierOperation | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [error, setError] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    setCash(cashInput(report.cashReceiptsCents)); setCard(cashInput(report.cardReceiptsCents)); setCounted(cashInput(report.countedCents)); setNote(report.note ?? '')
    setRetainedConfirmed(false); setDepositConfirmed(false); setReason(''); setRequestId(crypto.randomUUID()); setCorrecting(false)
    setOperation(null); setCancelling(null); setCancelReason(''); setError('')
    // A fresh server version invalidates physical confirmation, even if the amounts match.
  }, [report.id, report.version, report.cashReceiptsCents, report.cardReceiptsCents, report.countedCents, report.note])
  const draft = report.status === 'DRAFT'
  const editable = draft || correcting
  const dirty = cash !== cashInput(report.cashReceiptsCents) || card !== cashInput(report.cardReceiptsCents) || counted !== cashInput(report.countedCents) || note !== (report.note ?? '')
  useEffect(() => { onDirtyChange?.(dirty || operation !== null || cancelling !== null || correcting) }, [dirty, operation, cancelling, correcting, onDirtyChange])
  const requiresReason = (report.differenceCents !== null && report.differenceCents !== 0) || (report.shortfallCents ?? 0) > 0
  const canClose = draft && !dirty && !operation && !cancelling && report.cashReceiptsCents !== null && report.cardReceiptsCents !== null && report.countedCents !== null && retainedConfirmed && depositConfirmed && (!requiresReason || reason.trim().length >= 3)
  let correctionCount: number | null = null
  try { correctionCount = parseCashierMoney(counted) } catch { /* invalid input is explained on save */ }
  const retained = correcting && correctionCount !== null ? Math.min(correctionCount, report.targetFloatCents) : report.retainedCents
  const deposit = correcting && correctionCount !== null ? Math.max(correctionCount - report.targetFloatCents, 0) : report.depositCents
  const edit = (setter: (value: string) => void) => (value: string) => { setter(value); setRetainedConfirmed(false); setDepositConfirmed(false) }
  const cancelCorrection = () => {
    setCash(cashInput(report.cashReceiptsCents)); setCard(cashInput(report.cardReceiptsCents)); setCounted(cashInput(report.countedCents)); setNote(report.note ?? '')
    setRetainedConfirmed(false); setDepositConfirmed(false); setReason(''); setCorrecting(false); setError('')
  }
  const activeOperations = report.operations.filter((row) => !row.cancelledAt)
  const cardNet = report.cardReceiptsCents === null ? null : report.cardReceiptsCents + activeOperations.filter((row) => row.method === 'CARD').reduce((sum, row) => sum + (row.kind === 'DEPOSIT_IN' ? row.amountCents : -row.amountCents), 0)

  return <section className={styles.sheet} aria-label={`Rozliczenie ${report.businessDate}`}>
    <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>Arkusz dzienny · {report.costCenterId} · wersja {report.version}</p><h2>{report.businessDate}</h2></div><span className={styles.badge}>{draft ? 'Otwarty' : 'Zamknięty'}</span></header>
    <div className={styles.opening}><span>Gotówka na otwarcie<strong>{cashFormat(report.openingCents)}</strong></span><span>Docelowa kasa stała<strong>{cashFormat(report.targetFloatCents)}</strong></span></div>
    <p className={styles.help}>Wpływy ze sprzedaży przed poniższymi zwrotami, bez kaucji. To rozliczenie gotówki i kart — nie dodatkowy przychód miesięczny.</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setError('')
      try {
        const cashReceiptsCents = parseCashierMoney(cash), cardReceiptsCents = parseCashierMoney(card), countedCents = parseCashierMoney(counted)
        if (correcting) {
          if (cashReceiptsCents === null || cardReceiptsCents === null || countedCents === null) throw new Error('Uzupełnij wszystkie trzy kwoty korekty.')
          if (!retainedConfirmed || !depositConfirmed) throw new Error('Potwierdź gotówkę pozostawioną i depozyt po korekcie.')
          await onCommand({ action: 'correctReport', costCenterId: report.costCenterId, reportId: report.id, version: report.version, cashReceiptsCents, cardReceiptsCents, countedCents, reason, retainedConfirmed: true, depositConfirmed: true })
        } else await onCommand({ action: 'updateReport', costCenterId: report.costCenterId, reportId: report.id, version: report.version, cashReceiptsCents, cardReceiptsCents, countedCents, note })
      } catch (error) { setError(error instanceof Error ? error.message : 'Sprawdź kwoty.') }
    }}>
      <div className={styles.fields}><CashField label="Wpływy sprzedażowe — gotówka" value={cash} onChange={edit(setCash)} disabled={!editable || busy || Boolean(operation || cancelling)} /><CashField label="Wpływy sprzedażowe — karta" value={card} onChange={edit(setCard)} disabled={!editable || busy || Boolean(operation || cancelling)} /><CashField label="Policzona gotówka" value={counted} onChange={edit(setCounted)} disabled={!editable || busy || Boolean(operation || cancelling)} /></div>
      {draft && <CashNote label="Notatka do dnia" value={note} onChange={edit(setNote)} disabled={busy || Boolean(operation || cancelling)} />}
      {draft && <div className={styles.actions}><Button type="submit" disabled={!dirty || busy}>{saving ? 'Zapisywanie…' : 'Zapisz kwoty'}</Button>{dirty && <span className={styles.warning}>Niezapisane zmiany — najpierw zapisz kwoty.</span>}</div>}
      {correcting && <div className={styles.inset}><CashNote label="Powód korekty" value={reason} onChange={setReason} required /><CashCheck checked={retainedConfirmed} onChange={setRetainedConfirmed}>Potwierdzam: w kasie zostaje {cashFormat(retained)}</CashCheck><CashCheck checked={depositConfirmed} onChange={setDepositConfirmed}>Potwierdzam: przygotowany depozyt wynosi {cashFormat(deposit)}</CashCheck><div className={styles.actions}><Button type="submit" disabled={busy || !retainedConfirmed || !depositConfirmed || reason.trim().length < 3}>Zapisz korektę</Button><Button type="button" variant="ghost" onClick={cancelCorrection}>Zrezygnuj z korekty</Button></div></div>}
    </form>
    <div className={styles.sectionHeader}><h3>Zwroty i kaucje</h3>{draft && !operation && <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => setOperation('new')}>Dodaj operację</Button>}</div>
    {report.operations.length === 0 ? <p className={styles.help}>Nie zapisano zwrotów ani kaucji.</p> : <ul className={styles.operationList}>{report.operations.map((row) => <li key={row.id} className={row.cancelledAt ? styles.cancelled : undefined}><div><strong>{kinds.find((kind) => kind.value === row.kind)?.label}</strong><p>{row.reference} · {row.method === 'CASH' ? 'gotówka' : 'karta'}{row.cancelledAt ? ' · anulowana' : ''}</p>{row.note && <p>{row.note}</p>}</div><strong className="num">{cashFormat(row.amountCents)}</strong>{draft && !row.cancelledAt && <div className={styles.actions}><Button variant="ghost" size="sm" disabled={busy || dirty} onClick={() => setOperation(row)} aria-label={`Edytuj ${row.reference}`}>Edytuj</Button><Button variant="ghost" size="sm" disabled={busy || dirty} onClick={() => { setCancelling(row); setCancelReason('') }} aria-label={`Anuluj ${row.reference}`}>Anuluj</Button></div>}</li>)}</ul>}
    {operation && <OperationForm key={operation === 'new' ? 'new' : operation.id} report={report} existing={operation === 'new' ? undefined : operation} busy={busy} onCommand={onCommand} onDone={() => setOperation(null)} />}
    {cancelling && <form className={styles.inset} onSubmit={async (event) => { event.preventDefault(); if (await onCommand({ action: 'cancelOperation', costCenterId: report.costCenterId, reportId: report.id, version: report.version, operationId: cancelling.id, reason: cancelReason })) setCancelling(null) }}><h3>Anulowanie {cancelling.reference}</h3><CashNote label="Powód anulowania" value={cancelReason} onChange={setCancelReason} required /><div className={styles.actions}><Button disabled={busy || cancelReason.trim().length < 3}>Potwierdź anulowanie</Button><Button type="button" variant="ghost" onClick={() => setCancelling(null)}>Wróć</Button></div></form>}
    <dl className={styles.reconciliation}><div><dt>Oczekiwana gotówka</dt><dd>{cashFormat(report.expectedCents)}</dd></div><div><dt>Różnica z przeliczenia</dt><dd className={report.differenceCents ? styles.warning : undefined}>{cashFormat(report.differenceCents)}</dd></div><div><dt>Karty po zwrotach i kaucjach</dt><dd>{cashFormat(cardNet)}</dd></div></dl>
    <div className={styles.cashSplit}><div><span>Zostaje w kasie</span><strong>{cashFormat(retained)}</strong></div><div><span>Do depozytu</span><strong>{cashFormat(deposit)}</strong></div></div>
    {(report.shortfallCents ?? 0) > 0 && <p className={styles.warning}>Niedobór do docelowej kasy stałej: {cashFormat(report.shortfallCents)}. Następny dzień zacznie się od faktycznie pozostawionej kwoty.</p>}
    {draft && <div className={styles.closeSection}><CashNote label="Wyjaśnienie różnicy / niedoboru" value={reason} onChange={setReason} required={requiresReason} /><CashCheck checked={retainedConfirmed} onChange={setRetainedConfirmed}>Potwierdzam: w kasie zostaje {cashFormat(report.retainedCents)}</CashCheck><CashCheck checked={depositConfirmed} onChange={setDepositConfirmed}>Potwierdzam: przygotowany depozyt wynosi {cashFormat(report.depositCents)}</CashCheck><Button className={styles.primary} disabled={busy || !canClose} onClick={() => { setError(''); void onCommand({ action: 'closeReport', costCenterId: report.costCenterId, reportId: report.id, version: report.version, requestId, retainedConfirmed: true, depositConfirmed: true, reason }) }}>Zamknij dzień</Button><p className={styles.help}>Zamknięcie zapisuje rozliczenie i depozyt. Odbiór paczki i przeliczenie zawartości administrator potwierdza osobno.</p></div>}
    {!draft && <div className={styles.closeSection}><p className={styles.help}>Zamknięto {report.closedAt ? new Date(report.closedAt).toLocaleString('pl-PL') : ''}. Kasa stała i wynik tego dnia zostały zapisane historycznie.</p>{report.note && <p>{report.note}</p>}{isAdmin && !correcting && (report.canCorrect ? <Button variant="outline" onClick={() => setCorrecting(true)}>Korekta rozliczenia</Button> : <p className={styles.help}>Korekta zablokowana po rozpoczęciu późniejszego dnia lub odbiorze depozytu.</p>)}</div>}
    <CashError error={error} />
  </section>
}
