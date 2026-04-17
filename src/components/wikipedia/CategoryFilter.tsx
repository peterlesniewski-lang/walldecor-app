'use client'

import { CATEGORY_LABELS } from './constants'

interface CategoryFilterProps {
  active: string
  onChange: (cat: string) => void
}

export function CategoryFilter({ active, onChange }: CategoryFilterProps) {
  const allCategories = [{ id: 'all', label: 'Wszystkie' }, ...CATEGORY_LABELS]

  return (
    <div className="flex flex-wrap gap-2">
      {allCategories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onChange(cat.id)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            active === cat.id
              ? 'text-white'
              : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
          }`}
          style={active === cat.id ? { background: 'var(--accent, #2C1810)', color: 'white' } : {}}
        >
          {cat.label}
        </button>
      ))}
    </div>
  )
}
