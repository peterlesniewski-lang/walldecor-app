'use client'

import { FormEvent, useMemo, useState, type ComponentProps } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Ruler, Save, Trash2, X } from 'lucide-react'
import { Button as UiButton, type ButtonProps } from '@/components/ui/button'
import { Input as UiInput } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function Button({ className, ...props }: ButtonProps) {
  return <UiButton {...props} className={`min-h-11 min-w-11 ${className ?? ''}`} />
}

function Input({ className, ...props }: ComponentProps<typeof UiInput>) {
  return <UiInput {...props} className={`min-h-11 ${className ?? ''}`} />
}

type ScopeProduct = {
  id: string
  catalogProductId?: string | null
  productNameSnapshot: string | null
  productCodeSnapshot: string | null
  manufacturerSnapshot: string | null
  collectionSnapshot: string | null
  batchSnapshot: string | null
  sortOrder: number
  updatedAt?: string | Date
}

type Measurement = {
  id: string
  scopeId?: string | null
  elementName: string
  kind?: 'SINGLE' | 'RECTANGLE' | string
  value: { toString(): string } | string | number
  secondaryValue?: { toString(): string } | string | number | null
  unit: string
  source?: string
  authorContext?: string | null
}

type Scope = { id: string; name: string; catalogCategoryId?: string | null; sortOrder: number; scopeProducts: ScopeProduct[]; measurements: Measurement[] }
type Room = { id: string; name: string; sortOrder: number; scopes: Scope[]; measurements: Measurement[] }
type Catalog = Array<{ id: string; name: string; isActive?: boolean; types?: unknown[] }>
type ProductDraft = { productNameSnapshot: string; manufacturerSnapshot: string; productCodeSnapshot: string; collectionSnapshot: string; batchSnapshot: string; updatedAt?: string | Date }
type MeasurementDraft = { kind: 'SINGLE' | 'RECTANGLE'; elementName: string; value: string; secondaryValue: string; unit: string; scopeId: string }

async function requestJson(path: string, options: RequestInit) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const fieldMessage = body.fieldErrors && typeof body.fieldErrors === 'object' ? Object.values(body.fieldErrors as Record<string, unknown>).find((value) => typeof value === 'string') : null
    const error = new Error(typeof fieldMessage === 'string' ? fieldMessage : (body.error ?? 'Nie udało się zapisać zmiany.')) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return body
}

function textValue(value: { toString(): string } | string | number | null | undefined) { return value === null || value === undefined ? '' : value.toString() }
function productLabel(product: ScopeProduct) { return product.productNameSnapshot?.trim() || product.productCodeSnapshot?.trim() || product.manufacturerSnapshot?.trim() || 'Produkt bez nazwy' }
function measurementKind(measurement: Measurement): 'SINGLE' | 'RECTANGLE' { return measurement.kind === 'RECTANGLE' || (measurement.secondaryValue !== null && measurement.secondaryValue !== undefined && textValue(measurement.secondaryValue) !== '') ? 'RECTANGLE' : 'SINGLE' }
function measurementLabel(measurement: Measurement) {
  const value = textValue(measurement.value)
  const secondary = textValue(measurement.secondaryValue)
  return measurementKind(measurement) === 'RECTANGLE' && secondary ? `${measurement.elementName}: ${value} × ${secondary} ${measurement.unit}` : `${measurement.elementName}: ${value} ${measurement.unit}`
}
function emptyProductDraft(): ProductDraft { return { productNameSnapshot: '', manufacturerSnapshot: '', productCodeSnapshot: '', collectionSnapshot: '', batchSnapshot: '' } }
function emptyMeasurementDraft(scopeId: string, kind: 'SINGLE' | 'RECTANGLE'): MeasurementDraft { return { kind, elementName: '', value: '', secondaryValue: '', unit: kind === 'RECTANGLE' ? 'CM' : 'CM', scopeId } }
function normalizedSnapshot(value: string) { return value.trim() || null }

