'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { calcBep } from '@/lib/bep'

interface CcBreakdown {
  cc: string
  planIncome: number
  realIncome: number
  planExpenses: number
  realExpenses: number
}

interface DashboardViewProps {
  year: number
  currentMonth: number
  planIncomeByMonth: number[]
  realIncomeByMonth: number[]
  planExpensesByMonth: number[]
  realExpensesByMonth: number[]
  fixedCostsByMonth: number[]
  variableCostsByMonth: number[]
  ccBreakdown: CcBreakdown[]
  userName: string
  prevYearTotalIncome: number
  prevYearTotalExpenses: number
}

const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']

function fmtK(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} mln`
  if (abs >= 1_000) return `${Math.round(n / 1_000)} k`
  return n.toLocaleString('pl-PL')
}

function fmtHero(n: number): { main: string; decimal: string } {
  const formatted = Math.abs(Math.round(n)).toLocaleString('pl-PL')
  return { main: (n < 0 ? '-' : '') + formatted, decimal: ',00' }
}
function pickHeroValue(real: number, plan: number): { value: number; isPlan: boolean } {
  return real > 0 ? { value: real, isPlan: false } : { value: plan, isPlan: plan > 0 }
}
function netClass(n: number) {
  return n > 0 ? 'text-green-600' : n < 0 ? 'text-red-500' : 'text-gray-400'
}
function pctClass(p: number | null, invert = false) {
  if (p === null) return 'text-gray-400'
  const good = invert ? p <= 100 : p >= 100
  return good ? 'text-green-600' : p >= 80 ? 'text-amber-500' : 'text-red-500'
}
function pct(real: number, plan: number): number | null {
  return plan > 0 ? (real / plan) * 100 : null
}
function fmtPct(p: number | null) {
  return p === null ? '—' : `${Math.round(p)}%`
}

export function DashboardView({
  year,
  currentMonth,
  planIncomeByMonth,
  realIncomeByMonth,
  planExpensesByMonth,
  realExpensesByMonth,
  fixedCostsByMonth,
  variableCostsByMonth,
  ccBreakdown,
  userName,
  prevYearTotalIncome,
  prevYearTotalExpenses,
}: DashboardViewProps) {
  const router = useRouter()

  // Auto-refresh every 5 minutes without full page reload
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 300_000)
    return () => clearInterval(id)
  }, [router])

  // Annuals
  const totalPlanIncome   = planIncomeByMonth.reduce((s, v) => s + v, 0)
  const totalRealIncome   = realIncomeByMonth.reduce((s, v) => s + v, 0)
  const totalPlanExpenses = planExpensesByMonth.reduce((s, v) => s + v, 0)
  const totalRealExpenses = realExpensesByMonth.reduce((s, v) => s + v, 0)
  const totalRealNet      = totalRealIncome - totalRealExpenses
  const totalPlanNet      = totalPlanIncome - totalPlanExpenses

  // Current month (currentMonth is 1-based)
  const cmIdx = currentMonth - 1
  const cmPlanIncome   = planIncomeByMonth[cmIdx] ?? 0
  const cmRealIncome   = realIncomeByMonth[cmIdx] ?? 0
  const cmPlanExpenses = planExpensesByMonth[cmIdx] ?? 0
  const cmRealExpenses = realExpensesByMonth[cmIdx] ?? 0
  const cmNet          = cmRealIncome - cmRealExpenses

  // BEP — current month
  const cmFc  = fixedCostsByMonth[cmIdx] ?? 0
  const cmVc  = variableCostsByMonth[cmIdx] ?? 0
  const cmBep = calcBep(cmFc, cmVc, cmRealIncome)

  // BEP — YTD (months 0..cmIdx inclusive)
  const ytdFc  = fixedCostsByMonth.slice(0, currentMonth).reduce((s, v) => s + v, 0)
  const ytdVc  = variableCostsByMonth.slice(0, currentMonth).reduce((s, v) => s + v, 0)
  const ytdRev = realIncomeByMonth.slice(0, currentMonth).reduce((s, v) => s + v, 0)
  const ytdBep = calcBep(ytdFc, ytdVc, ytdRev)

  const incomeExec = pct(totalRealIncome, totalPlanIncome)

  // Chart: monthly net (real)
  const netChartData = MONTHS.map((m, i) => ({
    month: m,
    planIncome: planIncomeByMonth[i],
    realIncome: realIncomeByMonth[i],
    planExpenses: planExpensesByMonth[i],
    realExpenses: realExpensesByMonth[i],
  }))

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-extrabold tracking-tight" style={{ fontSize: '1.75rem', color: 'var(--wd-dark)' }}>
            Dzień dobry{userName ? `, ${userName.split(' ')[0]}` : ''}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--wd-text-muted)' }}>
            {MONTHS[cmIdx]} {year} — podsumowanie roku
          </p>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <button
            onClick={() => router.push(`/dashboard?year=${year - 1}`)}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
            style={{ color: 'var(--wd-text-muted)' }}
          >
            ‹
          </button>
          <span className="font-semibold px-2 text-sm" style={{ color: 'var(--wd-dark)' }}>{year}</span>
          <button
            onClick={() => router.push(`/dashboard?year=${year + 1}`)}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
            style={{ color: 'var(--wd-text-muted)' }}
          >
            ›
          </button>
        </div>
      </div>

      {/* ── Annual KPI cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        {/* Przychody */}
        {(() => { const hero = pickHeroValue(totalRealIncome, totalPlanIncome); const h = fmtHero(hero.value); return (
        <div className="rounded-2xl bg-white p-6 flex flex-col gap-2" style={{ boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2">
            <p className="data-label">Przychody {year}</p>
            {hero.isPlan && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--wd-surface-2)', color: 'var(--wd-text-muted)' }}>PLAN</span>
            )}
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="num" style={{ fontSize: '1.875rem', fontWeight: 700, lineHeight: 1, color: 'var(--wd-dark)' }}>{h.main}</span>
            <span className="num" style={{ fontSize: '1rem', color: 'var(--wd-text-muted)' }}>{h.decimal}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
              {hero.isPlan ? `Real: ${fmtK(totalRealIncome)}` : `Plan: ${fmtK(totalPlanIncome)}`}
            </span>
            <span className={`text-xs font-semibold ${pctClass(incomeExec)}`}>{fmtPct(incomeExec)}</span>
          </div>
          {!hero.isPlan && prevYearTotalIncome > 0 && (
            <div className="flex items-center gap-1 pt-2 border-t" style={{ borderColor: 'var(--wd-border)' }}>
              <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>vs {year - 1}: {fmtK(prevYearTotalIncome)}</span>
              <span className={`text-xs font-semibold ${netClass(hero.value - prevYearTotalIncome)}`}>
                {hero.value >= prevYearTotalIncome ? '+' : ''}{fmtK(hero.value - prevYearTotalIncome)}
              </span>
            </div>
          )}
        </div>
        )})()}

        {/* Koszty */}
        {(() => { const hero = pickHeroValue(totalRealExpenses, totalPlanExpenses); const h = fmtHero(hero.value); return (
        <div className="rounded-2xl bg-white p-6 flex flex-col gap-2" style={{ boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2">
            <p className="data-label">Koszty {year}</p>
            {hero.isPlan && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--wd-surface-2)', color: 'var(--wd-text-muted)' }}>PLAN</span>
            )}
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="num" style={{ fontSize: '1.875rem', fontWeight: 700, lineHeight: 1, color: 'var(--wd-dark)' }}>{h.main}</span>
            <span className="num" style={{ fontSize: '1rem', color: 'var(--wd-text-muted)' }}>{h.decimal}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
              {hero.isPlan ? `Real: ${fmtK(totalRealExpenses)}` : `Budżet: ${fmtK(totalPlanExpenses)}`}
            </span>
            <span className={`text-xs font-semibold ${pctClass(pct(totalRealExpenses, totalPlanExpenses), true)}`}>
              {fmtPct(pct(totalRealExpenses, totalPlanExpenses))}
            </span>
          </div>
          {!hero.isPlan && prevYearTotalExpenses > 0 && (
            <div className="flex items-center gap-1 pt-2 border-t" style={{ borderColor: 'var(--wd-border)' }}>
              <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>vs {year - 1}: {fmtK(prevYearTotalExpenses)}</span>
              <span className={`text-xs font-semibold ${netClass(prevYearTotalExpenses - hero.value)}`}>
                {hero.value <= prevYearTotalExpenses ? '+' : ''}{fmtK(prevYearTotalExpenses - hero.value)}
              </span>
            </div>
          )}
        </div>
        )})()}

        {/* Zysk netto */}
        {(() => {
          const noActuals = totalRealIncome === 0 && totalPlanIncome > 0
          const netValue = noActuals ? totalPlanNet : totalRealNet
          const h = fmtHero(netValue)
          return (
          <div className="rounded-2xl bg-white p-6 flex flex-col gap-2" style={{ boxShadow: 'var(--card-shadow)' }}>
            <div className="flex items-center gap-2">
              <p className="data-label">Zysk netto {year}</p>
              {noActuals && (
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--wd-surface-2)', color: 'var(--wd-text-muted)' }}>PLAN</span>
              )}
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className={`num ${netClass(netValue)}`} style={{ fontSize: '1.875rem', fontWeight: 700, lineHeight: 1 }}>{h.main}</span>
              <span className="num" style={{ fontSize: '1rem', color: 'var(--wd-text-muted)' }}>{h.decimal}</span>
            </div>
            <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>
              {noActuals ? `Real: ${fmtK(totalRealNet)}` : `Plan: ${fmtK(totalPlanNet)}`}
            </span>
          </div>
        )})()}

        {/* Bieżący miesiąc */}
        {(() => { const h = fmtHero(cmNet); return (
        <div className="rounded-2xl bg-white p-6 flex flex-col gap-2" style={{ boxShadow: 'var(--card-shadow)' }}>
          <p className="data-label">{MONTHS[cmIdx]} — bieżący mies.</p>
          <div className="flex items-baseline gap-0.5">
            <span className={`num ${netClass(cmNet)}`} style={{ fontSize: '1.875rem', fontWeight: 700, lineHeight: 1 }}>{h.main}</span>
            <span className="num" style={{ fontSize: '1rem', color: 'var(--wd-text-muted)' }}>{h.decimal}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>P: {fmtK(cmRealIncome)}</span>
            <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>K: {fmtK(cmRealExpenses)}</span>
          </div>
        </div>
        )})()}

        {/* BEP */}
        <div className="rounded-2xl bg-white p-6 flex flex-col gap-2" style={{ boxShadow: 'var(--card-shadow)' }}>
          <p className="data-label">BEP — {MONTHS[cmIdx]} {year}</p>
          {cmBep === null ? (
            <span className="num" style={{ fontSize: '1.875rem', fontWeight: 700, lineHeight: 1, color: 'var(--wd-text-muted)' }}>—</span>
          ) : (() => { const h = fmtHero(cmBep); return (
            <div className="flex items-baseline gap-2">
              <div className="flex items-baseline gap-0.5">
                <span className="num" style={{ fontSize: '1.875rem', fontWeight: 700, lineHeight: 1, color: 'var(--wd-dark)' }}>{h.main}</span>
                <span className="num" style={{ fontSize: '1rem', color: 'var(--wd-text-muted)' }}>{h.decimal}</span>
              </div>
              {cmRealIncome >= cmBep ? (
                <span className="text-xs font-semibold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                  OSIĄGNIĘTY
                </span>
              ) : (
                <span className="text-xs font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                  PONIŻEJ
                </span>
              )}
            </div>
          )})()}
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>FC: {fmtK(cmFc)}</span>
            <span className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>Przych: {fmtK(cmRealIncome)}</span>
          </div>
          <div className="pt-2 border-t" style={{ borderColor: 'var(--wd-border)' }}>
            {ytdBep === null ? (
              <p className="text-xs" style={{ color: 'var(--wd-text-muted)' }}>YTD: —</p>
            ) : (
              <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                <span>YTD: {fmtK(ytdRev)} / {fmtK(ytdBep)}</span>
                <span className={netClass(ytdRev - ytdBep)}>
                  [{ytdRev >= ytdBep ? '+' : ''}{fmtK(ytdRev - ytdBep)}]
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Chart ────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-5 mb-6" style={{ boxShadow: 'var(--card-shadow)' }}>
        <p className="data-label mb-4">Przychody vs Koszty — {year}</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={netChartData} barCategoryGap="25%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--wd-border)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: 'var(--font-jakarta)' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fontFamily: 'var(--font-jakarta)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => fmtK(v as number)}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  planIncome: 'Plan przychody',
                  realIncome: 'Real przychody',
                  planExpenses: 'Plan koszty',
                  realExpenses: 'Real koszty',
                }
                return [value.toLocaleString('pl-PL') + ' zł', labels[name] ?? name]
              }}
              contentStyle={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              cursor={{ fill: 'var(--wd-surface-2)' }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-jakarta)' }}
              formatter={(v) => {
                const labels: Record<string, string> = {
                  planIncome: 'Plan przychody',
                  realIncome: 'Real przychody',
                  planExpenses: 'Plan koszty',
                  realExpenses: 'Real koszty',
                }
                return labels[v] ?? v
              }}
            />
            <Bar dataKey="planIncome"   fill="#DDD9D3" radius={[3, 3, 0, 0]} name="planIncome" />
            <Bar dataKey="realIncome"   fill="#2A7D4F" radius={[3, 3, 0, 0]} name="realIncome" />
            <Bar dataKey="planExpenses" fill="#E8E4E0" radius={[3, 3, 0, 0]} name="planExpenses" />
            <Bar dataKey="realExpenses" fill="#B54A20" radius={[3, 3, 0, 0]} name="realExpenses" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Cost center breakdown ────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white overflow-hidden" style={{ boxShadow: 'var(--card-shadow)' }}>
        <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--wd-border)' }}>
          <p className="data-label">Centra kosztów — {year}</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}>
              <th className="text-left px-5 py-2.5 data-label">Lokal</th>
              <th className="text-right px-4 py-2.5 data-label">Plan przych.</th>
              <th className="text-right px-4 py-2.5 data-label">Real przych.</th>
              <th className="text-right px-4 py-2.5 data-label">%</th>
              <th className="text-right px-4 py-2.5 data-label">Plan koszty</th>
              <th className="text-right px-4 py-2.5 data-label">Real koszty</th>
              <th className="text-right px-5 py-2.5 data-label">Netto</th>
            </tr>
          </thead>
          <tbody>
            {ccBreakdown.map(({ cc, planIncome, realIncome, planExpenses, realExpenses }) => {
              const net = realIncome - realExpenses
              const exec = pct(realIncome, planIncome)
              return (
                <tr key={cc} className="border-t hover:bg-gray-50/50" style={{ borderColor: 'var(--wd-border)' }}>
                  <td className="px-5 py-2.5 font-semibold" style={{ color: 'var(--wd-dark)' }}>{cc}</td>
                  <td className="text-right px-4 py-2.5 num text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                    {fmtK(planIncome)}
                  </td>
                  <td className="text-right px-4 py-2.5 num text-xs font-medium" style={{ color: 'var(--wd-dark)' }}>
                    {fmtK(realIncome)}
                  </td>
                  <td className={`text-right px-4 py-2.5 num text-xs font-semibold ${pctClass(exec)}`}>
                    {fmtPct(exec)}
                  </td>
                  <td className="text-right px-4 py-2.5 num text-xs" style={{ color: 'var(--wd-text-muted)' }}>
                    {fmtK(planExpenses)}
                  </td>
                  <td className="text-right px-4 py-2.5 num text-xs font-medium" style={{ color: 'var(--wd-dark)' }}>
                    {fmtK(realExpenses)}
                  </td>
                  <td className={`text-right px-5 py-2.5 num text-xs font-bold ${netClass(net)}`}>
                    {fmtK(net)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
