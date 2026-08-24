import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Clock, Tag } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getArticle, getReadingTime, parseTags } from '@/lib/wikipedia/actions'
import { ArticleViewer } from '@/components/wikipedia/ArticleViewer'
import { VisibilityBadge } from '@/components/wikipedia/VisibilityBadge'
import { CATEGORY_LABELS, CATEGORY_COLORS } from '@/components/wikipedia/constants'
import { ArticleActions } from '@/components/wikipedia/ArticleActions'
import { AiAssistant } from '@/components/wikipedia/AiAssistant/AiPanel'

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role === 'INSTALLER') notFound()

  const { slug } = await params
  const role = session.user.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  const isManager = role === 'ADMIN' || role === 'MANAGER'

  const article = await getArticle(slug, role, session.user.id)
  if (!article) notFound()

  const cat = CATEGORY_LABELS.find((c) => c.id === article.category)
  const color = CATEGORY_COLORS[article.category] ?? '#64748b'
  const tags = parseTags(article.tags)
  const readMin = getReadingTime(article.content)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 mb-6">
        <Link href="/knowledge" className="hover:text-gray-900 transition-colors">
          Encyklopedia
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span style={{ color }}>{cat?.label ?? article.category}</span>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-gray-900 font-medium truncate max-w-xs">{article.title}</span>
      </nav>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">{article.title}</h1>
          {isManager && (
            <ArticleActions
              articleId={article.id}
              slug={article.slug}
              visibility={article.visibility}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ background: color + '15', color }}
          >
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
            {cat?.label}
          </span>

          {isManager && <VisibilityBadge visibility={article.visibility} />}

          {article.type !== 'knowledge' && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
              {article.type === 'procedure' ? 'PROCEDURA' : 'NOTATKA'}
            </span>
          )}

          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {readMin} min czytania
          </span>

          {tags.length > 0 && (
            <span className="flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" />
              {tags.join(', ')}
            </span>
          )}

          <span className="text-xs">
            Aktualizacja: {new Date(article.updatedAt).toLocaleDateString('pl-PL')}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <ArticleViewer content={article.content} />
      </div>

      {/* Author Note (manager only) */}
      {isManager && (
        <AuthorNoteSection
          articleId={article.id}
          initialNote={article.authorNote ?? ''}
        />
      )}

      {/* AI Assistant */}
      {isManager && (
        <AiAssistant
          articleTitle={article.title}
          articleCategory={cat?.label ?? article.category}
          articleContent={article.content}
        />
      )}
    </div>
  )
}

// Inline author note component (client boundary)
import { AuthorNoteSection } from '@/components/wikipedia/AuthorNoteSection'
