'use client'

import { useEffect, useState } from 'react'

interface BreakEvenViewProps {
  initialReport?: BreakEvenReport | null
}

interface BreakEvenReport {
  warningAmount: number
  byCostCenter: Record<string, {
    revenue: number
    fixedCosts: number
    variableCosts: number
    cogs: number
    contributionMargin: number | null
    breakEvenTurnover: number | null
    delta: number | null
    warning: string | null
  }>
}

function money(value: number | null) {
  if (value == null) return '-'
  return `${Math.round(value * 100) / 100}`.replace('.', ',') + ' PLN'
}

export function BreakEvenView({ initialReport = null }: BreakEvenViewProps) {
  const [report, setReport] = useState<BreakEvenReport | null>(initialReport)

  useEffect(() => {
    if (report) return
    fetch('/api/finance/break-even')
      .then((response) => response.json())
      .then((data) => setReport(data.report))
      .catch(() => setReport(null))
  }, [report])

  return (
    <div className="space-y-4">
      <div>
        <p className="data-label">Break-even</p>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>Rentowność salonów</h1>
      </div>

      {!report ? (
        <div className="rounded-lg border border-[var(--wd-border)] bg-white p-4 text-sm">Ładuję raport...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(report.byCostCenter).map(([center, row]) => (
              <section key={center} className="rounded-lg border border-[var(--wd-border)] bg-white p-4">
                <h2 className="mb-3 text-base font-semibold">{center}</h2>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="data-label">Przychód</p><p className="num font-semibold">{money(row.revenue)}</p></div>
                  <div><p className="data-label">Fixed</p><p className="num font-semibold">{money(row.fixedCosts)}</p></div>
                  <div><p className="data-label">Variable</p><p className="num font-semibold">{money(row.variableCosts)}</p></div>
                  <div><p className="data-label">COGS</p><p className="num font-semibold">{money(row.cogs)}</p></div>
                  <div><p className="data-label">Break-even</p><p className="num font-semibold">{money(row.breakEvenTurnover)}</p></div>
                  <div><p className="data-label">Delta</p><p className="num font-semibold">{money(row.delta)}</p></div>
                </div>
                {row.warning && <p className="mt-3 text-xs font-semibold text-amber-700">{row.warning}</p>}
              </section>
            ))}
          </div>
          <section className="rounded-lg border border-amber-100 bg-amber-50 p-4">
            <p className="data-label">Koszty oczekujące / niepewne</p>
            <p className="num text-sm font-semibold">{money(report.warningAmount)}</p>
          </section>
        </>
      )}
    </div>
  )
}
