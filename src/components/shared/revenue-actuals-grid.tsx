'use client'
import { useState, useCallback } from 'react'
import React from 'react'
import { BudgetCell, NavDirection } from '@/components/shared/budget-cell'
import { CHANNEL_LABELS, COST_CENTER_CHANNELS, REVENUE_CHANNELS, RevenueChannel } from '@/lib/validations/revenue'

interface RevenueActualsGridProps {
  planEntries: Record<string, number>     // key: `${channel}_${month}`
  initialActuals: Record<string, number>  // key: `${channel}_${month}`
  year: number
  costCenterId: string
  editable: boolean
}

type ActiveCell = { channel: RevenueChannel; month: number } | null

const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']

export function RevenueActualsGrid({
  planEntries,
  initialActuals,
  year,
  costCenterId,
  editable,
}: RevenueActualsGridProps) {
  const [actuals, setActuals] = useState<Record<string, number>>(initialActuals)
  const [activeCell, setActiveCell] = useState<ActiveCell>(null)

  const channels: RevenueChannel[] = costCenterId === 'GLOBAL'
    ? [...REVENUE_CHANNELS]
    : (COST_CENTER_CHANNELS[costCenterId] ?? [])

  const getPlan = (ch: RevenueChannel, month: number) => planEntries[`${ch}_${month}`] ?? 0
  const getReal = (ch: RevenueChannel, month: number) => actuals[`${ch}_${month}`] ?? 0

  const rowPlanSum = (ch: RevenueChannel) => MONTHS.reduce((s, _, i) => s + getPlan(ch, i + 1), 0)
  const rowRealSum = (ch: RevenueChannel) => MONTHS.reduce((s, _, i) => s + getReal(ch, i + 1), 0)
  const rowPct = (ch: RevenueChannel): number | null => {
    const p = rowPlanSum(ch)
    return p > 0 ? (rowRealSum(ch) / p) * 100 : null
  }

  const colPlanSum = (month: number) => channels.reduce((s, ch) => s + getPlan(ch, month), 0)
  const colRealSum = (month: number) => channels.reduce((s, ch) => s + getReal(ch, month), 0)
  const colPct = (month: number): number | null => {
    const p = colPlanSum(month)
    return p > 0 ? (colRealSum(month) / p) * 100 : null
  }

  const grandPlan = MONTHS.reduce((s, _, i) => s + colPlanSum(i + 1), 0)
  const grandReal = MONTHS.reduce((s, _, i) => s + colRealSum(i + 1), 0)
  const grandPct: number | null = grandPlan > 0 ? (grandReal / grandPlan) * 100 : null

  const fmt = (n: number) => (n === 0 ? '—' : n.toLocaleString('pl-PL'))
  const fmtPct = (p: number | null) => (p === null ? '—' : `${Math.round(p)}%`)
  const pctClass = (p: number | null) =>
    p === null ? 'text-gray-300' : p >= 100 ? 'text-green-600' : p >= 80 ? 'text-amber-500' : 'text-red-500'

  const onSave = useCallback(
    async (channel: RevenueChannel, month: number, amount: number) => {
      const res = await fetch('/api/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, costCenterId, channel, amount }),
      })
      if (res.ok) {
        setActuals((prev) => ({ ...prev, [`${channel}_${month}`]: amount }))
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

  const planCellClass = 'text-right font-mono text-xs px-1 py-1 bg-gray-50 text-gray-400 border-r border-gray-100'

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="table-fixed w-full border-collapse text-sm">
        <colgroup>
          <col style={{ width: '11rem' }} />
          {MONTHS.map((_, i) => (
            <React.Fragment key={i}>
              <col style={{ width: '3.5rem' }} />
              <col style={{ width: '4rem' }} />
            </React.Fragment>
          ))}
          <col style={{ width: '4.5rem' }} />
          <col style={{ width: '4.5rem' }} />
          <col style={{ width: '3rem' }} />
        </colgroup>
        <thead>
          <tr className="border-b bg-gray-50">
            <th rowSpan={2} className="text-left px-3 py-2 font-medium text-gray-500 border-r border-gray-200 align-bottom">
              Kanał
            </th>
            {MONTHS.map((m) => (
              <th key={m} colSpan={2} className="text-center px-1 py-1 font-medium text-gray-500 border-r border-gray-100 text-xs">
                {m}
              </th>
            ))}
            <th colSpan={2} className="text-center px-1 py-1 font-medium text-gray-500 border-r border-gray-200 text-xs">
              SUMA
            </th>
            <th rowSpan={2} className="text-center px-1 py-2 font-medium text-gray-500 align-bottom text-xs">
              %
            </th>
          </tr>
          <tr className="border-b bg-gray-50">
            {MONTHS.map((m) => (
              <React.Fragment key={m}>
                <th className="text-center py-1 font-normal text-gray-400 text-xs bg-gray-50 border-r border-gray-100">Plan</th>
                <th className="text-center py-1 font-normal text-gray-500 text-xs border-r border-gray-100">Real</th>
              </React.Fragment>
            ))}
            <th className="text-center py-1 font-normal text-gray-400 text-xs bg-gray-50 border-r border-gray-100">P</th>
            <th className="text-center py-1 font-normal text-gray-500 text-xs border-r border-gray-200">R</th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => (
            <tr key={ch} className="border-t hover:bg-gray-50/50">
              <td className="px-3 py-0 text-gray-700 font-medium text-sm border-r border-gray-200">
                {CHANNEL_LABELS[ch]}
              </td>
              {MONTHS.map((_, i) => {
                const month = i + 1
                return (
                  <React.Fragment key={i}>
                    <td className={planCellClass}>{fmt(getPlan(ch, month))}</td>
                    <BudgetCell
                      value={getReal(ch, month)}
                      editable={editable}
                      isEditing={editable && activeCell?.channel === ch && activeCell?.month === month}
                      onActivate={() => setActiveCell({ channel: ch, month })}
                      onDeactivate={() => setActiveCell(null)}
                      onNavigate={(dir) => handleNavigate(ch, month, dir)}
                      onSave={(v) => onSave(ch, month, v)}
                    />
                  </React.Fragment>
                )
              })}
              <td className="text-right px-1 py-1 font-mono text-xs text-gray-400 bg-gray-50 border-l border-gray-100">
                {fmt(rowPlanSum(ch))}
              </td>
              <td className="text-right px-2 py-1 font-mono text-sm text-gray-700 font-medium border-r border-gray-200">
                {fmt(rowRealSum(ch))}
              </td>
              <td className={`text-right px-2 py-1 font-mono text-xs font-medium ${pctClass(rowPct(ch))}`}>
                {fmtPct(rowPct(ch))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <td className="px-3 py-2 text-gray-700 border-r border-gray-200">SUMA</td>
            {MONTHS.map((_, i) => {
              const month = i + 1
              return (
                <React.Fragment key={i}>
                  <td className="text-right px-1 py-2 font-mono text-xs text-gray-400 bg-gray-50 border-r border-gray-100">
                    {fmt(colPlanSum(month))}
                  </td>
                  <td className="text-right px-2 py-2 font-mono text-sm text-gray-700 border-r border-gray-100">
                    {fmt(colRealSum(month))}
                  </td>
                </React.Fragment>
              )
            })}
            <td className="text-right px-1 py-2 font-mono text-xs text-gray-400 bg-gray-50 border-l border-gray-100">
              {fmt(grandPlan)}
            </td>
            <td className="text-right px-2 py-2 font-mono text-sm text-gray-700 border-r border-gray-200">
              {fmt(grandReal)}
            </td>
            <td className={`text-right px-2 py-2 font-mono text-xs ${pctClass(grandPct)}`}>
              {fmtPct(grandPct)}
            </td>
          </tr>
          <tr className="border-t border-gray-200 bg-gray-50">
            <td className="px-3 py-1 text-gray-500 text-xs border-r border-gray-200">% wykonania</td>
            {MONTHS.map((_, i) => {
              const pct = colPct(i + 1)
              return (
                <React.Fragment key={i}>
                  <td className={`text-right px-1 py-1 font-mono text-xs font-medium bg-gray-50 border-r border-gray-100 ${pctClass(pct)}`}>
                    {fmtPct(pct)}
                  </td>
                  <td className="border-r border-gray-100" />
                </React.Fragment>
              )
            })}
            <td className="bg-gray-50 border-l border-gray-100" />
            <td className="border-r border-gray-200" />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
