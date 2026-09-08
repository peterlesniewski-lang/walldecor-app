'use client'

import { useId } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { TagChips, type TagChipsGroup, type TagChipsTag } from '@/components/shared/tag-chips'

interface Props {
  groups: TagChipsGroup[]
  value: string[]
  savedValue: string[]
  invoiceTags: TagChipsTag[]
  disabled: boolean
  editing: boolean
  onToggle: () => void
  onChange: (value: string[]) => void
  onCreateTag: (group: TagChipsGroup, name: string) => Promise<TagChipsTag>
}

export function KsefInvoiceTags({ groups, value, savedValue, invoiceTags, disabled, editing, onToggle, onChange, onCreateTag }: Props) {
  const editorId = useId()
  const tags = new Map([...invoiceTags, ...groups.flatMap((group) => group.tags)].map((tag) => [tag.id, tag]))
  const dirty = value.length !== savedValue.length || value.some((id) => !savedValue.includes(id))
  const hasCatalog = groups.some((group) => group.tags.length > 0)
  return (
    <div className="min-w-48 max-w-80 space-y-2">
      <div className="flex flex-wrap gap-1">
        {value.map((id) => (
          <span key={id} className="rounded-full border border-[var(--wd-border)] bg-[var(--wd-surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--wd-dark)]">
            {tags.get(id)?.name ?? 'Tag spoza katalogu'}
          </span>
        ))}
        {value.length === 0 && <span className="text-xs text-[var(--wd-text-muted)]">{hasCatalog ? 'Brak przypisanych tagów' : 'Brak tagów kosztowych'}</span>}
      </div>
      {dirty && <p className="text-[11px] font-medium text-amber-700">Niezapisane zmiany</p>}
      {!disabled && hasCatalog && (
        <button type="button" aria-expanded={editing} aria-controls={editorId} onClick={onToggle}
          className="inline-flex items-center gap-1 rounded py-1 text-xs font-semibold text-[var(--wd-text-muted)] hover:text-[var(--wd-dark)] focus-visible:outline-2 focus-visible:outline-offset-2">
          {editing ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {editing ? 'Zwiń tagi' : 'Edytuj tagi'}
        </button>
      )}
      {editing && !disabled && (
        <div id={editorId} className="min-w-56 space-y-2 border-t border-[var(--wd-border)] pt-2">
          <div className="max-h-64 overflow-y-auto pr-1">
            <TagChips groups={groups} value={value} onChange={onChange} onCreateTag={onCreateTag} size="sm" />
          </div>
          <p className="text-[11px] text-[var(--wd-text-muted)]">Zmiany zapisz przyciskiem „Zapisz klasyfikację” w akcjach faktury.</p>
        </div>
      )}
    </div>
  )
}
