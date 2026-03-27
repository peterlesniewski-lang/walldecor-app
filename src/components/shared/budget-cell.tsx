'use client'

import { useRef } from 'react'

export type NavDirection = 'left' | 'right' | 'up' | 'down'

interface BudgetCellProps {
  value: number
  onSave: (v: number) => Promise<void>
  editable: boolean
  isEditing: boolean
  onActivate: () => void
  onDeactivate: () => void
  onNavigate: (dir: NavDirection) => void
  tdClassName?: string
}

export function BudgetCell({
  value,
  onSave,
  editable,
  isEditing,
  onActivate,
  onDeactivate,
  onNavigate,
  tdClassName,
}: BudgetCellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const saving = useRef(false)

  const parseInput = () => {
    const raw = inputRef.current?.value ?? ''
    return Math.max(0, parseFloat(raw.replace(',', '.')) || 0)
  }

  const handleClose = async (shouldSave: boolean) => {
    if (saving.current) return
    saving.current = true
    if (shouldSave) await onSave(parseInput())
    onDeactivate()
    setTimeout(() => { saving.current = false }, 100)
  }

  const handleNavigate = (dir: NavDirection) => {
    if (saving.current) return
    saving.current = true
    onSave(parseInput()).catch(console.error)
    onNavigate(dir)
    setTimeout(() => { saving.current = false }, 100)
  }

  const displayValue = value === 0 ? '—' : value.toLocaleString('pl-PL')

  const displayClass = [
    'text-right font-mono text-sm px-2 py-1 min-w-[5rem]',
    editable ? 'cursor-pointer hover:bg-amber-50' : '',
    value === 0 ? 'text-gray-300' : 'text-gray-800',
  ].filter(Boolean).join(' ')

  return (
    <td className={`p-0 ${tdClassName ?? ''}`}>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoFocus
          defaultValue={value === 0 ? '' : value}
          className="w-full text-right font-mono text-sm px-2 py-1 border border-amber-300 bg-white outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleClose(true)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              handleClose(false)
            } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
              e.preventDefault()
              handleNavigate('right')
            } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
              e.preventDefault()
              handleNavigate('left')
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              handleNavigate('down')
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              handleNavigate('up')
            }
          }}
          onBlur={() => {
            if (saving.current) return
            handleClose(true)
          }}
        />
      ) : (
        <div
          className={displayClass}
          onClick={() => { if (editable) onActivate() }}
        >
          {displayValue}
        </div>
      )}
    </td>
  )
}
