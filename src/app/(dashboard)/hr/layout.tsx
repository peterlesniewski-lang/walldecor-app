import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { HrSidebar } from '@/components/hr/hr-sidebar'

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const userRole = session.user.role

  return (
    <div className="flex h-full min-h-0 gap-0">
      <HrSidebar userRole={userRole} />
      <div className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
