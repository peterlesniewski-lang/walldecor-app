'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, BookOpen } from 'lucide-react'
import { ArticleCard } from './ArticleCard'
import { CategoryFilter } from './CategoryFilter'
import { SearchBar } from './SearchBar'
import { TYPE_LABELS } from './constants'

interface Article {
  id: string
  title: string
  slug: string
  category: string
  visibility: string
  type: string
  tags: string
  updatedAt: Date
  content: string
}

interface ArticleListProps {
  initialArticles: Article[]
  isManager: boolean
  basePath?: string
  newPath?: string
  newLabel?: string
  fixedType?: string
  showTypeFilter?: boolean
  emptyLabel?: string
}

export function ArticleList({
  initialArticles,
  isManager,
  basePath = '/knowledge',
  newPath = '/knowledge/new',
  newLabel = 'Nowy artykuł',
  fixedType,
  showTypeFilter = true,
  emptyLabel = 'Brak artykułów',
}: ArticleListProps) {
  const router = useRouter()
  const [articles, setArticles] = useState<Article[]>(initialArticles)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [type, setType] = useState(fixedType ?? 'all')
  const [loading, setLoading] = useState(false)

  const fetchArticles = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query) params.set('q', query)
      if (category !== 'all') params.set('category', category)
      if ((fixedType ?? type) !== 'all') params.set('type', fixedType ?? type)
      const res = await fetch(`/api/knowledge?${params}`)
      if (res.ok) setArticles(await res.json())
    } finally {
      setLoading(false)
    }
  }, [query, category, type, fixedType])

  useEffect(() => {
    const timer = setTimeout(fetchArticles, query ? 300 : 0)
    return () => clearTimeout(timer)
  }, [fetchArticles, query])

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 max-w-md">
            <SearchBar value={query} onChange={setQuery} />
          </div>
          {isManager && (
            <button
              onClick={() => router.push(newPath)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors shrink-0"
              style={{ background: 'var(--wd-accent, #1A1410)' }}
            >
              <Plus className="w-4 h-4" />
              {newLabel}
            </button>
          )}
        </div>

        <CategoryFilter active={category} onChange={(c) => { setCategory(c); setQuery('') }} />

        {showTypeFilter && (
          <div className="flex gap-2">
            {TYPE_LABELS.map((t) => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  type === t.id ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <BookOpen className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">{emptyLabel}{query ? ` dla "${query}"` : ''}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} isManager={isManager} basePath={basePath} />
          ))}
        </div>
      )}

      <div className="mt-4 text-xs text-gray-400 text-right">
        {articles.length} artykuł{articles.length === 1 ? '' : articles.length < 5 ? 'y' : 'ów'}
      </div>
    </div>
  )
}
