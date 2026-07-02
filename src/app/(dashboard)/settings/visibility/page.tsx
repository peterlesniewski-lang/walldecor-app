import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { ContentVisibilityMatrix } from '@/components/admin/content-visibility-matrix'

export default async function ContentVisibilitySettingsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (session.user.role !== 'ADMIN') redirect('/settings')

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-900">
          <ShieldCheck className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--wd-dark)' }}>
            Widoczność treści operacyjnych
          </h1>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Wybierz, które procedury, szablony i wykonania są dostępne dla konkretnych użytkowników.
          </p>
        </div>
      </div>

      <ContentVisibilityMatrix />
    </div>
  )
}
