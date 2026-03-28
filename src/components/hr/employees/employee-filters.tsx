'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'

interface Division {
  id: string
  name: string
}

interface EmployeeFiltersProps {
  divisions: Division[]
}

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: '', label: 'Wszystkie typy' },
  { value: 'UoP', label: 'UoP' },
  { value: 'B2B', label: 'B2B' },
  { value: 'UZ', label: 'UZ' },
  { value: 'UoD', label: 'UoD' },
  { value: 'inne', label: 'Inne' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Wszystkie statusy' },
  { value: 'active', label: 'Aktywni' },
  { value: 'inactive', label: 'Nieaktywni' },
]

export function EmployeeFilters({ divisions }: EmployeeFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const createQueryString = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }
      // reset page on filter change
      params.delete('page')
      return params.toString()
    },
    [searchParams]
  )

  function handleChange(key: string, value: string) {
    startTransition(() => {
      router.push(`${pathname}?${createQueryString({ [key]: value })}`)
    })
  }

  const search = searchParams.get('search') ?? ''
  const divisionId = searchParams.get('divisionId') ?? ''
  const employmentType = searchParams.get('employmentType') ?? ''
  const status = searchParams.get('status') ?? ''

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
          style={{ color: 'var(--wd-text-muted)' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          placeholder="Szukaj pracownika..."
          defaultValue={search}
          onChange={(e) => handleChange('search', e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border outline-none focus:ring-2"
          style={{
            borderColor: 'var(--wd-border)',
            background: 'white',
            color: 'var(--wd-text-primary)',
          }}
        />
      </div>

      {/* Division */}
      <select
        value={divisionId}
        onChange={(e) => handleChange('divisionId', e.target.value)}
        className="py-2 px-3 text-sm rounded-lg border outline-none focus:ring-2 cursor-pointer"
        style={{
          borderColor: 'var(--wd-border)',
          background: 'white',
          color: 'var(--wd-text-primary)',
        }}
      >
        <option value="">Wszystkie oddziały</option>
        {divisions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      {/* Employment type */}
      <select
        value={employmentType}
        onChange={(e) => handleChange('employmentType', e.target.value)}
        className="py-2 px-3 text-sm rounded-lg border outline-none focus:ring-2 cursor-pointer"
        style={{
          borderColor: 'var(--wd-border)',
          background: 'white',
          color: 'var(--wd-text-primary)',
        }}
      >
        {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Status */}
      <select
        value={status}
        onChange={(e) => handleChange('status', e.target.value)}
        className="py-2 px-3 text-sm rounded-lg border outline-none focus:ring-2 cursor-pointer"
        style={{
          borderColor: 'var(--wd-border)',
          background: 'white',
          color: 'var(--wd-text-primary)',
        }}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
