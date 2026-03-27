'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import {
  Landmark,
  Banknote,
  Euro,
  TrendingUp,
  Settings,
  AlertTriangle,
  ChevronDown,
  Plus,
  X,
} from 'lucide-react'

interface CashAccount {
  id: string
  name: string
  currency: string
  type: string
  balance: number
  order: number
}

interface ReceivableEntry {
  id: string
  clientName?: string | null
  amount: number
  dueDate: Date | string
  status: string
}

interface CashLiabilitySnapshot {
  id: string
  amount: number
  date: Date | string
  notes?: string | null
}

interface Thresholds {
  cashThresholdVeryGood: number
  cashThresholdGood: number
  cashThresholdBad: number
}

interface CashFlowRowProps {
  initialAccounts: CashAccount[]
  receivables: ReceivableEntry[]
  latestLiability: CashLiabilitySnapshot | null
  thresholds: Thresholds
  eurRate: number | null
  eurRateDate: string | null
  isAdmin: boolean
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="data-label mb-2">
      {children}
    </p>
  )
}

interface InlineBalanceInputProps {
  account: CashAccount
  onSave: (accountId: string, newBalance: number) => Promise<void>
}

function InlineBalanceInput({ account, onSave }: InlineBalanceInputProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(account.balance))
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    setEditing(true)
    setValue(String(account.balance))
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleBlur = async () => {
    setEditing(false)
    const parsed = parseFloat(value.replace(',', '.'))
    if (!isNaN(parsed) && parsed !== account.balance) {
      await onSave(account.id, parsed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') inputRef.current?.blur()
    if (e.key === 'Escape') {
      setValue(String(account.balance))
      setEditing(false)
    }
  }

  return (
    <div className="flex items-center justify-between py-1.5 group">
      <span
        className="text-xs truncate max-w-[60%]"
        style={{ color: 'var(--wd-text-muted)' }}
      >
        {account.name}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="w-28 text-right text-xs font-semibold tabular-nums rounded-lg px-2 py-1 outline-none transition-all"
          style={{
            border: '2px solid var(--wd-sand)',
            color: 'var(--wd-dark)',
            background: 'var(--wd-off-white)',
            boxShadow: '0 0 0 3px rgba(228,220,209,0.25)',
          }}
          autoFocus
        />
      ) : (
        <button
          onClick={handleClick}
          className="text-xs font-semibold tabular-nums rounded-md px-2 py-0.5 transition-all duration-150 hover:opacity-70"
          style={{ color: 'var(--wd-dark)' }}
          title="Kliknij, aby edytować saldo"
        >
          {account.balance.toLocaleString('pl-PL')}
        </button>
      )}
    </div>
  )
}

/* ─── Status helpers ──────────────────────────────────────────────────────── */

type StatusKey = 'veryGood' | 'good' | 'medium' | 'bad'

const STATUS_CONFIG: Record<StatusKey, {
  label: string
  badgeClass: string
  barColor: string
}> = {
  veryGood: {
    label: 'Bardzo dobry',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    barColor: '#10b981',
  },
  good: {
    label: 'Dobry',
    badgeClass: 'bg-lime-50 text-lime-700 border-lime-200',
    barColor: '#84cc16',
  },
  medium: {
    label: 'Średni',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    barColor: '#f59e0b',
  },
  bad: {
    label: 'Wymaga uwagi',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
    barColor: '#ef4444',
  },
}

function getStatusKey(netCash: number, thresholds: Thresholds): StatusKey {
  if (netCash >= thresholds.cashThresholdVeryGood) return 'veryGood'
  if (netCash >= thresholds.cashThresholdGood) return 'good'
  if (netCash >= thresholds.cashThresholdBad) return 'medium'
  return 'bad'
}

/* ─── Shared subcomponents ───────────────────────────────────────────────── */

function AccountList({
  accounts,
  onSave,
  isAdmin,
  onAddAccount,
}: {
  accounts: CashAccount[]
  onSave: (id: string, balance: number) => Promise<void>
  isAdmin: boolean
  onAddAccount?: () => void
}) {
  return (
    <div
      className="mt-3 pt-3"
      style={{ borderTop: '1px solid var(--wd-border)' }}
      onClick={(e) => e.stopPropagation()}
    >
      {accounts.map((a) => (
        <InlineBalanceInput key={a.id} account={a} onSave={onSave} />
      ))}
      {isAdmin && onAddAccount && (
        <button
          onClick={onAddAccount}
          className="mt-2 w-full flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border border-dashed transition-all duration-150 hover:opacity-70"
          style={{
            borderColor: 'var(--wd-border)',
            color: 'var(--wd-text-muted)',
          }}
        >
          <Plus size={11} />
          Dodaj konto
        </button>
      )}
    </div>
  )
}