export function RoomScopeEditor({ orderId, initialRooms, catalog, canEdit }: { orderId: string; initialRooms: Room[]; catalog: Catalog; canEdit: boolean }) {
  const [rooms, setRooms] = useState(initialRooms)
  const [roomName, setRoomName] = useState('')
  const [scopeCategoryIds, setScopeCategoryIds] = useState<Record<string, string>>({})
  const [productForms, setProductForms] = useState<Record<string, ProductDraft>>({})
  const [productEditing, setProductEditing] = useState<Record<string, ProductDraft>>({})
  const [measurementForms, setMeasurementForms] = useState<Record<string, MeasurementDraft>>({})
  const [measurementEditing, setMeasurementEditing] = useState<Record<string, MeasurementDraft>>({})
  const [roomEditing, setRoomEditing] = useState<Record<string, string>>({})
  const [scopeEditing, setScopeEditing] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const activeCategories = useMemo(() => catalog.filter((category) => category.isActive !== false), [catalog])

  async function reload() {
    const response = await fetch(`/api/installations/${orderId}/rooms`)
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? 'Nie udało się odczytać pomieszczeń.')
    setRooms(body)
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key); setMessage('')
    try { await action() } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zapisać zmiany.') } finally { setBusy('') }
  }

  async function addRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run('add-room', async () => { await requestJson(`/api/installations/${orderId}/rooms`, { method: 'POST', body: JSON.stringify({ name: roomName }) }); setRoomName(''); await reload() })
  }

  async function addScope(room: Room) {
    const catalogCategoryId = scopeCategoryIds[room.id]
    if (!catalogCategoryId) return
    await run(`add-scope-${room.id}`, async () => { await requestJson(`/api/installations/${orderId}/rooms/${room.id}/scopes`, { method: 'POST', body: JSON.stringify({ catalogCategoryId }) }); setScopeCategoryIds((current) => ({ ...current, [room.id]: '' })); await reload() })
  }

  function updateProductDraft(scopeId: string, field: keyof ProductDraft, value: string) {
    setProductForms((current) => ({ ...current, [scopeId]: { ...(current[scopeId] ?? emptyProductDraft()), [field]: value } }))
  }

  async function addProduct(room: Room, scope: Scope) {
    const draft = productForms[scope.id] ?? emptyProductDraft()
    if (!Object.values(draft).some((value) => typeof value === 'string' && value.trim())) return
    await run(`add-product-${scope.id}`, async () => {
      await requestJson(`/api/installations/${orderId}/rooms/${room.id}/scopes/${scope.id}/products`, { method: 'POST', body: JSON.stringify({ productNameSnapshot: normalizedSnapshot(draft.productNameSnapshot), manufacturerSnapshot: normalizedSnapshot(draft.manufacturerSnapshot), productCodeSnapshot: normalizedSnapshot(draft.productCodeSnapshot), collectionSnapshot: normalizedSnapshot(draft.collectionSnapshot), batchSnapshot: normalizedSnapshot(draft.batchSnapshot) }) })
      setProductForms((current) => ({ ...current, [scope.id]: emptyProductDraft() })); await reload()
    })
  }

  function editProductValue(product: ScopeProduct, field: keyof ProductDraft, value: string) {
    setProductEditing((current) => ({ ...current, [product.id]: { ...(current[product.id] ?? { ...emptyProductDraft(), updatedAt: product.updatedAt ? new Date(product.updatedAt).toISOString() : undefined }), [field]: value } }))
  }

  async function saveProduct(room: Room, scope: Scope, product: ScopeProduct) {
    const draft = productEditing[product.id]
    if (!draft) return
    await run(`edit-product-${product.id}`, async () => {
      await requestJson(`/api/installations/${orderId}/rooms/${room.id}/scopes/${scope.id}/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ productNameSnapshot: normalizedSnapshot(draft.productNameSnapshot), manufacturerSnapshot: normalizedSnapshot(draft.manufacturerSnapshot), productCodeSnapshot: normalizedSnapshot(draft.productCodeSnapshot), collectionSnapshot: normalizedSnapshot(draft.collectionSnapshot), batchSnapshot: normalizedSnapshot(draft.batchSnapshot), updatedAt: draft.updatedAt ?? (product.updatedAt ? new Date(product.updatedAt).toISOString() : new Date().toISOString()) }) })
      setProductEditing((current) => { const next = { ...current }; delete next[product.id]; return next }); await reload()
    })
  }

  async function addMeasurement(room: Room, scopeId: string | null, key: string) {
    const draft = measurementForms[key]
    if (!draft || !draft.elementName.trim() || !draft.value.trim() || (draft.kind === 'RECTANGLE' && !draft.secondaryValue.trim())) return
    await run(`add-measurement-${key}`, async () => {
      const targetScopeId = (scopeId ?? draft.scopeId) || null
      const body = draft.kind === 'RECTANGLE'
        ? { kind: draft.kind, elementName: draft.elementName, value: draft.value, secondaryValue: draft.secondaryValue, unit: draft.unit, scopeId: targetScopeId }
        : { kind: draft.kind, elementName: draft.elementName, value: draft.value, unit: draft.unit, scopeId: targetScopeId }
      await requestJson(`/api/installations/${orderId}/rooms/${room.id}/measurements`, { method: 'POST', body: JSON.stringify(body) })
      setMeasurementForms((current) => ({ ...current, [key]: emptyMeasurementDraft(targetScopeId ?? '', draft.kind) })); await reload()
    })
  }

  function editMeasurementValue(measurement: Measurement, field: keyof MeasurementDraft, value: string) {
    setMeasurementEditing((current) => ({ ...current, [measurement.id]: { ...(current[measurement.id] ?? { kind: measurementKind(measurement), elementName: measurement.elementName, value: textValue(measurement.value), secondaryValue: textValue(measurement.secondaryValue), unit: measurement.unit, scopeId: measurement.scopeId ?? '' }), [field]: value } }))
  }

  async function saveMeasurement(room: Room, measurement: Measurement) {
    const draft = measurementEditing[measurement.id]
    if (!draft) return
    await run(`edit-measurement-${measurement.id}`, async () => {
      await requestJson(`/api/installations/${orderId}/rooms/${room.id}/measurements/${measurement.id}`, { method: 'PATCH', body: JSON.stringify({ kind: draft.kind, elementName: draft.elementName, value: draft.value, secondaryValue: draft.kind === 'RECTANGLE' ? draft.secondaryValue : null, unit: draft.unit, scopeId: draft.scopeId || null }) })
      setMeasurementEditing((current) => { const next = { ...current }; delete next[measurement.id]; return next }); await reload()
    })
  }

  async function reorder(path: string, ids: string[], id: string, direction: -1 | 1) {
    const position = ids.indexOf(id); const next = position + direction
    if (position < 0 || next < 0 || next >= ids.length) return
    const orderedIds = [...ids]; [orderedIds[position], orderedIds[next]] = [orderedIds[next], orderedIds[position]]
    await run(`reorder-${id}`, async () => { await requestJson(path, { method: 'PUT', body: JSON.stringify({ orderedIds }) }); await reload() })
  }

  const inputStyle = { background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.14)' }
  const updateMeasurementForm = (key: string, patch: Partial<MeasurementDraft>, fallback: MeasurementDraft) => setMeasurementForms((current) => ({ ...current, [key]: { ...(current[key] ?? fallback), ...patch } }))
  const generalMeasurementKey = (room: Room) => `general-${room.id}`

  function renderMeasurementForm(room: Room, scopeId: string | null, key: string, scopeName?: string) {
    const isScope = Boolean(scopeId)
    const draft = measurementForms[key] ?? emptyMeasurementDraft(scopeId ?? '', isScope ? 'RECTANGLE' : 'SINGLE')
    const labelSuffix = isScope ? `dla ${scopeName}` : `w ${room.name}`
    const units = draft.kind === 'RECTANGLE' ? ['MM', 'CM', 'M'] : ['MM', 'CM', 'M', 'M2', 'MB', 'SZT']
    const valid = draft.elementName.trim() !== '' && draft.value.trim() !== '' && (draft.kind !== 'RECTANGLE' || draft.secondaryValue.trim() !== '')
    return <form onSubmit={(event) => { event.preventDefault(); void addMeasurement(room, scopeId, key) }} className="mt-3 grid gap-2 rounded-lg border p-3" style={{ borderColor: 'rgba(30,30,30,.1)', background: 'var(--wd-sand-light)' }}>
      {isScope && <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="button" size="sm" variant={draft.kind === 'RECTANGLE' ? 'default' : 'outline'} aria-pressed={draft.kind === 'RECTANGLE'} onClick={() => updateMeasurementForm(key, { kind: 'RECTANGLE', secondaryValue: draft.secondaryValue, unit: ['MM', 'CM', 'M'].includes(draft.unit) ? draft.unit : 'CM' }, emptyMeasurementDraft(scopeId ?? '', 'RECTANGLE'))}>Szerokość × wysokość</Button><Button type="button" size="sm" variant={draft.kind === 'SINGLE' ? 'default' : 'outline'} aria-pressed={draft.kind === 'SINGLE'} onClick={() => updateMeasurementForm(key, { kind: 'SINGLE', secondaryValue: '', unit: draft.unit }, emptyMeasurementDraft(scopeId ?? '', 'SINGLE'))}>Długość / ilość</Button></div>}
      <div><Label htmlFor={`${key}-element`}>Nazwa pomiaru {labelSuffix}</Label><Input id={`${key}-element`} aria-label={`Nazwa pomiaru ${labelSuffix}`} value={draft.elementName} onChange={(event) => updateMeasurementForm(key, { elementName: event.target.value }, draft)} className="min-h-11" style={inputStyle} /></div>
      <div><Label htmlFor={`${key}-value`}>{draft.kind === 'RECTANGLE' ? `Szerokość pomiaru ${labelSuffix}` : `Wartość pomiaru ${labelSuffix}`}</Label><Input id={`${key}-value`} aria-label={`${draft.kind === 'RECTANGLE' ? 'Szerokość' : 'Wartość'} pomiaru ${labelSuffix}`} inputMode="decimal" value={draft.value} onChange={(event) => updateMeasurementForm(key, { value: event.target.value }, draft)} className="min-h-11" style={inputStyle} /></div>
      {draft.kind === 'RECTANGLE' && <div><Label htmlFor={`${key}-secondary`}>Wysokość pomiaru {labelSuffix}</Label><Input id={`${key}-secondary`} aria-label={`Wysokość pomiaru ${labelSuffix}`} inputMode="decimal" value={draft.secondaryValue} onChange={(event) => updateMeasurementForm(key, { secondaryValue: event.target.value }, draft)} className="min-h-11" style={inputStyle} /></div>}
      <div><Label htmlFor={`${key}-unit`}>Jednostka pomiaru {labelSuffix}</Label><select id={`${key}-unit`} aria-label={`Jednostka pomiaru ${labelSuffix}`} value={draft.unit} onChange={(event) => updateMeasurementForm(key, { unit: event.target.value }, draft)} className="min-h-11 w-full rounded-lg border px-3 text-sm" style={inputStyle}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></div>
      {!isScope && <div className="sm:col-span-2"><Label htmlFor={`${key}-scope`}>Przypisz pomiar do zakresu</Label><select id={`${key}-scope`} aria-label={`Zakres pomiaru w ${room.name}`} value={draft.scopeId} onChange={(event) => updateMeasurementForm(key, { scopeId: event.target.value }, draft)} className="min-h-11 w-full rounded-lg border px-3 text-sm" style={inputStyle}><option value="">Pomiar ogólny pomieszczenia</option>{room.scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select></div>}
      <Button type="submit" disabled={!valid || busy === `add-measurement-${key}`} className="min-h-11 sm:col-span-2" style={{ background: '#A96A20', color: '#fff' }}><Plus />{isScope ? `Dodaj pomiar do ${scopeName}` : 'Dodaj pomiar'}</Button>
    </form>
  }

  function renderMeasurementEdit(room: Room, measurement: Measurement) {
    const draft = measurementEditing[measurement.id]
    if (!draft) return null
    const units = draft.kind === 'RECTANGLE' ? ['MM', 'CM', 'M'] : ['MM', 'CM', 'M', 'M2', 'MB', 'SZT']
    return <form className="grid w-full gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void saveMeasurement(room, measurement) }}>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="button" size="sm" variant={draft.kind === 'RECTANGLE' ? 'default' : 'outline'} onClick={() => { editMeasurementValue(measurement, 'kind', 'RECTANGLE'); if (!['MM', 'CM', 'M'].includes(draft.unit)) editMeasurementValue(measurement, 'unit', 'CM') }}>Szerokość × wysokość</Button><Button type="button" size="sm" variant={draft.kind === 'SINGLE' ? 'default' : 'outline'} onClick={() => editMeasurementValue(measurement, 'kind', 'SINGLE')}>Długość / ilość</Button></div>
      <Input aria-label={`Nazwa pomiaru ${measurement.elementName}`} value={draft.elementName} onChange={(event) => editMeasurementValue(measurement, 'elementName', event.target.value)} className="min-h-11" style={inputStyle} />
      <Input aria-label={`${draft.kind === 'RECTANGLE' ? 'Szerokość' : 'Wartość'} pomiaru ${measurement.elementName}`} value={draft.value} onChange={(event) => editMeasurementValue(measurement, 'value', event.target.value)} className="min-h-11" style={inputStyle} />
      {draft.kind === 'RECTANGLE' && <Input aria-label={`Wysokość pomiaru ${measurement.elementName}`} value={draft.secondaryValue} onChange={(event) => editMeasurementValue(measurement, 'secondaryValue', event.target.value)} className="min-h-11" style={inputStyle} />}
      <select aria-label={`Jednostka pomiaru ${measurement.elementName}`} value={draft.unit} onChange={(event) => editMeasurementValue(measurement, 'unit', event.target.value)} className="min-h-11 rounded-lg border px-3" style={inputStyle}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select>
      <select aria-label={`Zakres pomiaru ${measurement.elementName}`} value={draft.scopeId} onChange={(event) => editMeasurementValue(measurement, 'scopeId', event.target.value)} className="min-h-11 rounded-lg border px-3 sm:col-span-2" style={inputStyle}><option value="">Pomiary ogólne pomieszczenia</option>{room.scopes.map((scope) => <option key={scope.id} value={scope.id}>{scope.name}</option>)}</select>
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" size="sm"><Save className="h-3.5 w-3.5" />Zapisz pomiar</Button><Button type="button" size="sm" variant="ghost" onClick={() => setMeasurementEditing((current) => { const next = { ...current }; delete next[measurement.id]; return next })}><X className="h-3.5 w-3.5" /></Button></div>
    </form>
  }

  return <section aria-labelledby="room-scope-heading" className="mt-7 rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="data-label" style={{ color: '#8C5718' }}>Mapa zlecenia</p><h2 id="room-scope-heading" className="mt-1 text-xl font-extrabold" style={{ color: 'var(--wd-dark)' }}>Pokoje, zakresy, produkty i pomiary</h2><p className="mt-2 max-w-xl text-sm" style={{ color: 'var(--wd-text-muted)' }}>Każdy zakres ma własne produkty zamówienia i pomiary. Dane produktów są zapisywane jako historyczna migawka.</p></div></div>
    {message && <p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}
    {canEdit && <form onSubmit={addRoom} className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border p-3" style={{ borderColor: 'rgba(30, 30, 30, .1)', background: 'var(--wd-off-white)' }}><div className="min-w-56 flex-1"><Label htmlFor="room-name">Nazwa pomieszczenia</Label><Input id="room-name" aria-label="Nazwa pomieszczenia" value={roomName} onChange={(event) => setRoomName(event.target.value)} style={inputStyle} /></div><Button type="submit" disabled={busy === 'add-room'} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus />{busy === 'add-room' ? 'Dodawanie…' : 'Dodaj pomieszczenie'}</Button></form>}
    {rooms.length === 0 ? <div className="mt-5 rounded-xl border px-4 py-8 text-center text-sm" style={{ borderColor: 'rgba(30,30,30,.12)', background: 'var(--wd-off-white)', color: 'var(--wd-text-muted)' }}>Brak pomieszczeń. Dodaj pierwsze miejsce montażu, aby zbudować mapę zlecenia.</div> : <div className="mt-5 space-y-4">{rooms.map((room, roomIndex) => <article key={room.id} className="min-w-0 rounded-xl border p-4" style={{ borderColor: 'rgba(30,30,30,.12)', background: 'var(--wd-off-white)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div>{roomEditing[room.id] !== undefined ? <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(`edit-room-${room.id}`, async () => { await requestJson(`/api/installations/${orderId}/rooms/${room.id}`, { method: 'PATCH', body: JSON.stringify({ name: roomEditing[room.id] }) }); setRoomEditing((current) => { const next = { ...current }; delete next[room.id]; return next }); await reload() }) }}><Input aria-label={`Nowa nazwa pokoju ${room.name}`} value={roomEditing[room.id]} onChange={(event) => setRoomEditing((current) => ({ ...current, [room.id]: event.target.value }))} className="min-h-11" style={inputStyle} /><Button type="submit" size="sm"><Save className="h-3.5 w-3.5" />Zapisz</Button><Button type="button" size="sm" variant="ghost" onClick={() => setRoomEditing((current) => { const next = { ...current }; delete next[room.id]; return next })}><X className="h-3.5 w-3.5" /></Button></form> : <h3 className="text-lg font-extrabold" style={{ color: 'var(--wd-dark)' }}>{room.name}</h3>}</div>{canEdit && <div className="flex flex-wrap items-center gap-1"><Button type="button" size="sm" variant="ghost" disabled={roomIndex === 0} onClick={() => reorder(`/api/installations/${orderId}/rooms/reorder`, rooms.map((item) => item.id), room.id, -1)} aria-label={`Przesuń pokój ${room.name} wyżej`}><ChevronUp /></Button><Button type="button" size="sm" variant="ghost" disabled={roomIndex === rooms.length - 1} onClick={() => reorder(`/api/installations/${orderId}/rooms/reorder`, rooms.map((item) => item.id), room.id, 1)} aria-label={`Przesuń pokój ${room.name} niżej`}><ChevronDown /></Button><Button type="button" size="sm" variant="ghost" onClick={() => setRoomEditing((current) => ({ ...current, [room.id]: room.name }))} aria-label={`Edytuj pokój ${room.name}`}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="sm" variant="ghost" onClick={() => void run(`delete-room-${room.id}`, async () => { await requestJson(`/api/installations/${orderId}/rooms/${room.id}`, { method: 'DELETE' }); await reload() })} aria-label={`Usuń pokój ${room.name}`} className="text-red-800"><Trash2 className="h-4 w-4" /></Button></div>}</div>
      <div className="mt-4 space-y-3 border-l pl-3" style={{ borderColor: 'rgba(169,106,32,.28)' }}>{room.scopes.map((scope, scopeIndex) => {
        const productDraft = productForms[scope.id] ?? emptyProductDraft()
        const hasProductValues = Object.values(productDraft).some((value) => typeof value === 'string' && value.trim())
        return <div key={scope.id} className="min-w-0 rounded-lg border p-3" style={{ borderColor: 'rgba(30,30,30,.1)', background: 'var(--wd-white)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2">{scopeEditing[scope.id] !== undefined ? <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void run(`edit-scope-${scope.id}`, async () => { await requestJson(`/api/installations/${orderId}/rooms/${room.id}/scopes/${scope.id}`, { method: 'PATCH', body: JSON.stringify({ name: scopeEditing[scope.id] }) }); setScopeEditing((current) => { const next = { ...current }; delete next[scope.id]; return next }); await reload() }) }}><Input aria-label={`Nowa nazwa zakresu ${scope.name}`} value={scopeEditing[scope.id]} onChange={(event) => setScopeEditing((current) => ({ ...current, [scope.id]: event.target.value }))} className="min-h-11" style={inputStyle} /><Button type="submit" size="sm"><Save className="h-3.5 w-3.5" />Zapisz</Button></form> : <h4 className="font-bold text-sm" style={{ color: 'var(--wd-dark)' }}>{scope.name}</h4>}{canEdit && <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="ghost" disabled={scopeIndex === 0} onClick={() => reorder(`/api/installations/${orderId}/rooms/${room.id}/scopes/reorder`, room.scopes.map((item) => item.id), scope.id, -1)} aria-label={`Przesuń zakres ${scope.name} wyżej`}><ChevronUp /></Button><Button type="button" size="sm" variant="ghost" disabled={scopeIndex === room.scopes.length - 1} onClick={() => reorder(`/api/installations/${orderId}/rooms/${room.id}/scopes/reorder`, room.scopes.map((item) => item.id), scope.id, 1)} aria-label={`Przesuń zakres ${scope.name} niżej`}><ChevronDown /></Button><Button type="button" size="sm" variant="ghost" onClick={() => setScopeEditing((current) => ({ ...current, [scope.id]: scope.name }))} aria-label={`Edytuj zakres ${scope.name}`}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="sm" variant="ghost" onClick={() => { if ((scope.scopeProducts.length > 0 || scope.measurements.length > 0) && !window.confirm(`Usunąć zakres ${scope.name} wraz z produktami i pomiarami?`)) return; void run(`delete-scope-${scope.id}`, async () => { await requestJson(`/api/installations/${orderId}/rooms/${room.id}/scopes/${scope.id}`, { method: 'DELETE' }); await reload() }) }} aria-label={`Usuń zakres ${scope.name}`} className="text-red-800"><Trash2 className="h-4 w-4" /></Button></div>}</div>
          <section className="mt-4 border-t pt-3" style={{ borderColor: 'rgba(30,30,30,.08)' }}><h5 className="text-sm font-bold" style={{ color: 'var(--wd-dark)' }}>Produkty</h5>{scope.scopeProducts.length > 0 && <ul className="mt-2 space-y-2">{scope.scopeProducts.map((product, productIndex) => { const editing = productEditing[product.id]; const label = productLabel(product); return <li key={product.id} className="min-w-0 rounded-md px-2 py-2 text-sm" style={{ background: 'var(--wd-sand-light)' }}>{editing ? <form className="grid gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void saveProduct(room, scope, product) }}><Input aria-label={`Nazwa produktu ${label}`} value={editing.productNameSnapshot} onChange={(event) => editProductValue(product, 'productNameSnapshot', event.target.value)} placeholder="Nazwa" className="min-h-11" style={inputStyle} /><Input aria-label={`Producent produktu ${label}`} value={editing.manufacturerSnapshot} onChange={(event) => editProductValue(product, 'manufacturerSnapshot', event.target.value)} placeholder="Producent" className="min-h-11" style={inputStyle} /><Input aria-label={`Kod / SKU produktu ${label}`} value={editing.productCodeSnapshot} onChange={(event) => editProductValue(product, 'productCodeSnapshot', event.target.value)} placeholder="Kod / SKU" className="min-h-11" style={inputStyle} /><Input aria-label={`Kolekcja / seria produktu ${label}`} value={editing.collectionSnapshot} onChange={(event) => editProductValue(product, 'collectionSnapshot', event.target.value)} placeholder="Kolekcja / seria" className="min-h-11" style={inputStyle} /><Input aria-label={`Partia produktu ${label}`} value={editing.batchSnapshot} onChange={(event) => editProductValue(product, 'batchSnapshot', event.target.value)} placeholder="Partia" className="min-h-11" style={inputStyle} /><div className="flex items-center gap-2"><Button type="submit" size="sm"><Save className="h-3.5 w-3.5" />Zapisz produkt {label}</Button><Button type="button" size="sm" variant="ghost" aria-label={`Anuluj edycję produktu ${label}`} onClick={() => setProductEditing((current) => { const next = { ...current }; delete next[product.id]; return next })}><X className="h-3.5 w-3.5" /></Button></div></form> : <div className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-semibold">{label}</span>{product.productCodeSnapshot && <span className="num ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{product.productCodeSnapshot}</span>}{product.manufacturerSnapshot && <span className="ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{product.manufacturerSnapshot}</span>}{product.collectionSnapshot && <span className="ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Kolekcja: {product.collectionSnapshot}</span>}{product.batchSnapshot && <span className="ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>Partia: {product.batchSnapshot}</span>}</span>{canEdit && <div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setProductEditing((current) => ({ ...current, [product.id]: { productNameSnapshot: product.productNameSnapshot ?? '', manufacturerSnapshot: product.manufacturerSnapshot ?? '', productCodeSnapshot: product.productCodeSnapshot ?? '', collectionSnapshot: product.collectionSnapshot ?? '', batchSnapshot: product.batchSnapshot ?? '', updatedAt: product.updatedAt } }))} aria-label={`Edytuj produkt ${label}`}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="sm" variant="ghost" disabled={productIndex === 0} onClick={() => reorder(`/api/installations/${orderId}/rooms/${room.id}/scopes/${scope.id}/products/reorder`, scope.scopeProducts.map((item) => item.id), product.id, -1)} aria-label={`Przesuń produkt ${label} wyżej`}><ChevronUp /></Button><Button type="button" size="sm" variant="ghost" disabled={productIndex === scope.scopeProducts.length - 1} onClick={() => reorder(`/api/installations/${orderId}/rooms/${room.id}/scopes/${scope.id}/products/reorder`, scope.scopeProducts.map((item) => item.id), product.id, 1)} aria-label={`Przesuń produkt ${label} niżej`}><ChevronDown /></Button><Button type="button" size="sm" variant="ghost" onClick={() => void run(`delete-product-${product.id}`, async () => { await requestJson(`/api/installations/${orderId}/rooms/${room.id}/scopes/${scope.id}/products/${product.id}`, { method: 'DELETE' }); await reload() })} aria-label={`Usuń produkt ${label} z zakresu`} className="text-red-800"><Trash2 className="h-4 w-4" /></Button></div>}</div>}</li> })}</ul>}
            {canEdit && <div className="mt-3 grid gap-2 sm:grid-cols-2"><Input aria-label={`Nazwa produktu dla ${scope.name}`} placeholder="Nazwa produktu (opcjonalnie)" value={productDraft.productNameSnapshot} onChange={(event) => updateProductDraft(scope.id, 'productNameSnapshot', event.target.value)} className="min-h-11" style={inputStyle} /><Input aria-label={`Producent produktu dla ${scope.name}`} placeholder="Producent (opcjonalnie)" value={productDraft.manufacturerSnapshot} onChange={(event) => updateProductDraft(scope.id, 'manufacturerSnapshot', event.target.value)} className="min-h-11" style={inputStyle} /><Input aria-label={`Kod / SKU produktu dla ${scope.name}`} placeholder="Kod / SKU (opcjonalnie)" value={productDraft.productCodeSnapshot} onChange={(event) => updateProductDraft(scope.id, 'productCodeSnapshot', event.target.value)} className="min-h-11" style={inputStyle} /><Input aria-label={`Kolekcja / seria produktu dla ${scope.name}`} placeholder="Kolekcja / seria (opcjonalnie)" value={productDraft.collectionSnapshot} onChange={(event) => updateProductDraft(scope.id, 'collectionSnapshot', event.target.value)} className="min-h-11" style={inputStyle} /><Input aria-label={`Partia produktu dla ${scope.name}`} placeholder="Partia (opcjonalnie)" value={productDraft.batchSnapshot} onChange={(event) => updateProductDraft(scope.id, 'batchSnapshot', event.target.value)} className="min-h-11" style={inputStyle} /><Button type="button" disabled={!hasProductValues || busy === `add-product-${scope.id}`} onClick={() => void addProduct(room, scope)} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus />{busy === `add-product-${scope.id}` ? 'Dodawanie…' : `Dodaj produkt do ${scope.name}`}</Button></div>}
          </section>
          <section className="mt-4 border-t pt-3" style={{ borderColor: 'rgba(30,30,30,.08)' }}><div className="flex items-center gap-2"><Ruler className="h-4 w-4" style={{ color: '#8C5718' }} /><h5 className="text-sm font-bold" style={{ color: 'var(--wd-dark)' }}>Pomiary</h5></div>{scope.measurements.length === 0 ? <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak pomiarów tego zakresu.</p> : <ul className="mt-2 space-y-2">{scope.measurements.map((measurement) => <li key={measurement.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--wd-sand-light)' }}>{measurementEditing[measurement.id] ? renderMeasurementEdit(room, measurement) : <span className="min-w-0 truncate"><span className="font-semibold">{measurementLabel(measurement)}</span></span>}{canEdit && !measurementEditing[measurement.id] && <div className="flex gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setMeasurementEditing((current) => ({ ...current, [measurement.id]: { kind: measurementKind(measurement), elementName: measurement.elementName, value: textValue(measurement.value), secondaryValue: textValue(measurement.secondaryValue), unit: measurement.unit, scopeId: measurement.scopeId ?? scope.id } }))} aria-label={`Popraw pomiar ${measurement.elementName}`}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="sm" variant="ghost" onClick={() => void run(`delete-measurement-${measurement.id}`, async () => { await requestJson(`/api/installations/${orderId}/rooms/${room.id}/measurements/${measurement.id}`, { method: 'DELETE' }); await reload() })} aria-label={`Usuń pomiar ${measurement.elementName}`} className="text-red-800"><Trash2 className="h-4 w-4" /></Button></div>}</li>)}</ul>}{canEdit && renderMeasurementForm(room, scope.id, scope.id, scope.name)}</section>
        </div>
      })}</div>
      {canEdit && <div className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-56 flex-1"><Label htmlFor={`scope-category-${room.id}`}>Rodzaj prac dla {room.name}</Label><select id={`scope-category-${room.id}`} aria-label={`Rodzaj prac dla ${room.name}`} value={scopeCategoryIds[room.id] ?? ''} onChange={(event) => setScopeCategoryIds((current) => ({ ...current, [room.id]: event.target.value }))} className="min-h-11 w-full rounded-lg border px-3 text-sm" style={inputStyle}><option value="">Wybierz aktywny rodzaj prac</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><Button type="button" disabled={!scopeCategoryIds[room.id] || busy === `add-scope-${room.id}`} onClick={() => void addScope(room)} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus />{busy === `add-scope-${room.id}` ? 'Dodawanie…' : `Dodaj zakres w ${room.name}`}</Button></div>}
      <section className="mt-5 border-t pt-4" style={{ borderColor: 'rgba(30,30,30,.1)' }}><div className="flex items-center gap-2"><Ruler className="h-4 w-4" style={{ color: '#8C5718' }} /><h4 className="text-sm font-bold" style={{ color: 'var(--wd-dark)' }}>Pomiary ogólne pomieszczenia</h4></div>{room.measurements.length === 0 ? <p className="mt-2 text-sm" style={{ color: 'var(--wd-text-muted)' }}>Brak pomiarów ogólnych pomieszczenia.</p> : <ul className="mt-2 space-y-2">{room.measurements.map((measurement) => <li key={measurement.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--wd-white)' }}>{measurementEditing[measurement.id] ? renderMeasurementEdit(room, measurement) : <span className="min-w-0 truncate">{measurementLabel(measurement)}</span>}{canEdit && !measurementEditing[measurement.id] && <div className="flex gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setMeasurementEditing((current) => ({ ...current, [measurement.id]: { kind: measurementKind(measurement), elementName: measurement.elementName, value: textValue(measurement.value), secondaryValue: textValue(measurement.secondaryValue), unit: measurement.unit, scopeId: measurement.scopeId ?? '' } }))} aria-label={`Popraw pomiar ${measurement.elementName}`}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" size="sm" variant="ghost" onClick={() => void run(`delete-measurement-${measurement.id}`, async () => { await requestJson(`/api/installations/${orderId}/rooms/${room.id}/measurements/${measurement.id}`, { method: 'DELETE' }); await reload() })} aria-label={`Usuń pomiar ${measurement.elementName}`} className="text-red-800"><Trash2 className="h-4 w-4" /></Button></div>}</li>)}</ul>}{canEdit && renderMeasurementForm(room, null, generalMeasurementKey(room))}</section>
    </article>)}</div>}
  </section>
}
