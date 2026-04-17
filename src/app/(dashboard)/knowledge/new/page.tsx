import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { ArticleEditor } from '@/components/wikipedia/ArticleEditor'

export default async function NewArticlePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!['ADMIN', 'MANAGER'].includes(session.user.role ?? '')) redirect('/knowledge')

  return <ArticleEditor />
}