/* ─── Modal shared wrapper ───────────────────────────────────────────────── */

function Modal({
  onClose,
  title,
  children,
}: {
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-6 w-full max-w-sm relative"
        style={{
          background: 'var(--wd-white)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 transition-opacity hover:opacity-60"
            style={{ color: 'var(--wd-text-muted)' }}
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--wd-text-muted)' }}>
      {children}
    </label>
  )
}

function ModalInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all ${props.className ?? ''}`}
      style={{
        border: '1.5px solid var(--wd-border)',
        color: 'var(--wd-dark)',
        background: 'var(--wd-off-white)',
        ...props.style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.border = '1.5px solid var(--wd-sand)'
        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(228,220,209,0.35)'
        props.onFocus?.(e)
      }}
      onBlur={(e) => {
        e.currentTarget.style.border = '1.5px solid var(--wd-border)'
        e.currentTarget.style.boxShadow = 'none'
        props.onBlur?.(e)
      }}
    />
  )
}

function ModalSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all ${props.className ?? ''}`}
      style={{
        border: '1.5px solid var(--wd-border)',
        color: 'var(--wd-dark)',
        background: 'var(--wd-off-white)',
        ...props.style,
      }}
    />
  )
}

function ModalActions({
  onCancel,
  onConfirm,
  disabled,
  confirmLabel,
  loadingLabel,
  loading,
}: {
  onCancel: () => void
  onConfirm: () => void
  disabled: boolean
  confirmLabel: string
  loadingLabel: string
  loading: boolean
}) {
  return (
    <div className="flex gap-2 justify-end mt-5">
      <button
        onClick={onCancel}
        className="px-4 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-70"
        style={{ background: 'var(--wd-surface-2)', color: 'var(--wd-dark)' }}
      >
        Anuluj
      </button>
      <button
        onClick={onConfirm}
        disabled={disabled}
        className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
        style={{ background: 'var(--wd-dark)' }}
      >
        {loading ? loadingLabel : confirmLabel}
      </button>
    </div>
  )
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export function CashFlowRow({
  initialAccounts,
  receivables,
  latestLiability,
  thresholds,
  eurRate,
  eurRateDate,
  isAdmin,
}: CashFlowRowProps) {
  const [accounts, setAccounts] = useState<CashAccount[]>(initialAccounts)
  const [openBank, setOpenBank] = useState(false)
  const [openCash, setOpenCash] = useState(false)
  const [openEur, setOpenEur] = useState(false)

  // Liability modal
  const [showLiabilityModal, setShowLiabilityModal] = useState(false)
  const [liabilityAmount, setLiabilityAmount] = useState('')
  const [liabilityNotes, setLiabilityNotes] = useState('')
  const [liabilityLatest, setLiabilityLatest] = useState<CashLiabilitySnapshot | null>(latestLiability)
  const [savingLiability, setSavingLiability] = useState(false)

  // Add account modal
  const [showAddAccountModal, setShowAddAccountModal] = useState(false)
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountType, setNewAccountType] = useState<'bank' | 'cash'>('bank')
  const [newAccountCurrency, setNewAccountCurrency] = useState<'PLN' | 'EUR'>('PLN')
  const [savingAccount, setSavingAccount] = useState(false)

  const plnAccounts = accounts.filter((a) => a.currency === 'PLN')
  const eurAccounts = accounts.filter((a) => a.currency === 'EUR')
  const bankAccounts = plnAccounts.filter((a) => a.type === 'bank')
  const cashAccounts = plnAccounts.filter((a) => a.type === 'cash')

  const bankTotal = bankAccounts.reduce((s, a) => s + a.balance, 0)
  const cashTotal = cashAccounts.reduce((s, a) => s + a.balance, 0)
  const eurTotal = eurAccounts.reduce((s, a) => s + a.balance, 0)

  const totalPLN = plnAccounts.reduce((s, a) => s + a.balance, 0) + eurTotal * (eurRate ?? 0)
  const totalReceivables = receivables.reduce((s, r) => s + r.amount, 0)
  const netCash = totalPLN - (liabilityLatest?.amount ?? 0)

  const statusKey = getStatusKey(netCash, thresholds)
  const status = STATUS_CONFIG[statusKey]
  const pct = Math.min(100, Math.max(0, Math.round((netCash / thresholds.cashThresholdVeryGood) * 100)))

  const updateBalance = async (accountId: string, newBalance: number) => {
    const res = await fetch(`/api/cash/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: newBalance }),
    })
    if (res.ok) {
      setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, balance: newBalance } : a)))
    }
  }

  const handleSaveLiability = async () => {
    const amt = parseFloat(liabilityAmount.replace(',', '.'))
    if (isNaN(amt) || amt < 0) return
    setSavingLiability(true)
    try {
      const res = await fetch('/api/cash/liabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, notes: liabilityNotes || undefined }),
      })
      if (res.ok) {
        const snapshot = (await res.json()) as CashLiabilitySnapshot
        setLiabilityLatest(snapshot)
        setShowLiabilityModal(false)
        setLiabilityAmount('')
        setLiabilityNotes('')
      }
    } finally {
      setSavingLiability(false)
    }
  }

  const handleAddAccount = async () => {
    if (!newAccountName.trim()) return
    setSavingAccount(true)
    try {
      const res = await fetch('/api/cash/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAccountName.trim(), type: newAccountType, currency: newAccountCurrency }),
      })
      if (res.ok) {
        const account = (await res.json()) as CashAccount
        setAccounts((prev) => [...prev, account])
        setShowAddAccountModal(false)
        setNewAccountName('')
        setNewAccountType('bank')
        setNewAccountCurrency('PLN')
      }
    } finally {
      setSavingAccount(false)
    }
  }

  /* ── shared card base style ── */
  const cardBase: React.CSSProperties = {
    background: 'var(--wd-white)',
    border: '1px solid var(--wd-border)',
    boxShadow: 'var(--card-shadow)',
  }

  return (
    <>
      <div
        className="grid gap-3 mt-6"
        style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr' }}
      >

        {/* ── Karta 1 — Stan Kasy (hero card) ─────────────────────────────── */}
        <div
          className="rounded-2xl p-5 flex flex-col justify-between"
          style={{
            background: 'linear-gradient(135deg, var(--wd-dark) 0%, #2a2a2a 100%)',
            boxShadow: '0 4px 24px -4px rgba(30,30,30,0.30)',
          }}
        >
          <div>
            <p className="data-label mb-3" style={{ color: 'rgba(228,220,209,0.70)' }}>
              Stan Kasy
            </p>
            <p
              className="text-3xl font-black tabular-nums tracking-tight leading-none"
              style={{ color: '#F7F6F4', fontFamily: 'var(--font-mono, monospace)' }}
            >
              {totalPLN.toLocaleString('pl-PL')}
              <span className="text-lg font-semibold ml-1.5" style={{ color: 'rgba(247,246,244,0.55)' }}>
                PLN
              </span>
            </p>

            {liabilityLatest && (
              <p className="text-xs mt-2 tabular-nums" style={{ color: 'rgba(247,246,244,0.50)' }}>
                Netto:{' '}
                <span style={{ color: 'rgba(247,246,244,0.80)' }}>
                  {(totalPLN - liabilityLatest.amount).toLocaleString('pl-PL')} PLN
                </span>
              </p>
            )}

            {totalReceivables > 0 && (
              <div
                className="flex items-center gap-1.5 mt-2.5 px-2.5 py-1.5 rounded-lg w-fit"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.25)' }}
              >
                <AlertTriangle size={11} className="text-red-400 shrink-0" />
                <p className="text-xs font-medium text-red-400 tabular-nums">
                  {totalReceivables.toLocaleString('pl-PL')} PLN zaległości
                </p>
              </div>
            )}
          </div>

          {isAdmin && (
            <button
              onClick={() => setShowLiabilityModal(true)}
              className="mt-4 self-start flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-all duration-200 hover:scale-105 active:scale-95"
              style={{
                background: 'rgba(228,220,209,0.15)',
                color: 'var(--wd-sand)',
                border: '1px solid rgba(228,220,209,0.25)',
              }}
            >
              <Plus size={12} />
              Aktualizuj zobowiązania
            </button>
          )}
        </div>

        {/* ── Karta 2 — Konta bankowe PLN ──────────────────────────────────── */}
        <div
          className="rounded-2xl p-5 cursor-pointer select-none transition-all duration-200 hover:shadow-md"
          style={cardBase}
          onClick={() => setOpenBank((v) => !v)}
        >
          <div className="flex items-start justify-between">
            <CardLabel>Konta bankowe</CardLabel>
            <div className="flex items-center gap-1.5">
              <div
                className="rounded-lg p-1.5"
                style={{ background: 'var(--wd-surface-2)' }}
              >
                <Landmark size={13} style={{ color: 'var(--wd-text-muted)' }} />
              </div>
              <ChevronDown
                size={14}
                className="transition-transform duration-200"
                style={{
                  color: 'var(--wd-text-muted)',
                  transform: openBank ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </div>
          </div>
          <p
            className="text-2xl font-bold tabular-nums tracking-tight"
            style={{ color: 'var(--wd-dark)', fontFamily: 'var(--font-mono, monospace)' }}
          >
            {bankTotal.toLocaleString('pl-PL')}
            <span className="text-sm font-medium ml-1" style={{ color: 'var(--wd-text-muted)' }}>
              PLN
            </span>
          </p>
          {openBank && (
            <AccountList
              accounts={bankAccounts}
              onSave={updateBalance}
              isAdmin={isAdmin}
              onAddAccount={() => {
                setNewAccountType('bank')
                setNewAccountCurrency('PLN')
                setShowAddAccountModal(true)
              }}
            />
          )}
        </div>

        {/* ── Karta 3 — Gotówka ────────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-5 cursor-pointer select-none transition-all duration-200 hover:shadow-md"
          style={cardBase}
          onClick={() => setOpenCash((v) => !v)}
        >
          <div className="flex items-start justify-between">
            <CardLabel>Gotówka</CardLabel>
            <div className="flex items-center gap-1.5">
              <div
                className="rounded-lg p-1.5"
                style={{ background: 'var(--wd-surface-2)' }}
              >
                <Banknote size={13} style={{ color: 'var(--wd-text-muted)' }} />
              </div>
              <ChevronDown
                size={14}
                className="transition-transform duration-200"
                style={{
                  color: 'var(--wd-text-muted)',
                  transform: openCash ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </div>
          </div>
          <p
            className="text-2xl font-bold tabular-nums tracking-tight"
            style={{ color: 'var(--wd-dark)', fontFamily: 'var(--font-mono, monospace)' }}
          >
            {cashTotal.toLocaleString('pl-PL')}
            <span className="text-sm font-medium ml-1" style={{ color: 'var(--wd-text-muted)' }}>
              PLN
            </span>
          </p>
          {openCash && (
            <AccountList
              accounts={cashAccounts}
              onSave={updateBalance}
              isAdmin={isAdmin}
              onAddAccount={() => {
                setNewAccountType('cash')
                setNewAccountCurrency('PLN')
                setShowAddAccountModal(true)
              }}
            />
          )}
        </div>

        {/* ── Karta 4 — EUR ────────────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-5 cursor-pointer select-none transition-all duration-200 hover:shadow-md"
          style={cardBase}
          onClick={() => setOpenEur((v) => !v)}
        >
          <div className="flex items-start justify-between">
            <CardLabel>Konto EUR</CardLabel>
            <div className="flex items-center gap-1.5">
              <div
                className="rounded-lg p-1.5"
                style={{ background: 'var(--wd-surface-2)' }}
              >
                <Euro size={13} style={{ color: 'var(--wd-text-muted)' }} />
              </div>
              <ChevronDown
                size={14}
                className="transition-transform duration-200"
                style={{
                  color: 'var(--wd-text-muted)',
                  transform: openEur ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </div>
          </div>
          <p
            className="text-2xl font-bold tabular-nums tracking-tight"
            style={{ color: 'var(--wd-dark)', fontFamily: 'var(--font-mono, monospace)' }}
          >
            {eurTotal.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-sm font-medium ml-1" style={{ color: 'var(--wd-text-muted)' }}>
              EUR
            </span>
          </p>
          {eurRate && (
            <p className="text-xs mt-1.5 tabular-nums" style={{ color: 'var(--wd-text-muted)' }}>
              ≈ {(eurTotal * eurRate).toLocaleString('pl-PL')} PLN
            </p>
          )}
          {eurRate && eurRateDate && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)', opacity: 0.6 }}>
              kurs: {eurRate.toFixed(4)} · {eurRateDate}
            </p>
          )}
          {openEur && (
            <AccountList
              accounts={eurAccounts}
              onSave={updateBalance}
              isAdmin={false}
            />
          )}
        </div>

        {/* ── Karta 5 — Stan finansów ───────────────────────────────────────── */}
        <div className="rounded-2xl p-5" style={cardBase}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <div
                className="rounded-lg p-1.5"
                style={{ background: 'var(--wd-surface-2)' }}
              >
                <TrendingUp size={13} style={{ color: 'var(--wd-text-muted)' }} />
              </div>
              <CardLabel>Stan finansów</CardLabel>
            </div>
            <Link
              href="/settings"
              className="rounded-lg p-1.5 transition-opacity hover:opacity-60"
              style={{ color: 'var(--wd-text-muted)', background: 'var(--wd-surface-2)' }}
              title="Ustawienia progów"
            >
              <Settings size={13} />
            </Link>
          </div>

          {/* Status badge */}
          <div className="mt-1 mb-3">
            <span
              className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${status.badgeClass}`}
            >
              {status.label}
            </span>
          </div>

          <p className="text-xs tabular-nums mb-3" style={{ color: 'var(--wd-text-muted)' }}>
            {netCash.toLocaleString('pl-PL')} PLN netto
          </p>

          {/* Progress bar */}
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: 'var(--wd-surface-2)' }}
          >
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: status.barColor }}
            />
          </div>
          <p className="text-xs mt-1.5" style={{ color: 'var(--wd-text-muted)', opacity: 0.7 }}>
            {pct}% progu &quot;Bardzo dobry&quot;
          </p>
        </div>
      </div>

      {/* ── Modal — Aktualizuj zobowiązania ───────────────────────────────── */}
      {showLiabilityModal && (
        <Modal
          title="Aktualizuj zobowiązania"
          onClose={() => setShowLiabilityModal(false)}
        >
          {liabilityLatest && (
            <div
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-4 text-xs"
              style={{
                background: 'var(--wd-surface-2)',
                color: 'var(--wd-text-muted)',
              }}
            >
              <span>Ostatnia wartość:</span>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--wd-dark)' }}>
                {liabilityLatest.amount.toLocaleString('pl-PL')} PLN
              </span>
            </div>
          )}
          <div className="space-y-3">
            <div>
              <ModalLabel>Kwota zobowiązań (PLN)</ModalLabel>
              <ModalInput
                type="number"
                min="0"
                step="1"
                value={liabilityAmount}
                onChange={(e) => setLiabilityAmount(e.target.value)}
                placeholder="np. 150000"
                autoFocus
              />
            </div>
            <div>
              <ModalLabel>Notatka (opcjonalnie)</ModalLabel>
              <ModalInput
                type="text"
                value={liabilityNotes}
                onChange={(e) => setLiabilityNotes(e.target.value)}
                placeholder="np. faktury za marzec"
              />
            </div>
          </div>
          <ModalActions
            onCancel={() => setShowLiabilityModal(false)}
            onConfirm={handleSaveLiability}
            disabled={savingLiability || !liabilityAmount}
            confirmLabel="Zapisz"
            loadingLabel="Zapisuję..."
            loading={savingLiability}
          />
        </Modal>
      )}

      {/* ── Modal — Dodaj konto ───────────────────────────────────────────── */}
      {showAddAccountModal && (
        <Modal
          title="Dodaj konto"
          onClose={() => setShowAddAccountModal(false)}
        >
          <div className="space-y-3">
            <div>
              <ModalLabel>Nazwa konta</ModalLabel>
              <ModalInput
                type="text"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="np. Konto firmowe PKO"
                autoFocus
              />
            </div>
            <div>
              <ModalLabel>Typ</ModalLabel>
              <ModalSelect
                value={newAccountType}
                onChange={(e) => setNewAccountType(e.target.value as 'bank' | 'cash')}
              >
                <option value="bank">Bank</option>
                <option value="cash">Gotówka</option>
              </ModalSelect>
            </div>
            <div>
              <ModalLabel>Waluta</ModalLabel>
              <ModalSelect
                value={newAccountCurrency}
                onChange={(e) => setNewAccountCurrency(e.target.value as 'PLN' | 'EUR')}
              >
                <option value="PLN">PLN</option>
                <option value="EUR">EUR</option>
              </ModalSelect>
            </div>
          </div>
          <ModalActions
            onCancel={() => setShowAddAccountModal(false)}
            onConfirm={handleAddAccount}
            disabled={savingAccount || !newAccountName.trim()}
            confirmLabel="Dodaj"
            loadingLabel="Tworzę..."
            loading={savingAccount}
          />
        </Modal>
      )}
    </>
  )
}
