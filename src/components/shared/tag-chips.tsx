'use client'

import { useState } from 'react'
import { Check, CircleHelp, Plus, X } from 'lucide-react'
import {
  applyDefaultCostTagDescription,
  applyDefaultCostTagGroupDescription,
  canCreateCustomCostTagInGroup,
  isSingleChoiceTagGroup,
} from '@/lib/finance/cost-tags'

export interface TagChipsTag {
  id: string
  name: string
  slug: string
}

export interface TagChipsGroup {
  id: string
  name: string
  slug: string
  tags: TagChipsTag[]
}

interface TagChipsProps {
  groups: TagChipsGroup[]
  value: string[]
  onChange: (next: string[]) => void
  onCreateTag?: (group: TagChipsGroup, name: string) => Promise<TagChipsTag>
  disabled?: boolean
  size?: 'sm' | 'md'
}

// Grouped toggle chips for cost tags. Replaces the native <select multiple>
// (Ctrl+click, invisible selection) that made tagging unintuitive. Axes marked
// single-choice (fixed vs variable, recurring vs new supplier) allow only one
// selected chip; the rest are multi-select.
export function TagChips({ groups, value, onChange, onCreateTag, disabled, size = 'md' }: TagChipsProps) {
  const [addingGroupSlug, setAddingGroupSlug] = useState<string | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [creatingGroupSlug, setCreatingGroupSlug] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
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

  async function submitNewTag(group: TagChipsGroup) {
    if (!onCreateTag || disabled) return
    const name = newTagName.trim()
    if (name.length < 2) {
      setCreateError('Wpisz co najmniej 2 znaki.')
      return
    }

    setCreatingGroupSlug(group.slug)
    setCreateError(null)
    try {
      const tag = await onCreateTag(group, name)
      const base = isSingleChoiceTagGroup(group.slug)
        ? value.filter((id) => !group.tags.map((item) => item.id).includes(id))
        : value
      onChange([...base, tag.id])
      setAddingGroupSlug(null)
      setNewTagName('')
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Nie udało się dodać tagu.')
    } finally {
      setCreatingGroupSlug(null)
    }
  }

  return (
    <div className="space-y-1.5">
      {groups.map((group) => {
        const single = isSingleChoiceTagGroup(group.slug)
        const groupDescription = applyDefaultCostTagGroupDescription(group.slug)
        const canCreate = Boolean(onCreateTag) && canCreateCustomCostTagInGroup(group.slug) && !disabled
        const addingThisGroup = addingGroupSlug === group.slug
        const creatingThisGroup = creatingGroupSlug === group.slug
        return (
          <div key={group.id}>
            <div className="flex items-center gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wd-text-muted)' }}>
                {group.name}
                {single && <span className="font-normal normal-case"> · wybierz jeden</span>}
              </p>
              {groupDescription && (
                <span title={groupDescription} aria-label={`Opis grupy ${group.name}`} className="inline-flex text-[var(--wd-text-muted)]">
                  <CircleHelp size={12} aria-hidden="true" />
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {group.tags.map((tag) => {
                const selected = value.includes(tag.id)
                const tagDescription = applyDefaultCostTagDescription(tag.slug) ?? undefined
                return (
                  <button
                    type="button"
                    key={tag.id}
                    disabled={disabled}
                    aria-pressed={selected}
                    title={tagDescription}
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
              {canCreate && !addingThisGroup && (
                <button
                  type="button"
                  aria-label={`Dodaj tag do ${group.name}`}
                  title={`Dodaj tag do ${group.name}`}
                  onClick={() => {
                    setAddingGroupSlug(group.slug)
                    setNewTagName('')
                    setCreateError(null)
                  }}
                  className={`inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--wd-border)] bg-gray-50 font-medium text-[var(--wd-text-muted)] hover:bg-white ${chipPadding}`}
                >
                  <Plus size={size === 'sm' ? 11 : 13} aria-hidden="true" />
                  tag
                </button>
              )}
            </div>
            {canCreate && addingThisGroup && (
              <form
                aria-label={`Dodaj tag do ${group.name}`}
                className="mt-1 flex max-w-xs items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitNewTag(group)
                }}
              >
                <label className="sr-only" htmlFor={`new-tag-${group.slug}`}>Nowy tag w {group.name}</label>
                <input
                  id={`new-tag-${group.slug}`}
                  className="min-w-0 flex-1 rounded border border-[var(--wd-border)] px-2 py-1 text-xs"
                  placeholder={`Nowy tag w ${group.name}`}
                  value={newTagName}
                  onChange={(event) => setNewTagName(event.target.value)}
                  disabled={creatingThisGroup}
                />
                <button
                  type="submit"
                  disabled={creatingThisGroup}
                  aria-label="Zapisz nowy tag"
                  title="Zapisz nowy tag"
                  className="rounded border border-[var(--wd-border)] p-1 text-green-700 hover:bg-green-50 disabled:opacity-40"
                >
                  <Check size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Anuluj dodawanie tagu"
                  title="Anuluj dodawanie tagu"
                  onClick={() => {
                    setAddingGroupSlug(null)
                    setNewTagName('')
                    setCreateError(null)
                  }}
                  className="rounded border border-[var(--wd-border)] p-1 hover:bg-gray-50"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </form>
            )}
            {addingThisGroup && createError && <p className="mt-1 text-[11px] font-medium text-red-700">{createError}</p>}
          </div>
        )
      })}
    </div>
  )
}
