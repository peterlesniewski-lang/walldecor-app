'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, ChevronDown, X } from 'lucide-react'

interface Employee {
  id: string
  firstName: string
  lastName: string
  email: string
  position: string
  active: boolean
}

interface EmployeeSelectProps {
  value?: string
  onChange: (value: string | undefined) => void
  placeholder?: string
  excludeIds?: string[]
}

export function EmployeeSelect({
  value,
  onChange,
  placeholder = 'Wybierz pracownika…',
  excludeIds = [],
}: EmployeeSelectProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchEmployees = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: 'active', limit: '100' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/hr/employees?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setEmployees(data.employees ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    fetchEmployees()
  }, [fetchEmployees])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = employees.filter((emp) => !excludeIds.includes(emp.id))

  const selected = employees.find((e) => e.id === value)

  const handleSelect = (emp: Employee) => {
    onChange(emp.id)
    setOpen(false)
    setSearch('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(undefined)
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--wd-border)] bg-white text-left transition-colors hover:border-[var(--wd-dark)]/40 focus:outline-none focus:ring-2 focus:ring-[var(--wd-dark)]/20 focus:border-[var(--wd-dark)]"
      >
        {selected ? (
          <span className="flex items-center gap-2 flex-1 min-w-0">
            <span
              className="w-6 h-6 rounded-full bg-[var(--wd-dark)] text-white text-[10px] font-semibold flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              {selected.firstName[0]}{selected.lastName[0]}
            </span>
            <span className="truncate text-[var(--wd-text-primary)]">
              {selected.firstName} {selected.lastName}
            </span>
          </span>
        ) : (
          <span className="text-[var(--wd-text-muted)] flex-1">{placeholder}</span>
        )}
        <span className="flex items-center gap-1 shrink-0">
          {selected && (
            <span
              role="button"
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-[var(--wd-surface-2)] text-[var(--wd-text-muted)] hover:text-[var(--wd-text-primary)] transition-colors"
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown size={14} className={`text-[var(--wd-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-[var(--wd-border)] rounded-xl shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-[var(--wd-border)]">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--wd-surface-2)]">
              <Search size={13} className="text-[var(--wd-text-muted)] shrink-0" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Szukaj…"
                className="flex-1 text-sm bg-transparent outline-none text-[var(--wd-text-primary)] placeholder:text-[var(--wd-text-muted)]"
              />
              {loading && (
                <span className="w-3.5 h-3.5 border border-[var(--wd-text-muted)] border-t-transparent rounded-full animate-spin shrink-0" />
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-xs text-[var(--wd-text-muted)] text-center">
                {loading ? 'Ładowanie…' : 'Brak wyników'}
              </div>
            ) : (
              filtered.map((emp) => (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => handleSelect(emp)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--wd-surface-2)] transition-colors ${
                    emp.id === value ? 'bg-[var(--wd-surface-2)]' : ''
                  }`}
                >
                  <span
                    className="w-7 h-7 rounded-full bg-[var(--wd-dark)] text-white text-[10px] font-semibold flex items-center justify-center shrink-0"
                    aria-hidden="true"
                  >
                    {emp.firstName[0]}{emp.lastName[0]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[var(--wd-text-primary)] truncate">
                      {emp.firstName} {emp.lastName}
                    </div>
                    <div className="text-xs text-[var(--wd-text-muted)] truncate">{emp.position}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
