import Link from 'next/link'
import { Clock, Tag } from 'lucide-react'
import { VisibilityBadge } from './VisibilityBadge'
import { CATEGORY_LABELS, CATEGORY_COLORS } from './constants'
import { parseTags, getReadingTime } from '@/lib/wikipedia/actions'

interface ArticleCardProps {
  article: {
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
  isManager: boolean
}

export function ArticleCard({ article, isManager }: ArticleCardProps) {
  const cat = CATEGORY_LABELS.find((c) => c.id === article.category)
  const color = CATEGORY_COLORS[article.category] ?? '#64748b'
  const tags = parseTags(article.tags)
  const snippet = article.content.replace(/#+\s/g, '').replace(/\*\*/g, '').slice(0, 140) + '…'
  const readMin = getReadingTime(article.content)

  return (
    <Link
      href={`/knowledge/${article.slug}`}
      className="block group bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: color }}
          />
          <span className="text-xs font-medium truncate" style={{ color }}>
            {cat?.label ?? article.category}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isManager && <VisibilityBadge visibility={article.visibility} />}
          {article.type !== 'knowledge' && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
              {article.type === 'procedure' ? 'PROCEDURA' : 'NOTATKA'}
            </span>
          )}
        </div>
      </div>

      <h3 className="font-semibold text-gray-900 mb-2 group-hover:text-gray-700 leading-snug line-clamp-2">
        {article.title}
      </h3>

      <p className="text-sm text-gray-500 line-clamp-3 mb-3 leading-relaxed">
        {snippet}
      </p>

      <div className="flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {readMin} min
          </span>
          {tags.length > 0 && (
            <span className="flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" />
              {tags.slice(0, 2).join(', ')}
              {tags.length > 2 && ` +${tags.length - 2}`}
            </span>
          )}
        </div>
        <span>{new Date(article.updatedAt).toLocaleDateString('pl-PL')}</span>
      </div>
    </Link>
  )
}
