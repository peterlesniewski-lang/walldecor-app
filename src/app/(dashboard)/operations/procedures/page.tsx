import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { BookOpenCheck } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getArticles } from '@/lib/wikipedia/actions'
import { ArticleList } from '@/components/wikipedia/ArticleList'

export default async function OperationProceduresPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user.role
  const isManager = role === 'ADMIN' || role === 'MANAGER'
  const procedures = await getArticles({ type: 'procedure' }, role)

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
          <BookOpenCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Procedury operacyjne</h1>
          <p className="text-sm text-gray-500">How-to do zadań wykonywanych w firmie.</p>
        </div>
      </div>

      <ArticleList initialArticles={procedures} isManager={isManager} />
    </div>
  )
}
