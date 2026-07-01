'use client'

import { isSingleChoiceTagGroup } from '@/lib/finance/cost-tags'

interface TagChipsGroup {
  id: string
  name: string
  slug: string
  tags: Array<{ id: string; name: string; slug: string }>
}

interface TagChipsProps {
  groups: TagChipsGroup[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}

// Grouped toggle chips for cost tags. Replaces the native <select multiple>
// (Ctrl+click, invisible selection) that made tagging unintuitive. Axes marked
// single-choice (fixed vs variable, recurring vs new supplier) allow only one
// selected chip; the rest are multi-select.
export function TagChips({ groups, value, onChange, disabled, size = 'md' }: TagChipsProps) {
  const chipPadding = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'

  function toggleTag(group: TagChipsGroup, tagId: string) {
    if (disabled) return
    const single = isSingleChoiceTagGroup(group.slug)
    const groupTagIds = group.tags.map((tag) => tag.id)
    const alreadySelected = value.includes(tagId)

    if (alreadySelected) {
      onChange(value.filter((id) => id !== tagId))
      return
    }

    const base = single ? value.filter((id) => !groupTagIds.includes(id)) : value
    onChange([...base, tagId])
  }

  return (
    <div className="space-y-1.5">
      {groups.map((group) => {
        const single = isSingleChoiceTagGroup(group.slug)
        return (
          <div key={group.id}>
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>
              {group.name}
              {single && <span className="font-normal normal-case"> · wybierz jeden</span>}
            </p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {group.tags.map((tag) => {
                const selected = value.includes(tag.id)
                return (
                  <button
                    type="button"
                    key={tag.id}
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => toggleTag(group, tag.id)}
                    className={`rounded-full border font-medium transition-colors disabled:opacity-40 ${chipPadding} ${
                      selected
                        ? 'border-[var(--wd-dark)] bg-[var(--wd-dark)] text-white'
                        : 'border-[var(--wd-border)] bg-white text-[var(--wd-dark)] hover:bg-gray-50'
                    }`}
                  >
                    {tag.name}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
