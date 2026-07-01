'use client'
import { useState, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import React from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { BudgetCell, NavDirection } from '@/components/shared/budget-cell'
import { BudgetCharts } from '@/components/shared/budget-charts'
import { SortableRow, DragHandle } from '@/components/shared/sortable-row'

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

interface BudgetGridProps {
  categories: Category[]
  initialEntries: Record<string, number>
  year: number
  costCenterId: string
  editable: boolean
  canManage: boolean
  revenueByMonth?: number[]
}

type ActiveCell = { subId: string; month: number } | null

const MONTHS = ['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru']

export function BudgetGrid({
  categories,
  initialEntries,
  year,
  costCenterId,
  editable,
  canManage,
  revenueByMonth = new Array(12).fill(0) as number[],
}: BudgetGridProps) {
  const [entries, setEntries] = useState<Record<string, number>>(initialEntries)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeCell, setActiveCell] = useState<ActiveCell>(null)
  const [localCategories, setLocalCategories] = useState<Category[]>(categories)
  const [editingSubId, setEditingSubId] = useState<string | null>(null)
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [addingToCatId, setAddingToCatId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [copyingMonth, setCopyingMonth] = useState(false)

  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameCatInputRef = useRef<HTMLInputElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)

  const router = useRouter()

  const getEntry = (subCategoryId: string, month: number) =>
    entries[`${subCategoryId}_${month}`] ?? 0

  const rowSum = (subCategoryId: string) =>
    MONTHS.reduce((sum, _, i) => sum + getEntry(subCategoryId, i + 1), 0)

  const colSum = (month: number) => {
    let sum = 0
    for (const cat of localCategories) {
      for (const sub of cat.subCategories) {
        sum += getEntry(sub.id, month)
      }
    }
    return sum
  }

  const grandTotal = MONTHS.reduce((sum, _, i) => sum + colSum(i + 1), 0)

  const visibleSubIds = useMemo(() => {
    const result: string[] = []
    for (const cat of localCategories) {
      if (!collapsed[cat.id]) {
        for (const sub of cat.subCategories) {
          result.push(sub.id)
        }
      }
    }
    return result
  }, [localCategories, collapsed])

  const onSave = useCallback(
    async (subCategoryId: string, month: number, amount: number) => {
      const res = await fetch('/api/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, costCenterId, subCategoryId, amount }),
      })
      if (res.ok) {
        setEntries(prev => ({ ...prev, [`${subCategoryId}_${month}`]: amount }))
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
          if (month < 12) { newMonth = month + 1 }
          else if (rowIdx < visibleSubIds.length - 1) { newSubId = visibleSubIds[rowIdx + 1]; newMonth = 1 }
          break
        case 'left':
          if (month > 1) { newMonth = month - 1 }
          else if (rowIdx > 0) { newSubId = visibleSubIds[rowIdx - 1]; newMonth = 12 }
          break
        case 'down':
          if (rowIdx < visibleSubIds.length - 1) { newSubId = visibleSubIds[rowIdx + 1] }
          break
        case 'up':
          if (rowIdx > 0) { newSubId = visibleSubIds[rowIdx - 1] }
          break
      }

      setActiveCell({ subId: newSubId, month: newMonth })
    },
    [visibleSubIds]
  )

  const handleRename = async (subId: string) => {
    const name = renameInputRef.current?.value.trim()
    if (!name) { setEditingSubId(null); return }

    const res = await fetch(`/api/subcategories/${subId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    if (res.ok) {
      setLocalCategories(prev => prev.map(cat => ({
        ...cat,
        subCategories: cat.subCategories.map(sub =>
          sub.id === subId ? { ...sub, name } : sub
        ),
      })))
    }
    setEditingSubId(null)
  }

  const handleAdd = async (catId: string) => {
    const name = addInputRef.current?.value.trim()
    if (!name) { setAddingToCatId(null); return }

    const res = await fetch('/api/subcategories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId: catId, name }),
    })

    if (res.ok) {
      const newSub: SubCategory = await res.json()
      setLocalCategories(prev => prev.map(cat =>
        cat.id === catId
          ? { ...cat, subCategories: [...cat.subCategories, newSub] }
          : cat
      ))
    }
    setAddingToCatId(null)
  }

  const handleDelete = async (subId: string, subName: string) => {
    if (!window.confirm(`Usunąć podkategorię "${subName}"?`)) return
    setDeleteError(null)

    const res = await fetch(`/api/subcategories/${subId}`, { method: 'DELETE' })

    if (res.ok) {
      setLocalCategories(prev => prev.map(cat => ({
        ...cat,
        subCategories: cat.subCategories.filter(sub => sub.id !== subId),
      })))
    } else {
      const body = await res.json()
      setDeleteError(body.error ?? 'Błąd podczas usuwania.')
    }
  }

  const handleRenameCategory = async (catId: string) => {
    const name = renameCatInputRef.current?.value.trim()
    if (!name) { setEditingCatId(null); return }

    const res = await fetch(`/api/categories/${catId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    if (res.ok) {
      setLocalCategories(prev => prev.map(cat =>
        cat.id === catId ? { ...cat, name } : cat
      ))
    }
    setEditingCatId(null)
  }

  const handleDeleteCategory = async (catId: string, catName: string) => {
    if (!window.confirm(`Usunąć kategorię "${catName}" wraz ze wszystkimi podkategoriami?`)) return
    setDeleteError(null)

    const res = await fetch(`/api/categories/${catId}`, { method: 'DELETE' })

    if (res.ok) {
      setLocalCategories(prev => prev.filter(cat => cat.id !== catId))
    } else {
      const body = await res.json()
      setDeleteError(body.error ?? 'Błąd podczas usuwania kategorii.')
    }
  }

  const handleYearChange = (newYear: number) => {
    router.push(`/finance/assumptions?year=${newYear}&costCenterId=${costCenterId}`)
  }

  const handleCostCenterChange = (newCostCenter: string) => {
    router.push(`/finance/assumptions?year=${year}&costCenterId=${newCostCenter}`)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback((event: DragEndEvent, catId: string) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    setLocalCategories(prev => {
      const catIdx = prev.findIndex(c => c.id === catId)
      if (catIdx === -1) return prev
      const cat = prev[catIdx]
      const oldIdx = cat.subCategories.findIndex(s => s.id === active.id)
      const newIdx = cat.subCategories.findIndex(s => s.id === over.id)
      if (oldIdx === -1 || newIdx === -1) return prev
      const newSubs = arrayMove(cat.subCategories, oldIdx, newIdx)
      fetch('/api/subcategories/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: newSubs.map((s, i) => ({ id: s.id, order: i })) }),
      })
      return prev.map((c, i) => i === catIdx ? { ...c, subCategories: newSubs } : c)
    })
  }, [])

  const handleCopyPrevMonth = useCallback(async () => {
    if (costCenterId === 'GLOBAL') return
    const monthInput = window.prompt('Kopiuj dane z poprzedniego miesiąca do miesiąca (1-12):', String(new Date().getMonth() + 1))
    if (!monthInput) return
    const month = parseInt(monthInput, 10)
    if (isNaN(month) || month < 1 || month > 12) return

    const prevM = month === 1 ? 12 : month - 1
    const prevY = month === 1 ? year - 1 : year
    const prevLabel = MONTH_NAMES[prevM - 1]

    if (!window.confirm(`Skopiować założenia z ${prevLabel} ${prevY} do miesiąca ${month}/${year} dla ${costCenterId}?`)) return

    setCopyingMonth(true)
    try {
      const params = new URLSearchParams({ type: 'budget', year: String(year), month: String(month), costCenterId })
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>Założenia kosztowe</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => handleYearChange(year - 1)} className="p-1 hover:bg-gray-100 rounded">‹</button>
            <span className="font-medium px-2">{year}</span>
            <button onClick={() => handleYearChange(year + 1)} className="p-1 hover:bg-gray-100 rounded">›</button>
          </div>
          {editable && costCenterId !== 'GLOBAL' && (
            <button
              onClick={handleCopyPrevMonth}
              disabled={copyingMonth}
              title="Skopiuj założenia z poprzedniego miesiąca"
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

      {deleteError && (
        <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm flex justify-between">
          {deleteError}
          <button onClick={() => setDeleteError(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      <BudgetCharts categories={localCategories} entries={entries} />

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="table-fixed w-full border-collapse text-sm">
          <colgroup>
            <col className="w-52" />
            {MONTHS.map((_, i) => <col key={i} className="w-20" />)}
            <col className="w-24" />
          </colgroup>
          <thead>
            <tr className="border-b" style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}>
              <th className="text-left px-3 py-2.5 data-label">Podkategoria</th>
              {MONTHS.map((m) => (
                <th key={m} className="text-right px-2 py-2.5 data-label border-r" style={{ borderColor: 'var(--wd-border)' }}>{m}</th>
              ))}
              <th className="text-right px-3 py-2.5 data-label">SUMA</th>
            </tr>
          </thead>
          <tbody>
            {localCategories.map((cat) => (
              <React.Fragment key={cat.id}>
                {/* Category header */}
                <tr
                  className="border-t cursor-pointer select-none group/cat"
                  style={{ background: 'var(--wd-surface-2)', borderColor: 'var(--wd-border)' }}
                  onClick={() => { if (editingCatId !== cat.id) setCollapsed(prev => ({ ...prev, [cat.id]: !prev[cat.id] })) }}
                >
                  <td
                    className="px-3 py-2 font-semibold"
                    style={{ color: 'var(--wd-text-primary)', borderLeft: '2px solid var(--wd-sand)' }}
                    colSpan={14}
                  >
                    {editingCatId === cat.id ? (
                      <input
                        ref={renameCatInputRef}
                        type="text"
                        defaultValue={cat.name}
                        autoFocus
                        className="w-full px-1 py-0.5 border border-amber-300 rounded text-sm font-medium outline-none"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); handleRenameCategory(cat.id) }
                          if (e.key === 'Escape') setEditingCatId(null)
                        }}
                        onBlur={() => handleRenameCategory(cat.id)}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>
                          <span className="mr-1 text-xs">{collapsed[cat.id] ? '▶' : '▼'}</span>
                          {cat.name}
                        </span>
                        {editable && (
                          <div className="flex gap-0.5 shrink-0">
                            <button
                              title="Zmień nazwę kategorii"
                              onClick={(e) => { e.stopPropagation(); setEditingCatId(cat.id) }}
                              className="p-0.5 rounded hover:bg-gray-200 text-gray-300 hover:text-gray-600"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-1.414a2 2 0 01.586-1.414z" />
                              </svg>
                            </button>
                            <button
                              title="Usuń kategorię"
                              onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat.id, cat.name) }}
                              className="p-0.5 rounded hover:bg-red-100 text-gray-300 hover:text-red-500"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>

                {/* Subcategory rows */}
                {!collapsed[cat.id] && (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleDragEnd(e, cat.id)}
                  >
                    <SortableContext items={cat.subCategories.map(s => s.id)} strategy={verticalListSortingStrategy}>
                      {cat.subCategories.map((sub, subIdx) => (
                        <SortableRow
                          key={sub.id}
                          id={sub.id}
                          showHandle={editable}
                          className="border-t group"
                          style={{
                            borderColor: 'var(--wd-border)',
                            background: subIdx % 2 === 1 ? 'color-mix(in srgb, var(--wd-surface-2) 50%, transparent)' : undefined,
                          }}
                        >
                          {(handleProps) => (
                            <>
                              {/* Name cell — editable for canManage */}
                              <td className="px-3 py-2.5 pl-4 text-sm" style={{ color: '#4B4846' }}>
                                {editingSubId === sub.id ? (
                                  <input
                                    ref={renameInputRef}
                                    type="text"
                                    defaultValue={sub.name}
                                    autoFocus
                                    className="w-full px-1 py-0.5 border border-amber-300 rounded text-sm outline-none"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { e.preventDefault(); handleRename(sub.id) }
                                      if (e.key === 'Escape') setEditingSubId(null)
                                    }}
                                    onBlur={() => handleRename(sub.id)}
                                  />
                                ) : (
                                  <div className="flex items-center gap-1">
                                    {handleProps && <DragHandle handleProps={handleProps} />}
                                    <div className="flex items-center justify-between gap-1 flex-1 min-w-0">
                                      <span className="truncate">{sub.name}</span>
                                      {canManage && (
                                        <div className="flex gap-0.5 shrink-0">
                                          <button
                                            title="Zmień nazwę"
                                            onClick={() => setEditingSubId(sub.id)}
                                            className="p-0.5 rounded hover:bg-gray-200 text-gray-300 hover:text-gray-600"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-1.414a2 2 0 01.586-1.414z" />
                                            </svg>
                                          </button>
                                          <button
                                            title="Usuń podkategorię"
                                            onClick={() => handleDelete(sub.id, sub.name)}
                                            className="p-0.5 rounded hover:bg-red-100 text-gray-300 hover:text-red-500"
                                          >
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </td>

                              {MONTHS.map((_, i) => (
                                <BudgetCell
                                  key={i}
                                  value={getEntry(sub.id, i + 1)}
                                  editable={editable}
                                  isEditing={editable && activeCell?.subId === sub.id && activeCell?.month === i + 1}
                                  onActivate={() => setActiveCell({ subId: sub.id, month: i + 1 })}
                                  onDeactivate={() => setActiveCell(null)}
                                  onNavigate={(dir) => handleNavigate(sub.id, i + 1, dir)}
                                  onSave={(v) => onSave(sub.id, i + 1, v)}
                                  tdClassName="border-r"
                                />
                              ))}
                              <td className="text-right px-3 py-2.5 num text-sm font-medium" style={{ color: 'var(--wd-dark)' }}>
                                {rowSum(sub.id) === 0 ? '—' : rowSum(sub.id).toLocaleString('pl-PL')}
                              </td>
                            </>
                          )}
                        </SortableRow>
                      ))}
                    </SortableContext>
                  </DndContext>
                )}

                {/* Add new subcategory row */}
                {!collapsed[cat.id] && canManage && (
                  <tr className="border-t border-dashed border-gray-200">
                    <td colSpan={14} className="pl-6 py-0.5">
                      {addingToCatId === cat.id ? (
                        <input
                          ref={addInputRef}
                          type="text"
                          placeholder="Nazwa podkategorii..."
                          autoFocus
                          className="w-48 px-1 py-0.5 border border-amber-300 rounded text-sm outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleAdd(cat.id) }
                            if (e.key === 'Escape') setAddingToCatId(null)
                          }}
                          onBlur={() => handleAdd(cat.id)}
                        />
                      ) : (
                        <button
                          onClick={() => setAddingToCatId(cat.id)}
                          className="text-xs text-gray-400 hover:text-gray-600 py-0.5"
                        >
                          + dodaj podkategorię
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
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
          <tbody>
            {(() => {
              const profitByMonth = MONTHS.map((_, i) => revenueByMonth[i] - colSum(i + 1))
              const totalProfit = profitByMonth.reduce((s, v) => s + v, 0)

              const cumulativeProfit: number[] = []
              let running = 0
              for (const p of profitByMonth) {
                running += p
                cumulativeProfit.push(running)
              }

              const fmtProfit = (n: number) =>
                n === 0 ? '—' : (n > 0 ? '+' : '') + Math.round(n).toLocaleString('pl-PL')

              return (
                <>
                  {/* Wiersz: Wynik przy założeniach */}
                  <tr className="border-t-2" style={{ borderColor: 'var(--wd-border)' }}>
                    <td
                      className="px-3 py-2 text-sm font-semibold"
                      style={{ color: 'var(--wd-dark)' }}
                    >
                      Wynik wg założeń
                    </td>
                    {profitByMonth.map((p, i) => (
                      <td
                        key={i}
                        className="text-right text-xs font-semibold tabular-nums px-1 py-2 border-r"
                        style={{
                          color: p > 0 ? '#16a34a' : p < 0 ? '#dc2626' : '#9ca3af',
                          borderColor: 'var(--wd-border)',
                        }}
                      >
                        {fmtProfit(p)}
                      </td>
                    ))}
                    <td
                      className="text-right text-xs font-bold tabular-nums px-3 py-2"
                      style={{
                        color: totalProfit > 0 ? '#16a34a' : totalProfit < 0 ? '#dc2626' : '#9ca3af',
                      }}
                    >
                      {fmtProfit(totalProfit)}
                    </td>
                  </tr>

                  {/* Wiersz: Wynik narastająco przy założeniach */}
                  <tr style={{ background: 'var(--wd-off-white, #f9f7f5)' }}>
                    <td
                      className="px-3 py-2 text-sm font-semibold"
                      style={{ color: 'var(--wd-dark)', opacity: 0.75 }}
                    >
                      Wynik wg założeń narastająco
                    </td>
                    {cumulativeProfit.map((cp, i) => (
                      <td
                        key={i}
                        className="text-right text-xs font-medium tabular-nums px-1 py-2 border-r"
                        style={{
                          color: cp > 0 ? '#16a34a' : cp < 0 ? '#dc2626' : '#9ca3af',
                          borderColor: 'var(--wd-border)',
                        }}
                      >
                        {fmtProfit(cp)}
                      </td>
                    ))}
                    <td
                      className="text-right text-xs font-bold tabular-nums px-3 py-2"
                      style={{
                        color:
                          (cumulativeProfit[11] ?? 0) > 0
                            ? '#16a34a'
                            : (cumulativeProfit[11] ?? 0) < 0
                              ? '#dc2626'
                              : '#9ca3af',
                      }}
                    >
                      {fmtProfit(cumulativeProfit[11] ?? 0)}
                    </td>
                  </tr>
                </>
              )
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}
