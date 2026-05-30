import { getServerSession } from 'next-auth'
import { notFound, redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { getArticle, parseTags } from '@/lib/wikipedia/actions'
import { ArticleEditor } from '@/components/wikipedia/ArticleEditor'

export default async function EditOperationProcedurePage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) redirect('/operations/procedures')

  const { slug } = await params
  const article = await getArticle(slug, 'ADMIN')
  if (!article || article.type !== 'procedure') notFound()

  return (
    <ArticleEditor
      articleId={article.id}
      slug={article.slug}
      heading="Edytuj procedurę"
      backHref={`/operations/procedures/${article.slug}`}
      successHref="/operations/procedures"
      lockType
      initialData={{
        title: article.title,
        content: article.content,
        category: article.category,
        visibility: article.visibility,
        type: 'procedure',
        tags: parseTags(article.tags),
        authorNote: article.authorNote ?? '',
      }}
    />
  )
}
