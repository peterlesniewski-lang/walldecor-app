'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { BudgetCell, NavDirection } from '@/components/shared/budget-cell'

interface RevenueGridProps {
  initialEntries: Record<string, number>  // key: `${channel}_${month}`
  year: number
  costCenterId: string
  canEdit: boolean
}

type ActiveCell = { channel: string; month: number } | null

const MONTHS = ['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru']

const CHANNEL_LABELS: Record<string, string> = {
  SALON: 'Salon',
  ECOMMERCE: 'E-commerce',
}

export function RevenueGrid({ initialEntries, year, costCenterId, canEdit }: RevenueGridProps) {
  const [entries, setEntries] = useState<Record<string, number>>(initialEntries)
  const [activeCell, setActiveCell] = useState<ActiveCell>(null)

  const router = useRouter()

  // ECOMMERCE is only relevant for PUL
  const channels = costCenterId === 'PUL' ? ['SALON', 'ECOMMERCE'] : ['SALON']

  const getEntry = (channel: string, month: number) =>
    entries[`${channel}_${month}`] ?? 0

  const rowSum = (channel: string) =>
    MONTHS.reduce((sum, _, i) => sum + getEntry(channel, i + 1), 0)

  const colSum = (month: number) =>
    channels.reduce((sum, ch) => sum + getEntry(ch, month), 0)

  const grandTotal = MONTHS.reduce((sum, _, i) => sum + colSum(i + 1), 0)

  const onSave = useCallback(
    async (channel: string, month: number, amount: number) => {
      const res = await fetch('/api/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, costCenterId, channel, amount }),
      })
      if (res.ok) {
        setEntries(prev => ({ ...prev, [`${channel}_${month}`]: amount }))
      }
    },
    [year, costCenterId]
  )

  const handleNavigate = useCallback(
    (channel: string, month: number, dir: NavDirection) => {
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

  const handleYearChange = (newYear: number) => {
    router.push(`/finance/revenue?year=${newYear}&costCenterId=${costCenterId}`)
  }

  const handleCostCenterChange = (newCostCenter: string) => {
    router.push(`/finance/revenue?year=${year}&costCenterId=${newCostCenter}`)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>Przychody</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => handleYearChange(year - 1)} className="p-1 hover:bg-gray-100 rounded">‹</button>
            <span className="font-medium px-2">{year}</span>
            <button onClick={() => handleYearChange(year + 1)} className="p-1 hover:bg-gray-100 rounded">›</button>
          </div>
        </div>
        <div className="flex gap-1">
          {['GLOBAL', 'JAG', 'PUL'].map((cc) => (
            <button
              key={cc}
              onClick={() => handleCostCenterChange(cc)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                costCenterId === cc
                  ? 'bg-[#E4DCD1] text-gray-800'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {cc}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="table-fixed w-full border-collapse text-sm">
          <colgroup>
            <col className="w-40" />
            {MONTHS.map((_, i) => <col key={i} className="w-20" />)}
            <col className="w-24" />
          </colgroup>
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left px-3 py-2 font-medium text-gray-500">Kanał</th>
              {MONTHS.map((m) => (
                <th key={m} className="text-right px-2 py-2 font-medium text-gray-500">{m}</th>
              ))}
              <th className="text-right px-3 py-2 font-medium text-gray-500">SUMA</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch} className="border-t hover:bg-gray-50/50">
                <td className="px-3 py-0 text-gray-700 font-medium text-sm">
                  {CHANNEL_LABELS[ch]}
                </td>
                {MONTHS.map((_, i) => (
                  <BudgetCell
                    key={i}
                    value={getEntry(ch, i + 1)}
                    editable={canEdit}
                    isEditing={canEdit && activeCell?.channel === ch && activeCell?.month === i + 1}
                    onActivate={() => setActiveCell({ channel: ch, month: i + 1 })}
                    onDeactivate={() => setActiveCell(null)}
                    onNavigate={(dir) => handleNavigate(ch, i + 1, dir)}
                    onSave={(v) => onSave(ch, i + 1, v)}
                  />
                ))}
                <td className="text-right px-3 py-1 font-mono text-sm text-gray-700 font-semibold">
                  {rowSum(ch) === 0 ? '—' : rowSum(ch).toLocaleString('pl-PL')}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className="px-3 py-2 text-gray-700">SUMA</td>
              {MONTHS.map((_, i) => (
                <td key={i} className="text-right px-2 py-2 font-mono text-sm text-gray-700">
                  {colSum(i + 1) === 0 ? '—' : colSum(i + 1).toLocaleString('pl-PL')}
                </td>
              ))}
              <td className="text-right px-3 py-2 font-mono text-sm text-gray-700">
                {grandTotal === 0 ? '—' : grandTotal.toLocaleString('pl-PL')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {costCenterId === 'GLOBAL' && (
        <p className="mt-3 text-xs text-gray-400">
          GLOBAL nie posiada własnych przychodów — przychody przypisane są do JAG i PUL.
        </p>
      )}
    </div>
  )
}
