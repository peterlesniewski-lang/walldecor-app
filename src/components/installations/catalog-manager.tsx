'use client'

import { FormEvent, useMemo, useState, type ComponentProps } from 'react'
import { Archive, ChevronDown, ChevronUp, Pencil, Plus, Save, X } from 'lucide-react'
import { Button as UiButton, type ButtonProps } from '@/components/ui/button'
import { Input as UiInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function Button({ className, ...props }: ButtonProps) {
  return <UiButton {...props} className={`min-h-11 min-w-11 ${className ?? ''}`} />
}

function Input({ className, ...props }: ComponentProps<typeof UiInput>) {
  return <UiInput {...props} className={`min-h-11 ${className ?? ''}`} />
}

type CatalogCategory = {
  id: string
  name: string
  sortOrder: number
  isActive?: boolean
  types?: unknown[]
}

async function requestJson(path: string, options: RequestInit) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? 'Nie udało się zapisać rodzajów prac.')
  return body
}

function CategoryNameEditor({ value, onSave }: { value: string; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!editing) return <Button type="button" variant="ghost" size="sm" onClick={() => { setName(value); setError(''); setEditing(true) }} aria-label={`Edytuj rodzaj prac ${value}`}><Pencil className="h-3.5 w-3.5" /></Button>
  return <form className="flex flex-wrap items-center gap-2" onSubmit={async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await onSave(name); setEditing(false) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać.') } finally { setSaving(false) }
  }}>
    <Input aria-label="Nowa nazwa rodzaju prac" value={name} onChange={(event) => setName(event.target.value)} className="h-9 max-w-xs" />
    <Button type="submit" size="sm" disabled={saving}><Save className="h-3.5 w-3.5" />{saving ? 'Zapis…' : 'Zapisz rodzaj prac'}</Button>
    <Button type="button" size="sm" variant="ghost" aria-label="Anuluj edycję rodzaju prac" onClick={() => { setName(value); setError(''); setEditing(false) }}><X className="h-3.5 w-3.5" /></Button>
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
  </form>
}

export function CatalogManager({ initialCatalog }: { initialCatalog: CatalogCategory[] }) {
  const [catalog, setCatalog] = useState(initialCatalog)
  const [categoryName, setCategoryName] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const activeCategories = useMemo(() => catalog.filter((category) => category.isActive !== false), [catalog])
  const categoryIds = useMemo(() => activeCategories.map((category) => category.id), [activeCategories])

  async function reload() {
    const response = await fetch('/api/installations/catalog')
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? 'Nie udało się odczytać rodzajów prac.')
    setCatalog(body)
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('category'); setMessage('')
    try { await requestJson('/api/installations/catalog', { method: 'POST', body: JSON.stringify({ kind: 'category', name: categoryName }) }); setCategoryName(''); await reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się dodać rodzaju prac.') } finally { setBusy('') }
  }

  async function archiveCategory(category: CatalogCategory) {
    setBusy(`archive-${category.id}`); setMessage('')
    try { await requestJson(`/api/installations/catalog/category/${category.id}`, { method: 'DELETE' }); await reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zarchiwizować rodzaju prac.') } finally { setBusy('') }
  }

  async function moveCategory(category: CatalogCategory, direction: -1 | 1) {
    const index = categoryIds.indexOf(category.id); const next = index + direction
    if (index < 0 || next < 0 || next >= categoryIds.length) return
    const orderedIds = [...categoryIds]; [orderedIds[index], orderedIds[next]] = [orderedIds[next], orderedIds[index]]
    setBusy(`move-${category.id}`); setMessage('')
    try { await requestJson('/api/installations/catalog/category/reorder', { method: 'PUT', body: JSON.stringify({ orderedIds }) }); await reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zmienić kolejności.') } finally { setBusy('') }
  }

  const sectionStyle = { background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }
  const inputStyle = { background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.14)' }

  return <section aria-labelledby="catalog-manager-heading" className="rounded-2xl border p-5 sm:p-6" style={sectionStyle}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="data-label" style={{ color: '#8C5718' }}>Katalog dynamiczny</p><h2 id="catalog-manager-heading" className="mt-1 text-xl font-extrabold" style={{ color: 'var(--wd-dark)' }}>Rodzaje prac</h2></div><p className="max-w-sm text-sm" style={{ color: 'var(--wd-text-muted)' }}>To płaska lista aktywnych rodzajów prac wybieranych przy budowie zakresu zlecenia. Archiwizacja zachowuje historię.</p></div>
    <form onSubmit={addCategory} className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border p-3" style={{ borderColor: 'rgba(30, 30, 30, 0.10)', background: 'var(--wd-off-white)' }}><div className="min-w-56 flex-1"><Label htmlFor="catalog-category-name">Nowy rodzaj pracy</Label><Input id="catalog-category-name" aria-label="Nowy rodzaj pracy" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} style={inputStyle} /></div><Button type="submit" disabled={busy === 'category'} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus />{busy === 'category' ? 'Dodawanie…' : 'Dodaj rodzaj prac'}</Button></form>
    {message && <p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}
    {activeCategories.length === 0 ? <p className="mt-5 rounded-xl border px-4 py-5 text-sm" style={{ borderColor: 'rgba(30, 30, 30, 0.12)', background: 'var(--wd-sand-light)', color: 'var(--wd-text-muted)' }}>Brak aktywnych rodzajów prac. Dodaj pierwszy, aby można było budować zakresy.</p> : <div className="mt-5 space-y-3">{activeCategories.map((category, index) => <article key={category.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" style={{ borderColor: 'rgba(30, 30, 30, 0.12)', background: 'var(--wd-off-white)' }}><div className="flex min-w-0 flex-1 items-center gap-1"><h3 className="truncate font-extrabold" style={{ color: 'var(--wd-dark)' }}>{category.name}</h3><CategoryNameEditor value={category.name} onSave={async (name) => { await requestJson(`/api/installations/catalog/category/${category.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await reload() }} /></div><div className="flex flex-wrap items-center gap-1"><Button type="button" size="sm" variant="ghost" disabled={index === 0 || busy.startsWith('move-')} onClick={() => moveCategory(category, -1)} aria-label={`Przesuń rodzaj prac ${category.name} wyżej`}><ChevronUp /></Button><Button type="button" size="sm" variant="ghost" disabled={index === activeCategories.length - 1 || busy.startsWith('move-')} onClick={() => moveCategory(category, 1)} aria-label={`Przesuń rodzaj prac ${category.name} niżej`}><ChevronDown /></Button><Button type="button" size="sm" variant="outline" disabled={busy === `archive-${category.id}`} onClick={() => archiveCategory(category)} aria-label={`Archiwizuj rodzaj prac ${category.name}`} className="min-h-11 border-red-200 text-red-800"><Archive className="h-3.5 w-3.5" />Archiwizuj</Button></div></article>)}</div>}
  </section>
}
