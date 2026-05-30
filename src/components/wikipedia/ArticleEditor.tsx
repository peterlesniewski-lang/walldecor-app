'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Save, ArrowLeft, Tag as TagIcon, X } from 'lucide-react'
import slugify from 'slugify'
import { CATEGORY_LABELS, TYPE_LABELS } from './constants'

const MDEditor = dynamic(() => import('@uiw/react-md-editor'), { ssr: false })

interface ArticleEditorProps {
  articleId?: string
  slug?: string
  heading?: string
  backHref?: string
  successHref?: string
  lockType?: boolean
  initialData?: {
    title: string
    content: string
    category: string
    visibility: string
    type: string
    tags: string[]
    authorNote: string
  }
}

const DRAFT_KEY = (slug: string) => `wiki-draft-${slug}`

export function ArticleEditor({
  articleId,
  slug,
  heading,
  backHref,
  successHref,
  lockType = false,
  initialData,
}: ArticleEditorProps) {
  const router = useRouter()
  const isEdit = Boolean(articleId)

  const [title, setTitle] = useState(initialData?.title ?? '')
  const [content, setContent] = useState(initialData?.content ?? '')
  const [category, setCategory] = useState(initialData?.category ?? 'management')
  const [visibility, setVisibility] = useState(initialData?.visibility ?? 'manager')
  const [type, setType] = useState(initialData?.type ?? 'knowledge')
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [authorNote, setAuthorNote] = useState(initialData?.authorNote ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  const draftKey = DRAFT_KEY(slug ?? 'new')

  // Load draft from localStorage
  useEffect(() => {
    if (!isEdit) {
      const draft = localStorage.getItem(draftKey)
      if (draft) {
        try {
          const d = JSON.parse(draft)
          if (d.title) setTitle(d.title)
          if (d.content) setContent(d.content)
          if (d.category) setCategory(d.category)
        } catch (_e) {
          // ignore malformed draft
        }
      }
    }
  }, [draftKey, isEdit])

  // Autosave every 30 seconds
  const autosaveTimer = useRef<NodeJS.Timeout | undefined>(undefined)
  const autosave = useCallback(() => {
    localStorage.setItem(draftKey, JSON.stringify({ title, content, category }))
    setLastSaved(new Date())
  }, [draftKey, title, content, category])

  useEffect(() => {
    clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(autosave, 30000)
    return () => clearTimeout(autosaveTimer.current)
  }, [autosave])

  const generatedSlug = slug ?? slugify(title, { lower: true, strict: true })

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput('')
  }

  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !content.trim()) {
      setError('Tytuł i treść są wymagane')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        title: title.trim(),
        slug: generatedSlug,
        content,
        category,
        visibility,
        type,
        tags,
        authorNote: authorNote || null,
      }

      const url = isEdit ? `/api/knowledge/${articleId}` : '/api/knowledge'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Błąd zapisywania')
      }

      const data = await res.json()
      localStorage.removeItem(draftKey)
      router.push(successHref ?? `/knowledge/${data.slug ?? slug}`)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Błąd')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (backHref ? router.push(backHref) : router.back())}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4 text-gray-500" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {heading ?? (isEdit ? 'Edytuj artykuł' : 'Nowy artykuł')}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-xs text-gray-400">
              Zapisano lokalnie: {lastSaved.toLocaleTimeString('pl-PL')}
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--wd-accent, #1A1410)' }}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Zapisuję...' : 'Zapisz'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Main content */}
        <div className="col-span-2 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Tytuł</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tytuł artykułu..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              required
            />
            {title && (
              <p className="text-xs text-gray-400 mt-1">Slug: <code>{generatedSlug}</code></p>
            )}
          </div>

          <div data-color-mode="light">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Treść (Markdown)</label>
            <MDEditor
              value={content}
              onChange={(v) => setContent(v ?? '')}
              height={500}
              preview="live"
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Kategoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {CATEGORY_LABELS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Widoczność</label>
            <div className="flex gap-2">
              {[
                { value: 'manager', label: 'Tylko Manager' },
                { value: 'public', label: 'Wszyscy' },
              ].map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setVisibility(v.value)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    visibility === v.value
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          {!lockType && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Typ</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                {TYPE_LABELS.filter(t => t.id !== 'all').map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Tagi</label>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs">
                  {t}
                  <button type="button" onClick={() => removeTag(t)}>
                    <X className="w-3 h-3 text-gray-400 hover:text-gray-600" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                placeholder="Dodaj tag..."
                className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={addTag}
                className="px-2.5 py-1.5 bg-gray-100 rounded text-xs hover:bg-gray-200"
              >
                <TagIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Notatka własna (prywatna)
            </label>
            <textarea
              value={authorNote}
              onChange={(e) => setAuthorNote(e.target.value)}
              rows={4}
              placeholder="Prywatne przemyślenia..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none resize-none"
            />
          </div>
        </div>
      </div>
    </form>
  )
}
