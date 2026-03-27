'use client'
import { useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import React from 'react'
import { BudgetCell, NavDirection } from '@/components/shared/budget-cell'

const MONTH_NAMES = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień']

interface SubCategory {
  id: string
  name: string
  order: number
  categoryId: string
}

interface Category {
  id: string
  name: string
  subCategories: SubCategory[]
}

interface ActualsGridProps {
  categories: Category[]
  budgetEntries: Record<string, number>
  initialActuals: Record<string, number>
  year: number
  costCenterId: string
  editable: boolean
  /** Base path for year/CC navigation. Defaults to '/finance/actuals'. */
  basePath?: string
}

type ActiveCell = { subId: string; month: number } | null

const MONTHS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru']

export function ActualsGrid({
  categories,
  budgetEntries,
  initialActuals,
  year,
  costCenterId,
  editable,
  basePath,
}: ActualsGridProps) {
  const navBase = basePath ?? '/finance/actuals'
  const navSep = navBase.includes('?') ? '&' : '?'
  const [actuals, setActuals] = useState<Record<string, number>>(initialActuals)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeCell, setActiveCell] = useState<ActiveCell>(null)
  const [copyingMonth, setCopyingMonth] = useState(false)

  const router = useRouter()

  const allSubCategories = useMemo(
    () => categories.flatMap((cat) => cat.subCategories),
    [categories]
  )

  const getPlan = (subId: string, month: number) => budgetEntries[`${subId}_${month}`] ?? 0
  const getReal = (subId: string, month: number) => actuals[`${subId}_${month}`] ?? 0

  const rowPlanSum = (subId: string) =>
    MONTHS.reduce((sum, _, i) => sum + getPlan(subId, i + 1), 0)

  const rowRealSum = (subId: string) =>
    MONTHS.reduce((sum, _, i) => sum + getReal(subId, i + 1), 0)

  const rowPct = (subId: string): number | null => {
    const plan = rowPlanSum(subId)
    return plan > 0 ? (rowRealSum(subId) / plan) * 100 : null
  }

  const colPlanSum = (month: number) =>
    allSubCategories.reduce((sum, sub) => sum + getPlan(sub.id, month), 0)

  const colRealSum = (month: number) =>
    allSubCategories.reduce((sum, sub) => sum + getReal(sub.id, month), 0)

  const colPct = (month: number): number | null => {
    const plan = colPlanSum(month)
    return plan > 0 ? (colRealSum(month) / plan) * 100 : null
  }

  const grandPlanSum = MONTHS.reduce((sum, _, i) => sum + colPlanSum(i + 1), 0)
  const grandRealSum = MONTHS.reduce((sum, _, i) => sum + colRealSum(i + 1), 0)
  const grandPct: number | null = grandPlanSum > 0 ? (grandRealSum / grandPlanSum) * 100 : null

  const fmt = (n: number) => (n === 0 ? '—' : n.toLocaleString('pl-PL'))

  const fmtPct = (pct: number | null) => (pct === null ? '—' : `${Math.round(pct)}%`)

  const pctClass = (pct: number | null) =>
    pct === null
      ? 'text-gray-300'
      : pct >= 100
        ? 'text-green-600'
        : pct >= 80
          ? 'text-amber-500'
          : 'text-red-500'

  const visibleSubIds = useMemo(() => {
    const result: string[] = []
    for (const cat of categories) {
      if (!collapsed[cat.id]) {
        for (const sub of cat.subCategories) {
          result.push(sub.id)
        }
      }
    }
    return result
  }, [categories, collapsed])

  const onSave = useCallback(
    async (subCategoryId: string, month: number, amount: number) => {
      const res = await fetch('/api/actuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, costCenterId, subCategoryId, amount }),
      })
      if (res.ok) {
        setActuals((prev) => ({ ...prev, [`${subCategoryId}_${month}`]: amount }))
      }
    },
    [year, costCenterId]
  )

  const handleNavigate = useCallback(
    (subId: string, month: number, dir: NavDirection) => {
      const rowIdx = visibleSubIds.indexOf(subId)
      let newSubId = subId
      let newMonth = month

      switch (dir) {
        case 'right':
          if (month < 12) {
            newMonth = month + 1
          } else if (rowIdx < visibleSubIds.length - 1) {
            newSubId = visibleSubIds[rowIdx + 1]
            newMonth = 1
          }
          break
        case 'left':
          if (month > 1) {
            newMonth = month - 1
          } else if (rowIdx > 0) {
            newSubId = visibleSubIds[rowIdx - 1]
            newMonth = 12
          }
          break
        case 'down':
          if (rowIdx < visibleSubIds.length - 1) {
            newSubId = visibleSubIds[rowIdx + 1]
          }
          break
        case 'up':
          if (rowIdx > 0) {
            newSubId = visibleSubIds[rowIdx - 1]
          }
          break
      }

      setActiveCell({ subId: newSubId, month: newMonth })
    },
    [visibleSubIds]
  )

  const handleYearChange = (newYear: number) => {
    router.push(`${navBase}${navSep}year=${newYear}&costCenterId=${costCenterId}`)
  }

  const handleCostCenterChange = (newCostCenter: string) => {
    router.push(`${navBase}${navSep}year=${year}&costCenterId=${newCostCenter}`)
  }

  const handleCopyPrevMonth = useCallback(async () => {
    if (costCenterId === 'GLOBAL') return
    const monthInput = window.prompt('Kopiuj dane z poprzedniego miesiąca do miesiąca (1-12):', String(new Date().getMonth() + 1))
    if (!monthInput) return
    const month = parseInt(monthInput, 10)
    if (isNaN(month) || month < 1 || month > 12) return

    const prevM = month === 1 ? 12 : month - 1
    const prevY = month === 1 ? year - 1 : year
    const prevLabel = MONTH_NAMES[prevM - 1]

    if (!window.confirm(`Skopiować dane z ${prevLabel} ${prevY} do miesiąca ${month}/${year} dla ${costCenterId}?`)) return

    setCopyingMonth(true)
    try {
      const params = new URLSearchParams({ type: 'actuals', year: String(year), month: String(month), costCenterId })
      const res = await fetch(`/api/copy-previous-month?${params}`)
      const data = await res.json()
      if (data.copied > 0) {
        window.location.reload()
      } else {
        window.alert(`Brak danych w ${prevLabel} ${prevY} do skopiowania.`)
      }
    } finally {
      setCopyingMonth(false)
    }
  }, [year, costCenterId])

  const planCellClass = 'text-right num text-xs px-1 py-2.5 border-r' +
    ' bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)]' +
    ' border-[var(--wd-border)]'

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Wykonanie
          </h1>
          <div className="flex items-center gap-1">
            <button onClick={() => handleYearChange(year - 1)} className="p-1 hover:bg-gray-100 rounded">
              ‹
            </button>
            <span className="font-medium px-2">{year}</span>
            <button onClick={() => handleYearChange(year + 1)} className="p-1 hover:bg-gray-100 rounded">
              ›
            </button>
          </div>
          {editable && costCenterId !== 'GLOBAL' && (
            <button
              onClick={handleCopyPrevMonth}
              disabled={copyingMonth}
              title="Skopiuj dane z poprzedniego miesiąca"
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 disabled:opacity-50 transition-colors"
            >
              {copyingMonth ? (
                <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
              Kopiuj M-1
            </button>
          )}
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
            {/* Row 1: month group headers */}
            <tr className="border-b" style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}>
              <th rowSpan={2} className="text-left px-3 py-2.5 data-label border-r align-bottom" style={{ borderColor: 'var(--wd-border)' }}>
                Podkategoria
              </th>
              {MONTHS.map((m) => (
                <th key={m} colSpan={2} className="text-center px-1 py-1 data-label border-r" style={{ borderColor: 'var(--wd-border)' }}>
                  {m}
                </th>
              ))}
              <th colSpan={2} className="text-center px-1 py-1 data-label border-r" style={{ borderColor: 'var(--wd-border)' }}>
                SUMA rok
              </th>
              <th rowSpan={2} className="text-center px-1 py-2.5 data-label align-bottom">
                %
              </th>
            </tr>
            {/* Row 2: Plan / Real sub-headers */}
            <tr className="border-b" style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}>
              {MONTHS.map((m) => (
                <React.Fragment key={m}>
                  <th className="text-center py-1 data-label border-r" style={{ background: 'color-mix(in srgb, var(--wd-surface-2) 80%, transparent)', borderColor: 'var(--wd-border)' }}>
                    P
                  </th>
                  <th className="text-center py-1 data-label border-r" style={{ borderColor: 'var(--wd-border)' }}>
                    R
                  </th>
                </React.Fragment>
              ))}
              <th className="text-center py-1 data-label border-r" style={{ background: 'color-mix(in srgb, var(--wd-surface-2) 80%, transparent)', borderColor: 'var(--wd-border)' }}>
                P
              </th>
              <th className="text-center py-1 data-label border-r" style={{ borderColor: 'var(--wd-border)' }}>
                R
              </th>
            </tr>
          </thead>

          <tbody>
            {categories.map((cat) => (
              <React.Fragment key={cat.id}>
                {/* Category header row */}
                <tr
                  className="border-t cursor-pointer select-none"
                  style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}
                  onClick={() => setCollapsed((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                >
                  <td
                    className="px-3 py-2 font-semibold"
                    style={{ color: 'var(--wd-text-primary)', borderLeft: '2px solid var(--wd-sand)' }}
                    colSpan={28}
                  >
                    <div className="flex items-center justify-between">
                      <span>
                        <span className="mr-1 text-xs">{collapsed[cat.id] ? '▶' : '▼'}</span>
                        {cat.name}
                      </span>
                      {(() => {
                        const catPlan = cat.subCategories.reduce(
                          (sum, sub) => sum + MONTHS.reduce((s, _, i) => s + getPlan(sub.id, i + 1), 0),
                          0
                        )
                        const catReal = cat.subCategories.reduce(
                          (sum, sub) => sum + MONTHS.reduce((s, _, i) => s + getReal(sub.id, i + 1), 0),
                          0
                        )
                        const catPct = catPlan > 0 ? (catReal / catPlan) * 100 : null
                        const badgeClass =
                          catPct === null
                            ? 'bg-gray-100 text-gray-400'
                            : catPct >= 100
                              ? 'bg-green-100 text-green-700'
                              : catPct >= 80
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-600'
                        return (
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${badgeClass}`}>
                            {catPct === null ? '—' : `${Math.round(catPct)}%`}
                          </span>
                        )
                      })()}
                    </div>
                  </td>
                </tr>

                {/* Subcategory rows */}
                {!collapsed[cat.id] &&
                  cat.subCategories.map((sub, subIdx) => (
                    <tr
                      key={sub.id}
                      className="border-t"
                      style={{
                        borderColor: 'var(--wd-border)',
                        background: subIdx % 2 === 1 ? 'color-mix(in srgb, var(--wd-surface-2) 50%, transparent)' : undefined,
                      }}
                    >
                      <td className="px-3 py-2.5 pl-6 text-sm border-r truncate" style={{ color: '#4B4846', borderColor: 'var(--wd-border)' }}>
                        {sub.name}
                      </td>

                      {MONTHS.map((_, i) => {
                        const month = i + 1
                        const planVal = getPlan(sub.id, month)
                        return (
                          <React.Fragment key={i}>
                            <td className={planCellClass}>
                              {planVal === 0 ? '—' : planVal.toLocaleString('pl-PL')}
                            </td>
                            <BudgetCell
                              value={getReal(sub.id, month)}
                              editable={editable}
                              isEditing={
                                editable &&
                                activeCell?.subId === sub.id &&
                                activeCell?.month === month
                              }
                              onActivate={() => setActiveCell({ subId: sub.id, month })}
                              onDeactivate={() => setActiveCell(null)}
                              onNavigate={(dir) => handleNavigate(sub.id, month, dir)}
                              onSave={(v) => onSave(sub.id, month, v)}
                            />
                          </React.Fragment>
                        )
                      })}

                      {/* SUMA Plan */}
                      <td className="text-right px-1 py-2.5 num text-xs border-l" style={{ color: 'var(--wd-text-muted)', background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}>
                        {fmt(rowPlanSum(sub.id))}
                      </td>
                      {/* SUMA Real */}
                      <td className="text-right px-2 py-2.5 num text-sm font-medium border-r" style={{ color: 'var(--wd-dark)', borderColor: 'var(--wd-border)' }}>
                        {fmt(rowRealSum(sub.id))}
                      </td>
                      {/* % */}
                      <td className={`text-right px-2 py-2.5 num text-sm font-semibold ${pctClass(rowPct(sub.id))}`}>
                        {fmtPct(rowPct(sub.id))}
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>

          <tfoot>
            {/* SUMA row */}
            <tr className="font-semibold" style={{ borderTop: '2px solid var(--wd-border)', background: 'var(--wd-surface-2)' }}>
              <td className="px-3 py-2.5 data-label border-r" style={{ color: 'var(--wd-dark)', borderColor: 'var(--wd-border)' }}>SUMA</td>
              {MONTHS.map((_, i) => {
                const month = i + 1
                return (
                  <React.Fragment key={i}>
                    <td className="text-right px-1 py-2.5 num text-xs border-r" style={{ color: 'var(--wd-text-muted)', background: 'color-mix(in srgb, var(--wd-surface-2) 80%, transparent)', borderColor: 'var(--wd-border)' }}>
                      {fmt(colPlanSum(month))}
                    </td>
                    <td className="text-right px-2 py-2.5 num text-sm border-r" style={{ color: 'var(--wd-dark)', borderColor: 'var(--wd-border)' }}>
                      {fmt(colRealSum(month))}
                    </td>
                  </React.Fragment>
                )
              })}
              <td className="text-right px-1 py-2.5 num text-xs border-l" style={{ color: 'var(--wd-text-muted)', background: 'color-mix(in srgb, var(--wd-surface-2) 80%, transparent)', borderColor: 'var(--wd-border)' }}>
                {fmt(grandPlanSum)}
              </td>
              <td className="text-right px-2 py-2.5 num text-sm border-r" style={{ color: 'var(--wd-dark)', borderColor: 'var(--wd-border)' }}>
                {fmt(grandRealSum)}
              </td>
              <td className={`text-right px-2 py-2.5 num text-sm font-semibold ${pctClass(grandPct)}`}>
                {fmtPct(grandPct)}
              </td>
            </tr>

            {/* % wykonania row */}
            <tr className="border-t" style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}>
              <td className="px-3 py-1.5 data-label border-r" style={{ borderColor: 'var(--wd-border)' }}>% wykonania</td>
              {MONTHS.map((_, i) => {
                const month = i + 1
                const pct = colPct(month)
                return (
                  <React.Fragment key={i}>
                    <td className={`text-right px-1 py-1.5 num text-sm font-semibold border-r ${pctClass(pct)}`} style={{ borderColor: 'var(--wd-border)' }}>
                      {fmtPct(pct)}
                    </td>
                    <td className="border-r" style={{ borderColor: 'var(--wd-border)' }} />
                  </React.Fragment>
                )
              })}
              <td className="border-l" style={{ borderColor: 'var(--wd-border)' }} />
              <td className="border-r" style={{ borderColor: 'var(--wd-border)' }} />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
