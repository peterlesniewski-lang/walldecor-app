import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { Sidebar } from '@/components/shared/sidebar'
import { Header } from '@/components/shared/header'
import { AiChatWidget } from '@/components/shared/ai-chat-widget'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  if (session.user.mustChangePassword) {
    redirect('/change-password')
  }

  const canUseAi = session.user.role === 'ADMIN' || session.user.role === 'MANAGER'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--wd-off-white)' }}>
      <Sidebar userRole={session.user.role ?? 'EMPLOYEE'} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header user={session.user} />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
      {canUseAi && <AiChatWidget />}
    </div>
  )
}
