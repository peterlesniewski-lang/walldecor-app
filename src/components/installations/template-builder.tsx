'use client'

import { FormEvent, useMemo, useState } from 'react'
import { CopyPlus, Plus, Save, Send, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type RawQuestion = { key: string; type: string; label: string; help: string | null; riskLevel: string; optionsJson: string | null; conditionJson: string | null }
type RawTemplate = { id: string; familyId: string; name: string; version: number; status: string; questionDefinitions: RawQuestion[] }
type EditableQuestion = { key: string; type: string; label: string; help?: string; riskLevel?: string; options?: string[]; condition?: { questionKey: string; equals: string } }

const EMPTY_QUESTION: EditableQuestion = { key: '', type: 'YES_NO_UNKNOWN', label: '', help: '', riskLevel: 'LOW' }

function parseQuestions(template: RawTemplate): EditableQuestion[] {
  return template.questionDefinitions.map((question) => ({
    key: question.key, type: question.type, label: question.label, ...(question.help ? { help: question.help } : {}), ...(question.riskLevel ? { riskLevel: question.riskLevel } : {}),
    ...(question.optionsJson ? { options: JSON.parse(question.optionsJson) } : {}), ...(question.conditionJson ? { condition: JSON.parse(question.conditionJson) } : {}),
  }))
}

async function requestJson(path: string, options: RequestInit) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? 'Nie udało się zapisać szablonu.')
  return body
}

