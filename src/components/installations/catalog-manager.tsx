'use client'

import { FormEvent, useMemo, useState } from 'react'
import { Archive, ChevronDown, ChevronUp, Pencil, Plus, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type CatalogProduct = { id: string; name: string; code: string | null; manufacturer: string | null; collection: string | null; sortOrder: number }
type CatalogType = { id: string; name: string; sortOrder: number; products: CatalogProduct[] }
type CatalogCategory = { id: string; name: string; sortOrder: number; types: CatalogType[] }

async function requestJson(path: string, options: RequestInit) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? 'Nie udało się zapisać katalogu.')
  return body
}

function CatalogNameEditor({ value, onSave, label }: { value: string; label: string; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!editing) return <Button type="button" variant="ghost" size="sm" onClick={() => { setName(value); setEditing(true) }} aria-label={`Edytuj ${label}`}><Pencil className="h-3.5 w-3.5" /></Button>
  return <form className="flex flex-wrap items-center gap-2" onSubmit={async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await onSave(name); setEditing(false) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać.') } finally { setSaving(false) }
  }}>
    <Input aria-label={`Nowa nazwa ${label}`} value={name} onChange={(event) => setName(event.target.value)} className="h-9 max-w-xs" />
    <Button type="submit" size="sm" disabled={saving}><Save className="h-3.5 w-3.5" /> {saving ? 'Zapis…' : 'Zapisz'}</Button>
    <Button type="button" size="sm" variant="ghost" onClick={() => { setName(value); setEditing(false); setError('') }} aria-label={`Anuluj edycję ${label}`}><X className="h-3.5 w-3.5" /></Button>
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
  </form>
}

function CatalogProductEditor({ product, onSave }: { product: CatalogProduct; onSave: (value: { name: string; code: string | null; manufacturer: string | null; collection: string | null }) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(product.name)
  const [code, setCode] = useState(product.code ?? '')
  const [manufacturer, setManufacturer] = useState(product.manufacturer ?? '')
  const [collection, setCollection] = useState(product.collection ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  if (!editing) return <Button type="button" variant="ghost" size="sm" aria-label={`Edytuj dane produktu ${product.name}`} onClick={() => { setName(product.name); setCode(product.code ?? ''); setManufacturer(product.manufacturer ?? ''); setCollection(product.collection ?? ''); setError(''); setEditing(true) }}><Pencil className="h-3.5 w-3.5" /></Button>
  return <form className="mt-2 grid gap-2 sm:grid-cols-5" onSubmit={async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await onSave({ name, code: code || null, manufacturer: manufacturer || null, collection: collection || null }); setEditing(false) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać produktu.') } finally { setSaving(false) }
  }}>
    <Input aria-label={`Nazwa produktu ${product.name}`} value={name} onChange={(event) => setName(event.target.value)} />
    <Input aria-label={`Kod produktu ${product.name}`} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Kod" />
    <Input aria-label={`Producent produktu ${product.name}`} value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} placeholder="Producent" />
    <Input aria-label={`Kolekcja produktu ${product.name}`} value={collection} onChange={(event) => setCollection(event.target.value)} placeholder="Kolekcja" />
    <div className="flex items-center gap-1"><Button type="submit" size="sm" disabled={saving}><Save className="h-3.5 w-3.5" />{saving ? 'Zapis…' : 'Zapisz'}</Button><Button type="button" size="sm" variant="ghost" aria-label={`Anuluj edycję produktu ${product.name}`} onClick={() => setEditing(false)}><X className="h-3.5 w-3.5" /></Button></div>
    {error && <p role="alert" className="text-xs text-red-700 sm:col-span-5">{error}</p>}
  </form>
}

