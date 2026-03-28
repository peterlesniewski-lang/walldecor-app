import type { LeaveType, LeaveBalanceNew } from '@/generated/prisma'

interface LeaveBalanceCardProps {
  leaveType: LeaveType
  balance: LeaveBalanceNew
  compact?: boolean
}

export function LeaveBalanceCard({ leaveType, balance, compact = false }: LeaveBalanceCardProps) {
  const available = balance.totalDays - balance.usedDays - balance.pendingDays
  const usedPercent = balance.totalDays > 0
    ? Math.round(((balance.usedDays + balance.pendingDays) / balance.totalDays) * 100)
    : 0

  const availablePercent = 100 - usedPercent

  return (
    <div
      className={`bg-white rounded-xl border border-[var(--wd-border)] ${compact ? 'p-3' : 'p-4'} flex flex-col gap-2`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: leaveType.color }}
          />
          <div className="min-w-0">
            <p className={`font-semibold text-[var(--wd-text-primary)] truncate ${compact ? 'text-xs' : 'text-sm'}`}>
              {leaveType.name}
            </p>
            <p className="text-[10px] text-[var(--wd-text-muted)] font-mono uppercase tracking-wide">
              {leaveType.code}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p
            className={`font-bold tabular-nums ${compact ? 'text-base' : 'text-xl'}`}
            style={{ color: leaveType.color }}
          >
            {available % 1 === 0 ? available : available.toFixed(1)}
          </p>
          <p className="text-[10px] text-[var(--wd-text-muted)]">
            z {balance.totalDays % 1 === 0 ? balance.totalDays : balance.totalDays.toFixed(1)} dni
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-[var(--wd-surface-2)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(usedPercent, 100)}%`,
            backgroundColor: leaveType.color,
            opacity: 0.85,
          }}
        />
      </div>

      {/* Stats row */}
      {!compact && (
        <div className="flex items-center justify-between text-[11px] text-[var(--wd-text-muted)]">
          <span>
            <span className="font-semibold text-[var(--wd-text-primary)]">{balance.usedDays}</span> wykorzystane
          </span>
          {balance.pendingDays > 0 && (
            <span>
              <span className="font-semibold text-amber-600">{balance.pendingDays}</span> oczekujące
            </span>
          )}
          {balance.carriedOver > 0 && (
            <span>
              <span className="font-semibold text-[var(--wd-text-primary)]">{balance.carriedOver}</span> przeniesione
            </span>
          )}
          <span>
            <span className="font-semibold" style={{ color: leaveType.color }}>
              {availablePercent}%
            </span>{' '}
            wolne
          </span>
        </div>
      )}
    </div>
  )
}