export function TemplateBuilder({ initialTemplates }: { initialTemplates: RawTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [templateName, setTemplateName] = useState('')
  const [activeDraftId, setActiveDraftId] = useState<string | null>(initialTemplates.find((template) => template.status === 'DRAFT')?.id ?? null)
  const [question, setQuestion] = useState<EditableQuestion>(EMPTY_QUESTION)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const activeDraft = useMemo(() => templates.find((template) => template.id === activeDraftId && template.status === 'DRAFT') ?? null, [templates, activeDraftId])
  const savedQuestions = activeDraft ? parseQuestions(activeDraft) : []

  function replaceTemplate(template: RawTemplate) {
    setTemplates((current) => current.some((item) => item.id === template.id) ? current.map((item) => item.id === template.id ? template : item) : [template, ...current])
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('create'); setMessage('')
    try {
      const template = await requestJson('/api/installations/templates', { method: 'POST', body: JSON.stringify({ name: templateName }) })
      replaceTemplate(template); setActiveDraftId(template.id); setTemplateName(''); setQuestion(EMPTY_QUESTION)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się utworzyć szkicu.') } finally { setBusy('') }
  }

  async function saveQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeDraft) return
    setBusy('question'); setMessage('')
    const normalized: EditableQuestion = {
      key: question.key.trim(), type: question.type, label: question.label.trim(), riskLevel: question.riskLevel ?? 'LOW',
      ...(question.help?.trim() ? { help: question.help.trim() } : {}),
      ...(question.options && question.options.length > 0 ? { options: question.options } : {}),
      ...(question.condition?.questionKey.trim() && question.condition.equals.trim() ? { condition: { questionKey: question.condition.questionKey.trim(), equals: question.condition.equals.trim() } } : {}),
    }
    const next = [...savedQuestions.filter((item) => item.key !== normalized.key), normalized]
    try {
      const template = await requestJson(`/api/installations/templates/${activeDraft.id}`, { method: 'PATCH', body: JSON.stringify({ questions: next }) })
      replaceTemplate(template); setQuestion(EMPTY_QUESTION)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się zapisać pytania.') } finally { setBusy('') }
  }

  async function publish() {
    if (!activeDraft) return
    setBusy('publish'); setMessage('')
    try {
      const template = await requestJson(`/api/installations/templates/${activeDraft.id}/publish`, { method: 'POST' })
      replaceTemplate(template); setActiveDraftId(null); setMessage(`Opublikowano wersję ${template.version}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się opublikować.') } finally { setBusy('') }
  }

  async function nextDraft(template: RawTemplate) {
    setBusy(`next-${template.id}`); setMessage('')
    try { const draft = await requestJson(`/api/installations/templates/${template.id}/next-draft`, { method: 'POST' }); replaceTemplate(draft); setActiveDraftId(draft.id); setQuestion(EMPTY_QUESTION) } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się utworzyć następnej wersji.') } finally { setBusy('') }
  }

  const inputStyle = { background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.14)' }
  return <section aria-labelledby="template-builder-heading" className="rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="data-label" style={{ color: '#8C5718' }}>Wersjonowany formularz</p><h2 id="template-builder-heading" className="mt-1 text-xl font-extrabold" style={{ color: 'var(--wd-dark)' }}>Kreator pytań</h2></div><p className="max-w-sm text-sm" style={{ color: 'var(--wd-text-muted)' }}>Publikacja zamyka wersję. Kolejna zmiana powstaje jako nowy szkic, dlatego snapshot zlecenia nigdy nie zmienia historii.</p></div>
    <form onSubmit={createDraft} className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border p-3" style={{ borderColor: 'rgba(30, 30, 30, 0.1)', background: 'var(--wd-off-white)' }}><div className="min-w-56 flex-1"><Label htmlFor="template-name">Nazwa szablonu</Label><Input id="template-name" aria-label="Nazwa szablonu" value={templateName} onChange={(event) => setTemplateName(event.target.value)} style={inputStyle} /></div><Button type="submit" disabled={busy === 'create'} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus />{busy === 'create' ? 'Tworzenie…' : 'Utwórz szkic'}</Button></form>
    {message && <p role={message.startsWith('Opublikowano') ? 'status' : 'alert'} className={`mt-3 text-sm ${message.startsWith('Opublikowano') ? 'text-green-800' : 'text-red-700'}`}>{message}</p>}
    {activeDraft && <div className="mt-5 rounded-xl border p-4" style={{ borderColor: 'rgba(169,106,32,.35)', background: 'var(--wd-off-white)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="data-label" style={{ color: '#8C5718' }}>Szkic v{activeDraft.version}</p><h3 className="font-extrabold" style={{ color: 'var(--wd-dark)' }}>{activeDraft.name}</h3></div><Button type="button" onClick={publish} disabled={busy === 'publish' || savedQuestions.length === 0} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Send />{busy === 'publish' ? 'Publikowanie…' : `Opublikuj v${activeDraft.version}`}</Button></div>
      {savedQuestions.length > 0 && <ol className="mt-4 space-y-2">{savedQuestions.map((item) => <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--wd-white)' }}><span><span className="num text-xs" style={{ color: '#8C5718' }}>{item.key}</span><span className="ml-2 font-semibold">{item.label}</span><span className="ml-2 text-xs" style={{ color: 'var(--wd-text-muted)' }}>{item.type}</span></span><div className="flex gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setQuestion(item)} aria-label={`Edytuj pytanie ${item.key}`}>Edytuj</Button><Button type="button" size="sm" variant="ghost" onClick={async () => { setBusy('question'); try { const template = await requestJson(`/api/installations/templates/${activeDraft.id}`, { method: 'PATCH', body: JSON.stringify({ questions: savedQuestions.filter((question) => question.key !== item.key) }) }); replaceTemplate(template) } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się usunąć pytania.') } finally { setBusy('') } }} aria-label={`Usuń pytanie ${item.key}`} className="text-red-800"><Trash2 className="h-3.5 w-3.5" /></Button></div></li>)}</ol>}
      <form onSubmit={saveQuestion} className="mt-4 grid gap-3 rounded-xl border p-3 sm:grid-cols-2" style={{ borderColor: 'rgba(30, 30, 30, 0.1)', background: 'var(--wd-white)' }}>
        <div><Label htmlFor="question-key">Klucz pytania</Label><Input id="question-key" aria-label="Klucz pytania" value={question.key} onChange={(event) => setQuestion((current) => ({ ...current, key: event.target.value }))} style={inputStyle} /></div>
        <div><Label htmlFor="question-label">Etykieta pytania</Label><Input id="question-label" aria-label="Etykieta pytania" value={question.label} onChange={(event) => setQuestion((current) => ({ ...current, label: event.target.value }))} style={inputStyle} /></div>
        <div><Label htmlFor="question-type">Typ pytania</Label><select id="question-type" aria-label="Typ pytania" value={question.type} onChange={(event) => setQuestion((current) => ({ ...current, type: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2" style={inputStyle}>{['YES_NO_UNKNOWN', 'NUMBER', 'DIMENSION', 'TEXT', 'SINGLE', 'MULTI', 'FILE'].map((type) => <option key={type} value={type}>{type}</option>)}</select></div>
        <div><Label htmlFor="question-risk">Poziom ryzyka</Label><select id="question-risk" value={question.riskLevel ?? 'LOW'} onChange={(event) => setQuestion((current) => ({ ...current, riskLevel: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2" style={inputStyle}>{['LOW', 'MEDIUM', 'HIGH'].map((risk) => <option key={risk} value={risk}>{risk}</option>)}</select></div>
        <div className="sm:col-span-2"><Label htmlFor="question-help">Pomoc dla klienta</Label><Input id="question-help" value={question.help ?? ''} onChange={(event) => setQuestion((current) => ({ ...current, help: event.target.value }))} style={inputStyle} /></div>
        {(question.type === 'SINGLE' || question.type === 'MULTI') && <div className="sm:col-span-2"><Label htmlFor="question-options">Opcje (oddzielone przecinkami)</Label><Input id="question-options" value={(question.options ?? []).join(', ')} onChange={(event) => setQuestion((current) => ({ ...current, options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} style={inputStyle} /></div>}
        <div><Label htmlFor="condition-key">Warunek: klucz pytania</Label><Input id="condition-key" value={question.condition?.questionKey ?? ''} onChange={(event) => setQuestion((current) => ({ ...current, condition: { questionKey: event.target.value, equals: current.condition?.equals ?? '' } }))} style={inputStyle} /></div>
        <div><Label htmlFor="condition-equals">Warunek: równa się</Label><Input id="condition-equals" value={question.condition?.equals ?? ''} onChange={(event) => setQuestion((current) => ({ ...current, condition: { questionKey: current.condition?.questionKey ?? '', equals: event.target.value } }))} style={inputStyle} /></div>
        <div className="sm:col-span-2 flex justify-end"><Button type="submit" disabled={busy === 'question'} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Save />{busy === 'question' ? 'Zapisywanie…' : 'Zapisz pytanie'}</Button></div>
      </form>
    </div>}
    {templates.filter((template) => template.status === 'PUBLISHED').length > 0 && <div className="mt-5 space-y-2">{templates.filter((template) => template.status === 'PUBLISHED').map((template) => <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: 'rgba(30, 30, 30, 0.12)', background: 'var(--wd-white)' }}><div><span className="num text-xs" style={{ color: '#8C5718' }}>v{template.version}</span><h3 className="font-bold" style={{ color: 'var(--wd-dark)' }}>{template.name}</h3></div><Button type="button" variant="outline" disabled={busy === `next-${template.id}`} onClick={() => nextDraft(template)} className="min-h-11"><CopyPlus />{busy === `next-${template.id}` ? 'Tworzenie…' : 'Nowy szkic'}</Button></div>)}</div>}
  </section>
}
