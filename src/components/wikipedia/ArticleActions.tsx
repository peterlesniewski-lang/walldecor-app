'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Edit, Eye, EyeOff, Trash2, MoreVertical } from 'lucide-react'

interface ArticleActionsProps {
  articleId: string
  slug: string
  visibility: string
}

export function ArticleActions({ articleId, slug, visibility }: ArticleActionsProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleToggleVisibility() {
    setLoading(true)
    try {
      await fetch(`/api/knowledge/${articleId}/visibility`, { method: 'PATCH' })
      router.refresh()
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Usunąć ten artykuł? Nie można cofnąć tej operacji.')) return
    setLoading(true)
    try {
      await fetch(`/api/knowledge/${articleId}`, { method: 'DELETE' })
      router.push('/knowledge')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex items-center gap-2 shrink-0">
      <button
        onClick={() => router.push(`/knowledge/${slug}/edit`)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50 transition-colors"
      >
        <Edit className="w-3.5 h-3.5" />
        Edytuj
      </button>

      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          disabled={loading}
        >
          <MoreVertical className="w-4 h-4 text-gray-500" />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
              <button
                onClick={handleToggleVisibility}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {visibility === 'manager' ? (
                  <><Eye className="w-4 h-4" /> Udostępnij pracownikom</>
                ) : (
                  <><EyeOff className="w-4 h-4" /> Ukryj przed pracownikami</>
                )}
              </button>
              <hr className="my-1 border-gray-100" />
              <button
                onClick={handleDelete}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
                Usuń artykuł
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
