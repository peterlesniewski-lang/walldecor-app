'use client'

import { FormEvent, useCallback, useMemo, useRef, useState } from 'react'
import { CopyPlus, Plus, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FormQuestion } from '@/lib/installations/form-visibility'
import { buildQuestionForest } from '@/lib/installations/question-tree'
import { validateInstallationQuestionDefinitions } from '@/lib/installations/question-schema'
import { TemplatePathDesigner } from './template-path-designer'

type RawQuestion = { key: string; type: string; label: string; help: string | null; required?: boolean; riskLevel: string; optionsJson: string | null; conditionJson: string | null }
type RawTemplate = { id: string; familyId: string; name: string; version: number; status: string; questionDefinitions: RawQuestion[] }

function parseJson(value: string | null) {
  if (!value) return undefined
  try { return JSON.parse(value) as unknown } catch { return undefined }
}

function parseQuestions(template: RawTemplate | null): FormQuestion[] {
  if (!template) return []
  return template.questionDefinitions.map((question) => ({
    key: question.key,
    type: question.type as FormQuestion['type'],
    label: question.label,
    ...(question.help ? { help: question.help } : {}),
    ...(question.required ? { required: true } : {}),
    ...(question.riskLevel && question.riskLevel !== 'LOW' ? { riskLevel: question.riskLevel as FormQuestion['riskLevel'] } : {}),
    ...(Array.isArray(parseJson(question.optionsJson)) ? { options: parseJson(question.optionsJson) as string[] } : {}),
    ...(typeof parseJson(question.conditionJson) === 'object' && parseJson(question.conditionJson) !== null ? { condition: parseJson(question.conditionJson) as FormQuestion['condition'] } : {}),
  }))
}

async function requestJson(path: string, options: RequestInit) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? 'Nie udało się zapisać szablonu.')
  return body
}

function isPublishable(questions: readonly FormQuestion[]) {
  if (questions.length === 0) return false
  try {
    const validated = validateInstallationQuestionDefinitions('draft', questions)
    return buildQuestionForest(validated).detached.length === 0
  } catch { return false }
}