export function CatalogManager({ initialCatalog }: { initialCatalog: CatalogCategory[] }) {
  const [catalog, setCatalog] = useState(initialCatalog)
  const [categoryName, setCategoryName] = useState('')
  const [typeNames, setTypeNames] = useState<Record<string, string>>({})
  const [productForms, setProductForms] = useState<Record<string, { name: string; code: string; manufacturer: string; collection: string }>>({})
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const categoryIds = useMemo(() => catalog.map((category) => category.id), [catalog])

  async function reload() {
    const response = await fetch('/api/installations/catalog')
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? 'Nie udało się odczytać katalogu.')
    setCatalog(body)
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('category'); setMessage('')
    try { await requestJson('/api/installations/catalog', { method: 'POST', body: JSON.stringify({ kind: 'category', name: categoryName }) }); setCategoryName(''); await reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się dodać kategorii.') } finally { setBusy('') }
  }

  async function addType(category: CatalogCategory) {
    const name = typeNames[category.id] ?? ''
    setBusy(`type-${category.id}`); setMessage('')
    try { await requestJson('/api/installations/catalog', { method: 'POST', body: JSON.stringify({ kind: 'type', categoryId: category.id, name }) }); setTypeNames((current) => ({ ...current, [category.id]: '' })); await reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się dodać typu.') } finally { setBusy('') }
  }

  async function addProduct(type: CatalogType) {
    const form = productForms[type.id] ?? { name: '', code: '', manufacturer: '', collection: '' }
    setBusy(`product-${type.id}`); setMessage('')
    try {
      await requestJson('/api/installations/catalog', { method: 'POST', body: JSON.stringify({ kind: 'product', typeId: type.id, name: form.name, code: form.code || null, manufacturer: form.manufacturer || null, collection: form.collection || null }) })
      setProductForms((current) => ({ ...current, [type.id]: { name: '', code: '', manufacturer: '', collection: '' } })); await reload()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się dodać produktu.') } finally { setBusy('') }
  }

  async function archive(kind: 'category' | 'type' | 'product', id: string) {
    setBusy(`${kind}-${id}`); setMessage('')
    try { await requestJson(`/api/installations/catalog/${kind}/${id}`, { method: 'DELETE' }); await reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zarchiwizować pozycji.') } finally { setBusy('') }
  }

  async function move(kind: 'category' | 'type' | 'product', parentId: string | null, ids: string[], id: string, direction: -1 | 1) {
    const index = ids.indexOf(id); const swapIndex = index + direction
    if (index < 0 || swapIndex < 0 || swapIndex >= ids.length) return
    const orderedIds = [...ids]; [orderedIds[index], orderedIds[swapIndex]] = [orderedIds[swapIndex], orderedIds[index]]
    setBusy(`move-${kind}-${id}`); setMessage('')
    try { await requestJson(`/api/installations/catalog/${kind}/reorder`, { method: 'PUT', body: JSON.stringify({ orderedIds, ...(parentId ? { parentId } : {}) }) }); await reload() } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zmienić kolejności.') } finally { setBusy('') }
  }

  const sectionStyle = { background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }
  const inputStyle = { background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.14)' }

  return <section aria-labelledby="catalog-manager-heading" className="rounded-2xl border p-5 sm:p-6" style={sectionStyle}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="data-label" style={{ color: '#8C5718' }}>Katalog dynamiczny</p><h2 id="catalog-manager-heading" className="mt-1 text-xl font-extrabold" style={{ color: 'var(--wd-dark)' }}>Materiały i usługi</h2></div>
      <p className="max-w-sm text-sm" style={{ color: 'var(--wd-text-muted)' }}>Nazwy są unikalne niezależnie od wielkości liter; archiwizacja nie usuwa historii zleceń.</p>
    </div>
    <form onSubmit={addCategory} className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border p-3" style={{ borderColor: 'rgba(30, 30, 30, 0.10)', background: 'var(--wd-off-white)' }}>
      <div className="min-w-56 flex-1"><Label htmlFor="catalog-category-name">Nowa kategoria</Label><Input id="catalog-category-name" aria-label="Nowa kategoria" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} style={inputStyle} /></div>
      <Button type="submit" disabled={busy === 'category'} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus /> {busy === 'category' ? 'Dodawanie…' : 'Dodaj kategorię'}</Button>
    </form>
    {message && <p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}
    {catalog.length === 0 ? <p className="mt-5 rounded-xl border px-4 py-5 text-sm" style={{ borderColor: 'rgba(30, 30, 30, 0.12)', background: 'var(--wd-sand-light)', color: 'var(--wd-text-muted)' }}>Katalog jest pusty. Dodaj kategorię, aby pracownicy mogli wybierać realne produkty w zakresie.</p> :
      <div className="mt-5 space-y-4">{catalog.map((category, categoryIndex) => <article key={category.id} className="rounded-xl border p-4" style={{ borderColor: 'rgba(30, 30, 30, 0.12)', background: 'var(--wd-off-white)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1"><h3 className="font-extrabold" style={{ color: 'var(--wd-dark)' }}>{category.name}</h3><CatalogNameEditor value={category.name} label={`kategorię ${category.name}`} onSave={async (name) => { await requestJson(`/api/installations/catalog/category/${category.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await reload() }} /></div><div className="flex items-center gap-1"><Button type="button" size="sm" variant="ghost" disabled={categoryIndex === 0 || busy.startsWith('move-')} onClick={() => move('category', null, categoryIds, category.id, -1)} aria-label={`Przesuń kategorię ${category.name} wyżej`}><ChevronUp /></Button><Button type="button" size="sm" variant="ghost" disabled={categoryIndex === catalog.length - 1 || busy.startsWith('move-')} onClick={() => move('category', null, categoryIds, category.id, 1)} aria-label={`Przesuń kategorię ${category.name} niżej`}><ChevronDown /></Button><Button type="button" size="sm" variant="outline" disabled={busy === `category-${category.id}`} onClick={() => archive('category', category.id)} aria-label={`Archiwizuj kategorię ${category.name}`} className="border-red-200 text-red-800"><Archive className="h-3.5 w-3.5" />Archiwizuj</Button></div></div>
        <div className="mt-3 space-y-3 border-l pl-3" style={{ borderColor: 'rgba(169,106,32,.28)' }}>{category.types.map((type, typeIndex) => <div key={type.id} className="rounded-lg border p-3" style={{ borderColor: 'rgba(30, 30, 30, 0.1)', background: 'var(--wd-white)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1"><h4 className="font-bold text-sm" style={{ color: 'var(--wd-dark)' }}>{type.name}</h4><CatalogNameEditor value={type.name} label={`typ ${type.name}`} onSave={async (name) => { await requestJson(`/api/installations/catalog/type/${type.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await reload() }} /></div><div className="flex items-center gap-1"><Button type="button" size="sm" variant="ghost" disabled={typeIndex === 0} onClick={() => move('type', category.id, category.types.map((item) => item.id), type.id, -1)} aria-label={`Przesuń typ ${type.name} wyżej`}><ChevronUp /></Button><Button type="button" size="sm" variant="ghost" disabled={typeIndex === category.types.length - 1} onClick={() => move('type', category.id, category.types.map((item) => item.id), type.id, 1)} aria-label={`Przesuń typ ${type.name} niżej`}><ChevronDown /></Button><Button type="button" size="sm" variant="outline" disabled={busy === `type-${type.id}`} onClick={() => archive('type', type.id)} aria-label={`Archiwizuj typ ${type.name}`} className="border-red-200 text-red-800"><Archive className="h-3.5 w-3.5" />Archiwizuj</Button></div></div>
          <div className="mt-3 space-y-2">{type.products.map((product, productIndex) => <div key={product.id} className="rounded-md px-2 py-2 text-sm" style={{ background: 'var(--wd-sand-light)' }}><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-semibold" style={{ color: 'var(--wd-dark)' }}>{product.name}</span>{product.code && <span className="num ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{product.code}</span>} {product.manufacturer && <span className="ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{product.manufacturer}</span>} {product.collection && <span className="ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{product.collection}</span>}</div><div className="flex items-center gap-1"><CatalogProductEditor product={product} onSave={async (value) => { await requestJson(`/api/installations/catalog/product/${product.id}`, { method: 'PATCH', body: JSON.stringify(value) }); await reload() }} /><Button type="button" size="sm" variant="ghost" disabled={productIndex === 0} onClick={() => move('product', type.id, type.products.map((item) => item.id), product.id, -1)} aria-label={`Przesuń produkt ${product.name} wyżej`}><ChevronUp /></Button><Button type="button" size="sm" variant="ghost" disabled={productIndex === type.products.length - 1} onClick={() => move('product', type.id, type.products.map((item) => item.id), product.id, 1)} aria-label={`Przesuń produkt ${product.name} niżej`}><ChevronDown /></Button><Button type="button" size="sm" variant="ghost" disabled={busy === `product-${product.id}`} onClick={() => archive('product', product.id)} aria-label={`Archiwizuj produkt ${product.name}`} className="text-red-800 hover:bg-red-50"><Archive className="h-3.5 w-3.5" /></Button></div></div></div>)}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-5"><Input aria-label={`Nowy produkt w ${type.name}`} placeholder="Nazwa produktu" value={(productForms[type.id] ?? {}).name ?? ''} onChange={(event) => setProductForms((current) => ({ ...current, [type.id]: { ...(current[type.id] ?? { name: '', code: '', manufacturer: '', collection: '' }), name: event.target.value } }))} style={inputStyle} /><Input aria-label={`Kod produktu w ${type.name}`} placeholder="Kod (opcjonalnie)" value={(productForms[type.id] ?? {}).code ?? ''} onChange={(event) => setProductForms((current) => ({ ...current, [type.id]: { ...(current[type.id] ?? { name: '', code: '', manufacturer: '', collection: '' }), code: event.target.value } }))} style={inputStyle} /><Input aria-label={`Producent produktu w ${type.name}`} placeholder="Producent" value={(productForms[type.id] ?? {}).manufacturer ?? ''} onChange={(event) => setProductForms((current) => ({ ...current, [type.id]: { ...(current[type.id] ?? { name: '', code: '', manufacturer: '', collection: '' }), manufacturer: event.target.value } }))} style={inputStyle} /><Input aria-label={`Kolekcja produktu w ${type.name}`} placeholder="Kolekcja" value={(productForms[type.id] ?? {}).collection ?? ''} onChange={(event) => setProductForms((current) => ({ ...current, [type.id]: { ...(current[type.id] ?? { name: '', code: '', manufacturer: '', collection: '' }), collection: event.target.value } }))} style={inputStyle} /><Button type="button" disabled={busy === `product-${type.id}`} onClick={() => addProduct(type)} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus /> {busy === `product-${type.id}` ? 'Dodawanie…' : 'Dodaj produkt'}</Button></div>
        </div>)}</div>
        <div className="mt-3 flex flex-wrap gap-2"><Input aria-label={`Nowy typ w ${category.name}`} placeholder="Nowy typ" value={typeNames[category.id] ?? ''} onChange={(event) => setTypeNames((current) => ({ ...current, [category.id]: event.target.value }))} className="max-w-xs" style={inputStyle} /><Button type="button" disabled={busy === `type-${category.id}`} onClick={() => addType(category)} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus /> {busy === `type-${category.id}` ? 'Dodawanie…' : 'Dodaj typ'}</Button></div>
      </article>)}</div>}
  </section>
}
