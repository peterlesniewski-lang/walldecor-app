import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Clock, Edit, Tag } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getArticle, getReadingTime, parseTags } from '@/lib/wikipedia/actions'
import { ArticleViewer } from '@/components/wikipedia/ArticleViewer'
import { VisibilityBadge } from '@/components/wikipedia/VisibilityBadge'
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/components/wikipedia/constants'

export default async function OperationProcedurePage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const { slug } = await params
  const role = session.user.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  const isManager = role === 'ADMIN' || role === 'MANAGER'
  const article = await getArticle(slug, role, session.user.id)
  if (!article || article.type !== 'procedure') notFound()

  const category = CATEGORY_LABELS.find((item) => item.id === article.category)
  const color = CATEGORY_COLORS[article.category] ?? '#64748b'
  const tags = parseTags(article.tags)

  return (
    <div className="mx-auto max-w-4xl p-6">
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-gray-500">
        <Link href="/operations" className="transition-colors hover:text-gray-900">
          Operacje
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href="/operations/procedures" className="transition-colors hover:text-gray-900">
          Procedury
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="max-w-xs truncate font-medium text-gray-900">{article.title}</span>
      </nav>

      <div className="mb-6">
        <div className="mb-3 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold leading-tight text-gray-900">{article.title}</h1>
          {isManager && (
            <Link
              href={`/operations/procedures/${article.slug}/edit`}
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-gray-50"
            >
              <Edit className="h-4 w-4" />
              Edytuj
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ background: `${color}15`, color }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
            {category?.label ?? article.category}
          </span>
          {isManager && <VisibilityBadge visibility={article.visibility} />}
          <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">PROCEDURA</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {getReadingTime(article.content)} min
          </span>
          {tags.length > 0 && (
            <span className="flex items-center gap-1">
              <Tag className="h-3.5 w-3.5" />
              {tags.join(', ')}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <ArticleViewer content={article.content} />
      </div>
    </div>
  )
}
