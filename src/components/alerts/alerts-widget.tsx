'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  AlertOctagon,
  CreditCard,
  CheckCircle,
  Loader2,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface AlertNotification {
  id: string
  type: string
  title: string
  message: string
  link: string | null
  isRead: boolean
  createdAt: string
}

export interface PaymentReminderWithDays {
  id: string
  name: string
  amount: number
  dayOfMonth: number
  costCenterId: string
  alertDaysInAdvance: number
  daysUntilDue: number
}

interface AlertsWidgetProps {
  budgetAlerts: AlertNotification[]
  paymentAlerts: PaymentReminderWithDays[]
  isAdmin: boolean
}

function AlertBadge({ type }: { type: string }) {
  if (type === 'budget_critical') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
        <AlertOctagon className="h-2.5 w-2.5" />
        Krytyczny
      </span>
    )
  }
  if (type === 'budget_warning') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <AlertTriangle className="h-2.5 w-2.5" />
        Ostrzeżenie
      </span>
    )
  }
  return null
}

function fmtAmount(amount: number) {
  return amount.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function AlertsWidget({ budgetAlerts, paymentAlerts, isAdmin }: AlertsWidgetProps) {
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<{ created: number } | null>(null)

  const hasAlerts = budgetAlerts.length > 0 || paymentAlerts.length > 0
  const totalCount = budgetAlerts.length + paymentAlerts.length

  const handleCheck = async () => {
    setChecking(true)
    setCheckResult(null)
    try {
      const res = await fetch('/api/alerts/check', { method: 'POST' })
      if (res.ok) {
        const data = await res.json() as { created: number }
        setCheckResult(data)
        // Refresh page data after 1s
        setTimeout(() => router.refresh(), 1000)
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div
      className="rounded-xl border bg-white"
      style={{ borderColor: 'var(--wd-border)', boxShadow: 'var(--card-shadow)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: 'var(--wd-border)' }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="text-sm font-semibold"
            style={{ color: 'var(--wd-text-primary)' }}
          >
            Aktywne alerty
          </span>
          {hasAlerts && (
            <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1">
              {totalCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => router.push('/finance/alerts')}
              className="flex items-center gap-1 text-xs transition-colors hover:opacity-70"
              style={{ color: 'var(--wd-text-muted)' }}
            >
              <Settings className="h-3.5 w-3.5" />
              Ustawienia
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-4">
        {!hasAlerts ? (
          // Empty state
          <div className="flex items-center gap-3 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 shrink-0">
              <CheckCircle className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-xs font-medium" style={{ color: 'var(--wd-text-primary)' }}>
                Brak aktywnych alertów
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
                Wszystkie progi budżetowe i terminy płatności są pod kontrolą
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-2">
            {/* Budget alerts */}
            {budgetAlerts.map((alert) => (
              <li
                key={alert.id}
                className={cn(
                  'flex items-start gap-3 rounded-lg px-3 py-2.5',
                  alert.type === 'budget_critical' ? 'bg-red-50' : 'bg-amber-50'
                )}
              >
                <div className="mt-0.5 shrink-0">
                  {alert.type === 'budget_critical'
                    ? <AlertOctagon className="h-4 w-4 text-red-600" />
                    : <AlertTriangle className="h-4 w-4 text-amber-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-xs font-semibold"
                      style={{ color: alert.type === 'budget_critical' ? '#DC2626' : '#D97706' }}
                    >
                      {alert.title}
                    </span>
                    <AlertBadge type={alert.type} />
                  </div>
                  <p
                    className="text-xs mt-0.5 line-clamp-2"
                    style={{ color: alert.type === 'budget_critical' ? '#7F1D1D' : '#78350F' }}
                  >
                    {alert.message}
                  </p>
                </div>
              </li>
            ))}

            {/* Payment alerts */}
            {paymentAlerts.map((reminder) => (
              <li
                key={reminder.id}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5 bg-blue-50"
              >
                <div className="mt-0.5 shrink-0">
                  <CreditCard className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-blue-700">
                      {reminder.name}
                    </span>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-700 border border-blue-200">
                      za {reminder.daysUntilDue} {reminder.daysUntilDue === 1 ? 'dzień' : 'dni'}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 text-blue-800">
                    {fmtAmount(reminder.amount)} PLN · {reminder.costCenterId} · {reminder.dayOfMonth}. dnia miesiąca
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-5 py-3 border-t gap-2"
        style={{ borderColor: 'var(--wd-border)' }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCheck}
          disabled={checking}
          className="h-7 text-xs gap-1.5 font-medium"
          style={{ color: 'var(--wd-text-muted)' }}
        >
          {checking
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : null
          }
          Sprawdź alerty
        </Button>

        {checkResult !== null && (
          <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
            {checkResult.created === 0
              ? 'Brak nowych alertów'
              : `+${checkResult.created} nowe powiadomienie${checkResult.created > 1 ? 'a' : ''}`
            }
          </span>
        )}

        {isAdmin && (
          <button
            onClick={() => router.push('/finance/alerts')}
            className="text-xs font-medium transition-colors hover:opacity-70 shrink-0"
            style={{ color: 'var(--wd-text-muted)' }}
          >
            Sprawdź alerty →
          </button>
        )}
      </div>
    </div>
  )
}
