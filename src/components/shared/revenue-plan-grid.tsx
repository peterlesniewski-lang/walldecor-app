'use client'
import { useState, useCallback } from 'react'
import { BudgetCell, NavDirection } from '@/components/shared/budget-cell'
import { CHANNEL_LABELS, COST_CENTER_CHANNELS, REVENUE_CHANNELS, RevenueChannel } from '@/lib/validations/revenue'

interface RevenuePlanGridProps {
  initialEntries: Record<string, number>  // key: `${channel}_${month}`
  year: number
  costCenterId: string
  editable: boolean
}

type ActiveCell = { channel: RevenueChannel; month: number } | null

const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']

export function RevenuePlanGrid({ initialEntries, year, costCenterId, editable }: RevenuePlanGridProps) {
  const [entries, setEntries] = useState<Record<string, number>>(initialEntries)
  const [activeCell, setActiveCell] = useState<ActiveCell>(null)

  const channels: RevenueChannel[] = costCenterId === 'GLOBAL'
    ? [...REVENUE_CHANNELS]
    : (COST_CENTER_CHANNELS[costCenterId] ?? [])

  const getEntry = (channel: RevenueChannel, month: number) =>
    entries[`${channel}_${month}`] ?? 0

  const rowSum = (channel: RevenueChannel) =>
    MONTHS.reduce((sum, _, i) => sum + getEntry(channel, i + 1), 0)

  const colSum = (month: number) =>
    channels.reduce((sum, ch) => sum + getEntry(ch, month), 0)

  const grandTotal = MONTHS.reduce((sum, _, i) => sum + colSum(i + 1), 0)

  const onSave = useCallback(
    async (channel: RevenueChannel, month: number, amount: number) => {
      const res = await fetch('/api/revenue-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, costCenterId, channel, amount }),
      })
      if (res.ok) {
        setEntries((prev) => ({ ...prev, [`${channel}_${month}`]: amount }))
      }
    },
    [year, costCenterId]
  )

  const handleNavigate = useCallback(
    (channel: RevenueChannel, month: number, dir: NavDirection) => {
      const rowIdx = channels.indexOf(channel)
      let newChannel = channel
      let newMonth = month

      switch (dir) {
        case 'right':
          if (month < 12) { newMonth = month + 1 }
          else if (rowIdx < channels.length - 1) { newChannel = channels[rowIdx + 1]; newMonth = 1 }
          break
        case 'left':
          if (month > 1) { newMonth = month - 1 }
          else if (rowIdx > 0) { newChannel = channels[rowIdx - 1]; newMonth = 12 }
          break
        case 'down':
          if (rowIdx < channels.length - 1) { newChannel = channels[rowIdx + 1] }
          break
        case 'up':
          if (rowIdx > 0) { newChannel = channels[rowIdx - 1] }
          break
      }
      setActiveCell({ channel: newChannel, month: newMonth })
    },
    [channels]
  )

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="table-fixed w-full border-collapse text-sm">
        <colgroup>
          <col className="w-44" />
          {MONTHS.map((_, i) => <col key={i} style={{ width: '7rem' }} />)}
          <col className="w-28" />
        </colgroup>
        <thead>
          <tr className="border-b" style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}>
            <th className="text-left px-3 py-2.5 data-label">Kanał</th>
            {MONTHS.map((m) => (
              <th key={m} className="text-right px-2 py-2.5 data-label border-r" style={{ borderColor: 'var(--wd-border)' }}>{m}</th>
            ))}
            <th className="text-right px-3 py-2.5 data-label">SUMA</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => (
            <tr key={ch} className="border-t hover:bg-gray-50/50" style={{ borderColor: 'var(--wd-border)' }}>
              <td className="px-3 py-2.5 text-sm font-medium" style={{ color: 'var(--wd-text-primary)' }}>
                {CHANNEL_LABELS[ch]}
              </td>
              {MONTHS.map((_, i) => (
                <BudgetCell
                  key={i}
                  value={getEntry(ch, i + 1)}
                  editable={editable}
                  isEditing={editable && activeCell?.channel === ch && activeCell?.month === i + 1}
                  onActivate={() => setActiveCell({ channel: ch, month: i + 1 })}
                  onDeactivate={() => setActiveCell(null)}
                  onNavigate={(dir) => handleNavigate(ch, i + 1, dir)}
                  onSave={(v) => onSave(ch, i + 1, v)}
                  tdClassName="border-r"
                />
              ))}
              <td className="text-right px-3 py-2.5 num text-sm font-semibold" style={{ color: 'var(--wd-dark)' }}>
                {rowSum(ch) === 0 ? '—' : rowSum(ch).toLocaleString('pl-PL')}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold" style={{ borderTop: '2px solid var(--wd-border)', background: 'var(--wd-surface-2)' }}>
            <td className="px-3 py-2.5 data-label" style={{ color: 'var(--wd-dark)' }}>SUMA</td>
            {MONTHS.map((_, i) => (
              <td key={i} className="text-right px-2 py-2.5 num text-sm border-r" style={{ color: 'var(--wd-dark)', borderColor: 'var(--wd-border)' }}>
                {colSum(i + 1) === 0 ? '—' : colSum(i + 1).toLocaleString('pl-PL')}
              </td>
            ))}
            <td className="text-right px-3 py-2.5 num text-sm" style={{ color: 'var(--wd-dark)' }}>
              {grandTotal === 0 ? '—' : grandTotal.toLocaleString('pl-PL')}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
