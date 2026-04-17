import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { getArticles } from '@/lib/wikipedia/actions'
import { ArticleList } from '@/components/wikipedia/ArticleList'

export default async function KnowledgePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = session.user.role as 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
  const isManager = role === 'ADMIN' || role === 'MANAGER'

  const articles = await getArticles({}, role)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gray-900">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Business Wikipedia</h1>
          <p className="text-sm text-gray-500">Encyklopedia wiedzy biznesowej dla właściciela i zespołu</p>
        </div>
      </div>

      <ArticleList initialArticles={articles} isManager={isManager} />
    </div>
  )
}