export function TemplateBuilder({ initialTemplates }: { initialTemplates: RawTemplate[] }) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [templateName, setTemplateName] = useState('')
  const [activeDraftId, setActiveDraftId] = useState<string | null>(initialTemplates.find((template) => template.status === 'DRAFT')?.id ?? null)
  const activeDraftIdRef = useRef(activeDraftId)
  const [designerPublishable, setDesignerPublishable] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const activeDraft = useMemo(() => templates.find((template) => template.id === activeDraftId && template.status === 'DRAFT') ?? null, [templates, activeDraftId])
  const drafts = useMemo(() => templates.filter((template) => template.status === 'DRAFT'), [templates])
  const savedQuestions = useMemo(() => parseQuestions(activeDraft), [activeDraft])
  const publishable = useMemo(() => designerPublishable && isPublishable(savedQuestions), [designerPublishable, savedQuestions])

  function activateDraft(draftId: string | null) {
    activeDraftIdRef.current = draftId
    setActiveDraftId(draftId)
    setDesignerPublishable(false)
  }

  const setDraftPublishAvailability = useCallback((draftId: string, available: boolean) => {
    if (activeDraftIdRef.current === draftId) setDesignerPublishable(available)
  }, [])

  function replaceTemplate(template: RawTemplate) {
    setTemplates((current) => current.some((item) => item.id === template.id) ? current.map((item) => item.id === template.id ? template : item) : [template, ...current])
  }
  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('create'); setMessage('')
    try { const template = await requestJson('/api/installations/templates', { method: 'POST', body: JSON.stringify({ name: templateName }) }) as RawTemplate; replaceTemplate(template); activateDraft(template.id); setTemplateName('') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się utworzyć szkicu.') } finally { setBusy('') }
  }
  async function persistQuestions(questions: FormQuestion[]) {
    if (!activeDraft) return
    const draftId = activeDraft.id
    setBusy('question'); setMessage('')
    try { const template = await requestJson(`/api/installations/templates/${draftId}`, { method: 'PATCH', body: JSON.stringify({ questions }) }) as RawTemplate; replaceTemplate(template) }
    catch (error) { const text = error instanceof Error ? error.message : 'Nie udało się zapisać pytań. Spróbuj ponownie.'; setMessage(text); throw new Error(text) }
    finally { setBusy('') }
  }
  async function publish() {
    if (!activeDraft || !publishable) return
    const draftId = activeDraft.id
    setBusy('publish'); setMessage('')
    try { const template = await requestJson(`/api/installations/templates/${draftId}/publish`, { method: 'POST' }) as RawTemplate; replaceTemplate(template); if (activeDraftIdRef.current === draftId) activateDraft(null); setMessage(`Opublikowano wersję ${template.version}`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się opublikować.') } finally { setBusy('') }
  }
  async function nextDraft(template: RawTemplate) {
    setBusy(`next-${template.id}`); setMessage('')
    try { const draft = await requestJson(`/api/installations/templates/${template.id}/next-draft`, { method: 'POST' }) as RawTemplate; replaceTemplate(draft); activateDraft(draft.id) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się utworzyć następnej wersji.') } finally { setBusy('') }
  }

  const inputStyle = { background: 'var(--wd-sand-light)', borderColor: 'rgba(30, 30, 30, 0.14)' }
  return <section aria-labelledby="template-builder-heading" className="rounded-2xl border p-5 sm:p-6" style={{ background: 'var(--wd-white)', borderColor: 'rgba(30, 30, 30, 0.12)', boxShadow: 'var(--card-shadow)' }}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="data-label" style={{ color: '#8C5718' }}>Wersjonowany formularz</p><h2 id="template-builder-heading" className="mt-1 text-xl font-extrabold" style={{ color: 'var(--wd-dark)' }}>Kreator pytań</h2></div><p className="max-w-sm text-sm" style={{ color: 'var(--wd-text-muted)' }}>Publikacja zamyka wersję. Kolejna zmiana powstaje jako nowy szkic, dlatego snapshot zlecenia nigdy nie zmienia historii.</p></div>
    <form onSubmit={createDraft} className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border p-3" style={{ borderColor: 'rgba(30, 30, 30, 0.1)', background: 'var(--wd-off-white)' }}><div className="min-w-56 flex-1"><Label htmlFor="template-name">Nazwa szablonu</Label><Input id="template-name" aria-label="Nazwa szablonu" value={templateName} onChange={(event) => setTemplateName(event.target.value)} style={inputStyle} /></div><Button type="submit" disabled={busy === 'create'} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Plus />{busy === 'create' ? 'Tworzenie…' : 'Utwórz szkic'}</Button></form>
    {message && <p role={message.startsWith('Opublikowano') ? 'status' : 'alert'} className={`mt-3 text-sm ${message.startsWith('Opublikowano') ? 'text-green-800' : 'text-red-700'}`}>{message}</p>}
    {drafts.length > 0 && <div className="mt-5 max-w-xl"><Label htmlFor="active-template-draft">Wybierz szkic do edycji</Label><select id="active-template-draft" aria-label="Wybierz szkic do edycji" value={activeDraftId ?? ''} onChange={(event) => activateDraft(event.target.value || null)} className="mt-2 min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2" style={inputStyle}>{drafts.map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version} · szkic</option>)}</select></div>}
    {activeDraft && <div className="mt-5 rounded-xl border p-4" style={{ borderColor: 'rgba(169,106,32,.35)', background: 'var(--wd-off-white)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="data-label" style={{ color: '#8C5718' }}>Szkic v{activeDraft.version}</p><h3 className="font-extrabold" style={{ color: 'var(--wd-dark)' }}>{activeDraft.name}</h3></div><Button type="button" onClick={() => void publish()} disabled={busy === 'publish' || !publishable} className="min-h-11" style={{ background: '#A96A20', color: '#fff' }}><Send />{busy === 'publish' ? 'Publikowanie…' : `Opublikuj v${activeDraft.version}`}</Button></div>
      <TemplatePathDesigner key={activeDraft.id} draftId={activeDraft.id} questions={savedQuestions} busy={Boolean(busy)} onPersist={persistQuestions} onPublishAvailabilityChange={setDraftPublishAvailability} />
    </div>}
    {templates.filter((template) => template.status === 'PUBLISHED').length > 0 && <div className="mt-5 space-y-2">{templates.filter((template) => template.status === 'PUBLISHED').map((template) => <div key={template.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: 'rgba(30, 30, 30, 0.12)', background: 'var(--wd-white)' }}><div><span className="num text-xs" style={{ color: '#8C5718' }}>v{template.version}</span><h3 className="font-bold" style={{ color: 'var(--wd-dark)' }}>{template.name}</h3></div><Button type="button" variant="outline" disabled={busy === `next-${template.id}`} onClick={() => void nextDraft(template)} className="min-h-11"><CopyPlus />{busy === `next-${template.id}` ? 'Tworzenie…' : 'Nowy szkic'}</Button></div>)}</div>}
  </section>
}
