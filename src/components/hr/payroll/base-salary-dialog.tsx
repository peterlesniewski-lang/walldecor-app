'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatGrosze } from '@/lib/payroll/money'
import { PAYROLL_BASES, PAYROLL_BASIS_LABELS, type PayrollBasis } from '@/lib/payroll/types'
import styles from './payroll.module.css'

type BaseRow = {
  id: string
  amountGrosze: number
  basis: PayrollBasis
  effectiveFrom: string
  note: string | null
  createdAt: string
  revokedAt: string | null
  revokeReason: string | null
}

export function BaseSalaryDialog({
  employee,
  onClose,
  onChanged,
}: {
  employee: { id: string; firstName: string; lastName: string }
  onClose: () => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<BaseRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeReason, setRevokeReason] = useState('')

  const [reloadKey, setReloadKey] = useState(0)
  const load = () => setReloadKey((key) => key + 1)

  useEffect(() => {
    let active = true
    fetch(`/api/hr/payroll/base-salaries?employeeId=${employee.id}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = res.ok ? await res.json() : []
        if (active) setRows(json)
      })
      .catch(() => active && setRows([]))
    return () => { active = false }
  }, [employee.id, reloadKey])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setSaving(true)
    setError(null)
    const res = await fetch('/api/hr/payroll/base-salaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: employee.id,
        effectiveFrom: form.get('effectiveFrom'),
        amount: form.get('amount'),
        basis: form.get('basis'),
        note: form.get('note') || undefined,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error === 'Invalid input' ? 'Sprawdź datę i kwotę (np. 4321,00).' : json.error ?? 'Nie udało się zapisać.')
      return
    }
    formElement.reset()
    load()
    onChanged()
  }

  async function revoke(id: string) {
    setError(null)
    const res = await fetch(`/api/hr/payroll/base-salaries/${id}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: revokeReason }),
    })
    if (!res.ok) {
      setError('Podaj powód cofnięcia (min. 3 znaki).')
      return
    }
    setRevoking(null)
    setRevokeReason('')
    load()
    onChanged()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Podstawa wynagrodzenia — {employee.firstName} {employee.lastName}</DialogTitle>
          <DialogDescription>
            Każda zmiana to nowy wpis z datą obowiązywania. Błędny wpis cofasz z powodem — historia zostaje.
          </DialogDescription>
        </DialogHeader>

        <div className={styles.dialogList} aria-label="Historia podstawy">
          {rows === null && <p className={styles.hint}>Ładowanie…</p>}
          {rows?.length === 0 && <p className={styles.hint}>Brak ustawionej podstawy.</p>}
          {rows?.map((row) => (
            <div key={row.id} className={`${styles.adj} ${row.revokedAt ? styles.adjDeleted : ''}`}>
              <div>
                <div className={styles.num}>{formatGrosze(row.amountGrosze)}</div>
                <div className={styles.sub}>
                  od {row.effectiveFrom} · {PAYROLL_BASIS_LABELS[row.basis]}
                  {row.note ? ` · ${row.note}` : ''}
                  {row.revokedAt ? ` · cofnięta: ${row.revokeReason}` : ''}
                </div>
              </div>
              <span />
              {!row.revokedAt && (revoking === row.id ? (
                <span className={styles.rowActions}>
                  <input
                    aria-label="Powód cofnięcia"
                    placeholder="Powód"
                    value={revokeReason}
                    onChange={(event) => setRevokeReason(event.target.value)}
                    className={styles.num}
                    style={{ width: 130, border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px' }}
                  />
                  <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => revoke(row.id)}>Cofnij</button>
                </span>
              ) : (
                <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={() => setRevoking(row.id)}>Cofnij…</button>
              ))}
            </div>
          ))}
        </div>

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            Obowiązuje od
            <input name="effectiveFrom" type="date" required />
          </label>
          <label className={styles.field}>
            Kwota (PLN)
            <input name="amount" inputMode="decimal" placeholder="0,00" required />
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            Rodzaj
            <select name="basis" defaultValue="MONTHLY_GROSS">
              {PAYROLL_BASES.map((basis) => (
                <option key={basis} value={basis}>{PAYROLL_BASIS_LABELS[basis]}</option>
              ))}
            </select>
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            Notatka (opcjonalnie)
            <input name="note" maxLength={500} />
          </label>
          {error && <p className={`${styles.error} ${styles.full}`} role="alert">{error}</p>}
          <div className={`${styles.full} ${styles.rowActions}`}>
            <button type="button" className={`${styles.btn} ${styles.ghost}`} onClick={onClose}>Zamknij</button>
            <button type="submit" className={styles.btn} disabled={saving}>{saving ? 'Zapisuję…' : 'Dodaj podstawę'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
