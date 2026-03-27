'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface PnlViewProps {
  planIncomeByMonth: number[]    // index 0 = Sty … 11 = Gru
  realIncomeByMonth: number[]
  planExpensesByMonth: number[]
  realExpensesByMonth: number[]
  year: number
  costCenterId: string
}

const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']

const planColor = '#d1d5db'   // gray-300 — plan (zawsze szary)
const incomeColor = '#86efac' // green-300 — real income
const expenseColor = '#fca5a5' // red-300 — real expenses

function fmt(n: number) {
  return n === 0 ? '—' : n.toLocaleString('pl-PL')
}
function fmtK(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} mln`
  if (abs >= 1_000) return `${Math.round(n / 1_000)} k`
  return n.toLocaleString('pl-PL')
}
function pct(real: number, plan: number): number | null {
  return plan > 0 ? (real / plan) * 100 : null
}
function fmtPct(p: number | null) {
  return p === null ? '—' : `${Math.round(p)}%`
}
function pctClass(p: number | null, invert = false) {
  if (p === null) return 'text-gray-400'
  const good = invert ? p <= 100 : p >= 100
  return good ? 'text-green-600' : p >= 80 ? 'text-amber-500' : 'text-red-500'
}
function netClass(n: number) {
  return n > 0 ? 'text-green-600' : n < 0 ? 'text-red-500' : 'text-gray-400'
}

const planCellCls = 'text-right font-mono text-xs px-1 py-2 bg-gray-50 text-gray-400 border-r border-gray-100'
const realCellCls = 'text-right font-mono text-xs px-2 py-2 border-r border-gray-100'

export function PnlView({
  planIncomeByMonth,
  realIncomeByMonth,
  planExpensesByMonth,
  realExpensesByMonth,
  year,
  costCenterId,
}: PnlViewProps) {
  const router = useRouter()

  // ── derived ──────────────────────────────────────────────────────────────
  const planNetByMonth  = planIncomeByMonth.map((p, i) => p - planExpensesByMonth[i])
  const realNetByMonth  = realIncomeByMonth.map((r, i) => r - realExpensesByMonth[i])

  const totalPlanIncome   = planIncomeByMonth.reduce((s, v) => s + v, 0)
  const totalRealIncome   = realIncomeByMonth.reduce((s, v) => s + v, 0)
  const totalPlanExpenses = planExpensesByMonth.reduce((s, v) => s + v, 0)
  const totalRealExpenses = realExpensesByMonth.reduce((s, v) => s + v, 0)
  const totalPlanNet      = totalPlanIncome - totalPlanExpenses
  const totalRealNet      = totalRealIncome - totalRealExpenses

  const incomeExec   = pct(totalRealIncome, totalPlanIncome)
  const expenseExec  = pct(totalRealExpenses, totalPlanExpenses)
  const realMargin   = totalRealIncome > 0 ? (totalRealNet / totalRealIncome) * 100 : null
  const planMargin   = totalPlanIncome > 0 ? (totalPlanNet / totalPlanIncome) * 100 : null

  // ── chart data ────────────────────────────────────────────────────────────
  const incomeChartData = MONTHS.map((m, i) => ({
    month: m, plan: planIncomeByMonth[i], real: realIncomeByMonth[i],
  }))
  const expenseChartData = MONTHS.map((m, i) => ({
    month: m, plan: planExpensesByMonth[i], real: realExpensesByMonth[i],
  }))

  const navigate = (yr: number, cc: string) =>
    router.push(`/finance/actuals?year=${yr}&costCenterId=${cc}`)

  const chartTooltipFmt = (value: number) => value.toLocaleString('pl-PL') + ' zł'

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>P&L</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(year - 1, costCenterId)} className="p-1 hover:bg-gray-100 rounded">‹</button>
            <span className="font-medium px-2">{year}</span>
            <button onClick={() => navigate(year + 1, costCenterId)} className="p-1 hover:bg-gray-100 rounded">›</button>
          </div>
        </div>
        <div className="flex gap-1">
          {['GLOBAL', 'JAG', 'PUL'].map((cc) => (
            <button
              key={cc}
              onClick={() => navigate(year, cc)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                costCenterId === cc ? 'bg-[#E4DCD1] text-gray-800' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {cc}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {/* Income */}
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Przychody</p>
          <p className="text-2xl font-bold text-gray-800">{fmtK(totalRealIncome)}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400">Plan: {fmtK(totalPlanIncome)}</span>
            <span className={`text-xs font-semibold ${pctClass(incomeExec)}`}>{fmtPct(incomeExec)}</span>
          </div>
        </div>
        {/* Expenses */}
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Koszty</p>
          <p className="text-2xl font-bold text-gray-800">{fmtK(totalRealExpenses)}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400">Plan: {fmtK(totalPlanExpenses)}</span>
            <span className={`text-xs font-semibold ${pctClass(expenseExec, true)}`}>{fmtPct(expenseExec)}</span>
          </div>
        </div>
        {/* Net */}
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Zysk netto</p>
          <p className={`text-2xl font-bold ${netClass(totalRealNet)}`}>{fmtK(totalRealNet)}</p>
          <p className="text-xs text-gray-400 mt-1">Plan: {fmtK(totalPlanNet)}</p>
        </div>
        {/* Margin */}
        <div className="rounded-xl border bg-white p-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Marża</p>
          <p className={`text-2xl font-bold ${netClass(realMargin ?? 0)}`}>
            {realMargin !== null ? `${realMargin.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Plan: {planMargin !== null ? `${planMargin.toFixed(1)}%` : '—'}
          </p>
        </div>
      </div>

      {/* ── Charts ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border bg-white p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Przychody — Plan vs Real</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={incomeChartData} barCategoryGap="28%" barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtK} />
              <Tooltip formatter={chartTooltipFmt} cursor={{ fill: '#f9f9f9' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === 'plan' ? 'Plan' : 'Real'} />
              <Bar dataKey="plan" fill={planColor} radius={[3, 3, 0, 0]} name="plan" />
              <Bar dataKey="real" fill={incomeColor} radius={[3, 3, 0, 0]} name="real" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border bg-white p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-4">Koszty — Plan vs Real</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={expenseChartData} barCategoryGap="28%" barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={fmtK} />
              <Tooltip formatter={chartTooltipFmt} cursor={{ fill: '#f9f9f9' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === 'plan' ? 'Plan' : 'Real'} />
              <Bar dataKey="plan" fill={planColor} radius={[3, 3, 0, 0]} name="plan" />
              <Bar dataKey="real" fill={expenseColor} radius={[3, 3, 0, 0]} name="real" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-white overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <colgroup>
            <col style={{ width: '7rem' }} />
            {MONTHS.map((_, i) => (
              <React.Fragment key={i}>
                <col style={{ width: '3.2rem' }} />
                <col style={{ width: '3.8rem' }} />
              </React.Fragment>
            ))}
            <col style={{ width: '4rem' }} />
            <col style={{ width: '4rem' }} />
          </colgroup>
          <thead>
            <tr className="border-b bg-gray-50">
              <th rowSpan={2} className="text-left px-3 py-2 font-medium text-gray-500 border-r border-gray-200 align-bottom text-xs">
                Pozycja
              </th>
              {MONTHS.map((m) => (
                <th key={m} colSpan={2} className="text-center px-1 py-1.5 font-medium text-gray-500 border-r border-gray-100 text-xs">
                  {m}
                </th>
              ))}
              <th colSpan={2} className="text-center px-1 py-1.5 font-medium text-gray-500 border-r border-gray-200 text-xs">
                SUMA
              </th>
            </tr>
            <tr className="border-b bg-gray-50">
              {MONTHS.map((m) => (
                <React.Fragment key={m}>
                  <th className="text-center py-1 font-normal text-gray-400 text-xs bg-gray-50 border-r border-gray-100">P</th>
                  <th className="text-center py-1 font-normal text-gray-500 text-xs border-r border-gray-100">R</th>
                </React.Fragment>
              ))}
              <th className="text-center py-1 font-normal text-gray-400 text-xs bg-gray-50 border-r border-gray-100">P</th>
              <th className="text-center py-1 font-normal text-gray-500 text-xs border-r border-gray-200">R</th>
            </tr>
          </thead>
          <tbody>
            {/* Przychody */}
            <tr className="border-t hover:bg-gray-50/50">
              <td className="px-3 py-2 font-medium text-gray-700 border-r border-gray-200 text-xs">Przychody</td>
              {MONTHS.map((_, i) => (
                <React.Fragment key={i}>
                  <td className={planCellCls}>{fmt(planIncomeByMonth[i])}</td>
                  <td className={`${realCellCls} text-gray-700`}>{fmt(realIncomeByMonth[i])}</td>
                </React.Fragment>
              ))}
              <td className={planCellCls}>{fmt(totalPlanIncome)}</td>
              <td className={`${realCellCls} font-semibold text-gray-800`}>{fmt(totalRealIncome)}</td>
            </tr>

            {/* Koszty */}
            <tr className="border-t hover:bg-gray-50/50">
              <td className="px-3 py-2 font-medium text-gray-700 border-r border-gray-200 text-xs">Koszty</td>
              {MONTHS.map((_, i) => (
                <React.Fragment key={i}>
                  <td className={planCellCls}>{fmt(planExpensesByMonth[i])}</td>
                  <td className={`${realCellCls} text-gray-700`}>{fmt(realExpensesByMonth[i])}</td>
                </React.Fragment>
              ))}
              <td className={planCellCls}>{fmt(totalPlanExpenses)}</td>
              <td className={`${realCellCls} font-semibold text-gray-800`}>{fmt(totalRealExpenses)}</td>
            </tr>

            {/* Separator */}
            <tr><td colSpan={28} className="border-t-2 border-gray-200" /></tr>

            {/* Netto */}
            <tr className="hover:bg-gray-50/50">
              <td className="px-3 py-2 font-medium text-gray-700 border-r border-gray-200 text-xs">Netto</td>
              {MONTHS.map((_, i) => (
                <React.Fragment key={i}>
                  <td className={`${planCellCls} ${netClass(planNetByMonth[i])}`}>{fmt(planNetByMonth[i])}</td>
                  <td className={`${realCellCls} font-medium ${netClass(realNetByMonth[i])}`}>{fmt(realNetByMonth[i])}</td>
                </React.Fragment>
              ))}
              <td className={`${planCellCls} font-semibold ${netClass(totalPlanNet)}`}>{fmt(totalPlanNet)}</td>
              <td className={`${realCellCls} font-bold ${netClass(totalRealNet)}`}>{fmt(totalRealNet)}</td>
            </tr>

            {/* Marża % */}
            <tr className="border-t border-gray-100 hover:bg-gray-50/50">
              <td className="px-3 py-1.5 text-gray-400 border-r border-gray-200 text-xs">Marża</td>
              {MONTHS.map((_, i) => {
                const pm = pct(planNetByMonth[i], planIncomeByMonth[i])
                const rm = pct(realNetByMonth[i], realIncomeByMonth[i])
                return (
                  <React.Fragment key={i}>
                    <td className={`${planCellCls} text-gray-400`}>{fmtPct(pm)}</td>
                    <td className={`${realCellCls} ${netClass(realNetByMonth[i])}`}>{fmtPct(rm)}</td>
                  </React.Fragment>
                )
              })}
              <td className={`${planCellCls} text-gray-400`}>{fmtPct(planMargin)}</td>
              <td className={`${realCellCls} ${netClass(totalRealNet)}`}>{fmtPct(realMargin)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
