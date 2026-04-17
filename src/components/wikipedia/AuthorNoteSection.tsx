'use client'

import { useState } from 'react'
import { StickyNote, Save, X } from 'lucide-react'

interface AuthorNoteSectionProps {
  articleId: string
  initialNote: string
}

export function AuthorNoteSection({ articleId, initialNote }: AuthorNoteSectionProps) {
  const [note, setNote] = useState(initialNote)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialNote)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await fetch(`/api/knowledge/${articleId}/author-note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: draft }),
      })
      setNote(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
          <StickyNote className="w-4 h-4" />
          Notatka własna (prywatna)
        </div>
        {!editing && (
          <button
            onClick={() => { setDraft(note); setEditing(true) }}
            className="text-xs text-amber-700 hover:text-amber-900 underline"
          >
            {note ? 'Edytuj' : 'Dodaj notatkę'}
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Twoje prywatne przemyślenia, kontekst, zastosowania..."
            className="w-full p-3 border border-amber-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Zapisuję...' : 'Zapisz'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100"
            >
              <X className="w-3.5 h-3.5" />
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-wrap">
          {note || <span className="text-amber-500 italic">Brak notatki własnej</span>}
        </p>
      )}
    </div>
  )
}
